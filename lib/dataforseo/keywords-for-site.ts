import { getDataForSeoClient } from "./client";
import { ensureDataForSeoResponseOk } from "./validate";

interface KeywordsForSiteOptions {
  onProgress?: (done: number, total: number, target: string) => Promise<void> | void;
}

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

    const { data } = await client.post(
      "/v3/keywords_data/google_ads/keywords_for_site/live",
      tasks
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
