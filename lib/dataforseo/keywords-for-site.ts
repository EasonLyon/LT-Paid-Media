import { getDataForSeoClient } from "./client";
import { ensureDataForSeoResponseOk } from "./validate";

interface KeywordsForSiteOptions {
  onProgress?: (done: number, total: number, target: string) => Promise<void> | void;
}

const RATE_LIMIT_STATUS_CODE = 40202;
const MAX_RATE_LIMIT_RETRIES = 2;
const BASE_RATE_LIMIT_DELAY_MS = 10_000;

export async function fetchKeywordsForSites(
  domains: string[],
  options: KeywordsForSiteOptions = {}
): Promise<unknown[]> {
  const client = getDataForSeoClient();
  const responses: unknown[] = [];
  let done = 0;

  // Simple loop, no tqdm
  for (const domain of domains) {
    const tasks = [
      {
        target: domain,
        sort_by: "search_volume",
      },
    ];

    const data = await postWithRateLimitRetry(async () =>
      client.post("/v3/keywords_data/google_ads/keywords_for_site/live", tasks)
    );
    ensureDataForSeoResponseOk(data, "keywords_for_site");
    responses.push(data);

    done += 1;
    if (options.onProgress) {
      await options.onProgress(done, domains.length, domain);
    }
  }

  return responses;
}

async function postWithRateLimitRetry(requester: () => Promise<{ data: unknown }>): Promise<unknown> {
  let attempt = 0;

  while (true) {
    const { data } = await requester();
    const rateLimitMessage = getRateLimitMessage(data);

    if (rateLimitMessage) {
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error(
          `[DataForSEO keywords_for_site] rate limit persisted after ${attempt + 1} attempts: ${rateLimitMessage}`
        );
      }
      const delayMs = BASE_RATE_LIMIT_DELAY_MS * (attempt + 1);
      await delay(delayMs);
      attempt += 1;
      continue;
    }

    return data;
  }
}

function getRateLimitMessage(response: unknown): string | null {
  const tasksError = (response as { tasks_error?: Array<{ status_code?: number; status_message?: string }> })
    ?.tasks_error;
  if (Array.isArray(tasksError)) {
    const hit = tasksError.find((t) => t?.status_code === RATE_LIMIT_STATUS_CODE);
    if (hit) return hit.status_message ?? "rate limit reached";
  }

  const tasks = (response as { tasks?: Array<{ status_code?: number; status_message?: string }> })?.tasks;
  if (Array.isArray(tasks)) {
    const hit = tasks.find((t) => t?.status_code === RATE_LIMIT_STATUS_CODE);
    if (hit) return hit.status_message ?? "rate limit reached";
  }

  return null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
