import { tqdm } from "node-console-progress-bar-tqdm";
import { getDataForSeoClient } from "./client";
import { chunkArray, isValidKeyword } from "../sem/keywords";
import { DataForSeoSearchVolumeResponse } from "@/types/sem";
import { ensureDataForSeoResponseOk } from "./validate";

interface SearchVolumeOptions {
  location_code?: number;
  batchSize?: number;
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
  const client = getDataForSeoClient();
  const batchSize = options.batchSize ?? 1000;
  const location_code = options.location_code ?? 2458;
  const onProgress = options.onProgress;

  console.log("[search-volume] validating keywords");
  const skippedSet = new Set<string>();
  for (const kw of keywords) {
    if (!isValidKeyword(kw)) {
      skippedSet.add(kw);
    }
  }

  const validKeywords = keywords.filter((kw) => !skippedSet.has(kw));
  const batches = chunkArray(validKeywords, batchSize);
  console.log(`[search-volume] ${validKeywords.length} valid keywords in ${batches.length} batch(es)`);

  const responses: DataForSeoSearchVolumeResponse[] = [];
  const totalBatches = batches.length;
  let totalKeywords = validKeywords.length;
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
      const match = message.match(/invalid characters or symbols:\s*['"]([^'"]+)['"]/i);
      if (match?.[1]) return match[1].trim();
    }
    return null;
  };

  for (const batch of tqdm(batches, { description: "DataForSEO search_volume" })) {
    let currentBatch = batch.filter((kw) => !skippedSet.has(kw));

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

      const { data } = await client.post<DataForSeoSearchVolumeResponse>(
        "/v3/keywords_data/google_ads/search_volume/live",
        tasks,
      );

      const invalidKeyword = findInvalidKeyword(data);
      if (invalidKeyword) {
        if (!skippedSet.has(invalidKeyword)) {
          skippedSet.add(invalidKeyword);
          totalKeywords = Math.max(0, totalKeywords - 1);
          console.warn(`[search-volume] skipping invalid keyword: "${invalidKeyword}"`);
        }
        currentBatch = currentBatch.filter((kw) => kw !== invalidKeyword);
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
      break;
    }
  }

  console.log("[search-volume] complete");
  return { responses, skipped: Array.from(skippedSet) };
}
