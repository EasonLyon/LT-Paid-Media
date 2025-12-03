import { tqdm } from "node-console-progress-bar-tqdm";
import { getDataForSeoClient } from "./client";

interface SerpOptions {
  location_code?: number;
  language_code?: string;
  device?: "desktop" | "mobile";
  os?: "windows" | "macos" | "android" | "ios";
  depth?: number;
  people_also_ask_click_depth?: number;
  onProgress?: (done: number, total: number, keyword: string) => Promise<void> | void;
  startTimestamp?: number;
}

export async function fetchSerpResults(
  seedKeywords: string[],
  options: SerpOptions = {},
): Promise<unknown[]> {
  const client = getDataForSeoClient();
  const location_code = options.location_code ?? 2458;
  const language_code = options.language_code ?? "en";
  const device = options.device ?? "mobile";
  const os = options.os ?? "android";
  const depth = options.depth ?? 10;
  const people_also_ask_click_depth = options.people_also_ask_click_depth ?? 1;

  console.log(`[serp] start for ${seedKeywords.length} seed keywords`);
  const responses: unknown[] = [];
  let done = 0;

  for (const keyword of tqdm(seedKeywords, { description: "DataForSEO SERP" })) {
    const tasks = [
      {
        keyword,
        location_code,
        language_code,
        device,
        os,
        depth,
        people_also_ask_click_depth,
      },
    ];

    const { data } = await client.post("/v3/serp/google/organic/live/advanced", tasks);
    responses.push(data);
    done += 1;
    if (options.onProgress) {
      await options.onProgress(done, seedKeywords.length, keyword);
    }
  }

  console.log("[serp] complete");
  return responses;
}
