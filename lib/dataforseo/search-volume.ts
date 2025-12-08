import { tqdm } from "node-console-progress-bar-tqdm";
import { getDataForSeoClient } from "./client";
import { chunkArray, isValidKeyword, sanitizeKeywordForSearchVolume } from "../sem/keywords";
import { DataForSeoSearchVolumeResponse } from "@/types/sem";
import { ensureDataForSeoResponseOk } from "./validate";

const INVALID_SYMBOLS = [",", "!", "@", "%", "^", "(", ")", "=", "{", "}", ";", "~", "`", "<", ">", "?", "\\", "|", "―"];

interface SearchVolumeOptions {
  location_code?: number;
  batchSize?: number;
  /**
   * Optional throttle between requests to stay under DataForSEO rate limits (ms).
   * Defaults to 6500ms which keeps us safely under 12 requests/min.
   */
  requestDelayMs?: number;
  onProgress?: (info: {
    completedBatches: number;
    totalBatches: number;
    processedKeywords: number;
    totalKeywords: number;
  }) => void | Promise<void>;
}

export async function fetchSearchVolumeBatches(
  keywords: string[],
  options: SearchVolumeOptions = {},
): Promise<{ responses: DataForSeoSearchVolumeResponse[]; skipped: string[] }> {
  const RATE_LIMIT_STATUS_CODE = 40202;
  const MAX_RATE_LIMIT_RETRIES = 8;
  const BASE_RATE_LIMIT_DELAY_MS = 70_000;

  const client = getDataForSeoClient();
  const batchSize = options.batchSize ?? 1000;
  const location_code = options.location_code ?? 2458;
  const requestDelayMs = options.requestDelayMs ?? 6_500;
  const onProgress = options.onProgress;

  console.log("[search-volume] validating keywords");
  const skippedSet = new Set<string>();
  const sanitizedKeywords: string[] = [];
  const seenSanitized = new Set<string>();
  for (const kw of keywords) {
    const sanitized = sanitizeKeywordForSearchVolume(removeInvalidSymbols(kw));
    if (!sanitized || !isValidKeyword(sanitized)) {
      skippedSet.add(kw);
      continue;
    }
    if (seenSanitized.has(sanitized)) continue;
    seenSanitized.add(sanitized);
    sanitizedKeywords.push(sanitized);
  }

  const batches = chunkArray(sanitizedKeywords, batchSize);
  console.log(`[search-volume] ${sanitizedKeywords.length} valid keywords in ${batches.length} batch(es)`);

  const responses: DataForSeoSearchVolumeResponse[] = [];
  const totalBatches = batches.length;
  let totalKeywords = sanitizedKeywords.length;
  let completedBatches = 0;
  let processedKeywords = 0;

  await onProgress?.({ completedBatches, totalBatches, processedKeywords, totalKeywords });

  const findInvalidKeyword = (response: DataForSeoSearchVolumeResponse): string | null => {
    const tasks = (response as { tasks?: Array<{ status_code?: number; status_message?: string }> }).tasks ?? [];
    const errors =
      (response as { tasks_error?: Array<{ status_code?: number; status_message?: string }> }).tasks_error ?? [];
    const candidates = [...tasks, ...(Array.isArray(errors) ? errors : [])];
    for (const task of candidates) {
      if (!task || task.status_code === 20000) continue;
      const message = task.status_message ?? "";
      const keywordMatch = message.match(/keyword[^'"]*['"]([^'"]+)['"]/i);
      if (keywordMatch?.[1]) return keywordMatch[1].trim();
      const match = message.match(/invalid characters or symbols:\s*['"]([^'"]+)['"]/i);
      if (match?.[1]) return match[1].trim();
    }
    return null;
  };

  for (const batch of tqdm(batches, { description: "DataForSEO search_volume" })) {
    let currentBatch = [...batch];

    if (currentBatch.length === 0) {
      completedBatches += 1;
      await onProgress?.({ completedBatches, totalBatches, processedKeywords, totalKeywords });
      continue;
    }

    // Retry loop to drop invalid keywords reported by the API without failing the entire step.
    while (currentBatch.length) {
      const tasks = [
        {
          location_code,
          keywords: currentBatch,
          sort_by: "search_volume",
        },
      ];

      const data = await postWithRateLimitRetry(
        () => client.post<DataForSeoSearchVolumeResponse>("/v3/keywords_data/google_ads/search_volume/live", tasks),
        {
          maxRetries: MAX_RATE_LIMIT_RETRIES,
          baseDelayMs: BASE_RATE_LIMIT_DELAY_MS,
          rateLimitStatusCode: RATE_LIMIT_STATUS_CODE,
        },
      );

      const invalidKeyword = findInvalidKeyword(data);
      if (invalidKeyword) {
        const { cleanedBatch, removedKeywords } = removeInvalidKeywordFromBatch(currentBatch, invalidKeyword);
        if (removedKeywords.length === 0) {
          throw new Error(
            `[search-volume] invalid keyword "${invalidKeyword}" reported by API but could not be matched to batch`,
          );
        }

        removedKeywords.forEach((kw) => skippedSet.add(kw));
        totalKeywords = Math.max(0, totalKeywords - removedKeywords.length);
        console.warn(
          `[search-volume] removed keyword(s) with invalid characters: ${removedKeywords.join(", ")}. Retrying...`,
        );

        currentBatch = cleanedBatch;
        if (currentBatch.length === 0) {
          completedBatches += 1;
          await onProgress?.({ completedBatches, totalBatches, processedKeywords, totalKeywords });
        }
        continue;
      }

      ensureDataForSeoResponseOk(data, "search_volume");
      responses.push(data);
      completedBatches += 1;
      processedKeywords = Math.min(processedKeywords + currentBatch.length, totalKeywords);
      await onProgress?.({ completedBatches, totalBatches, processedKeywords, totalKeywords });
      if (requestDelayMs > 0) {
        await delay(requestDelayMs);
      }
      break;
    }
  }

  console.log("[search-volume] complete");
  return { responses, skipped: Array.from(skippedSet) };
}

async function postWithRateLimitRetry<T>(
  requester: () => Promise<{ data: T }>,
  {
    maxRetries,
    baseDelayMs,
    rateLimitStatusCode,
  }: { maxRetries: number; baseDelayMs: number; rateLimitStatusCode: number },
): Promise<T> {
  let attempt = 0;

  while (true) {
    const { data } = await requester();
    const rateLimitMessage = getRateLimitMessage(data, rateLimitStatusCode);

    if (rateLimitMessage) {
      if (attempt >= maxRetries) {
        throw new Error(
          `[DataForSEO search_volume] rate limit persisted after ${attempt + 1} attempts: ${rateLimitMessage}`,
        );
      }
      const delayMs = computeRateLimitDelay(rateLimitMessage, attempt, baseDelayMs);
      const delaySeconds = Math.round(delayMs / 1000);
      console.warn(
        `[search-volume] rate limit (${rateLimitMessage}), retrying attempt ${attempt + 2} in ${delaySeconds}s`,
      );
      await delay(delayMs);
      attempt += 1;
      continue;
    }

    return data;
  }
}

function getRateLimitMessage(
  response: unknown,
  rateLimitStatusCode: number,
): string | null {
  const tasksError = (response as { tasks_error?: Array<{ status_code?: number; status_message?: string }> })
    ?.tasks_error;
  if (Array.isArray(tasksError)) {
    const hit = tasksError.find((t) => t?.status_code === rateLimitStatusCode);
    if (hit) return hit.status_message ?? "rate limit reached";
  }

  const tasks = (response as { tasks?: Array<{ status_code?: number; status_message?: string }> })?.tasks;
  if (Array.isArray(tasks)) {
    const hit = tasks.find((t) => t?.status_code === rateLimitStatusCode);
    if (hit) return hit.status_message ?? "rate limit reached";
  }

  return null;
}

function computeRateLimitDelay(rateLimitMessage: string, attempt: number, baseDelayMs: number): number {
  const jitter = Math.floor(Math.random() * 5000);
  if (/per minute/i.test(rateLimitMessage)) {
    return baseDelayMs * (attempt + 1) + jitter;
  }
  return Math.max(baseDelayMs, 10_000) * (attempt + 1) + jitter;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeInvalidSymbols(keyword: string): string {
  let result = keyword;
  for (const symbol of INVALID_SYMBOLS) {
    const pattern = new RegExp(escapeRegExp(symbol), "g");
    result = result.replace(pattern, " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

function normalizeKeywordForComparison(keyword: string): string {
  return sanitizeKeywordForSearchVolume(removeInvalidSymbols(keyword)).toLowerCase();
}

function removeInvalidKeywordFromBatch(batch: string[], invalidKeyword: string): {
  cleanedBatch: string[];
  removedKeywords: string[];
} {
  const removedKeywords: string[] = [];
  const normalizedInvalid = normalizeKeywordForComparison(invalidKeyword);
  const normalizedFragment = invalidKeyword.trim().toLowerCase();

  const filterBatch = (matcher: (kw: string) => boolean) => {
    const keep: string[] = [];
    for (const kw of batch) {
      if (matcher(kw)) {
        removedKeywords.push(kw);
      } else {
        keep.push(kw);
      }
    }
    return keep;
  };

  let cleanedBatch: string[] = batch;

  if (normalizedInvalid) {
    cleanedBatch = filterBatch((kw) => normalizeKeywordForComparison(kw) === normalizedInvalid);
  }

  if (removedKeywords.length === 0 && normalizedFragment) {
    cleanedBatch = filterBatch((kw) => kw.toLowerCase().includes(normalizedFragment));
  }

  if (removedKeywords.length === 0 && batch.length > 0) {
    // Last-resort fallback to avoid infinite retry loops.
    cleanedBatch = batch.slice(1);
    removedKeywords.push(batch[0]);
  }

  return { cleanedBatch, removedKeywords };
}
