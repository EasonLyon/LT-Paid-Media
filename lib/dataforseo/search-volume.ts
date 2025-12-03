import { tqdm } from "node-console-progress-bar-tqdm";
import { getDataForSeoClient } from "./client";
import { chunkArray, isValidKeyword } from "../sem/keywords";
import { DataForSeoSearchVolumeResponse } from "@/types/sem";

interface SearchVolumeOptions {
  location_code?: number;
  language_code?: string;
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
  const language_code = options.language_code ?? "en";
  const onProgress = options.onProgress;

  console.log("[search-volume] validating keywords");
  const validKeywords = keywords.filter(isValidKeyword);
  const skipped = keywords.filter((kw) => !isValidKeyword(kw));
  const batches = chunkArray(validKeywords, batchSize);
  console.log(`[search-volume] ${validKeywords.length} valid keywords in ${batches.length} batch(es)`);

  const responses: DataForSeoSearchVolumeResponse[] = [];
  const totalBatches = batches.length;
  const totalKeywords = validKeywords.length;
  let completedBatches = 0;
  let processedKeywords = 0;

  await onProgress?.({ completedBatches, totalBatches, processedKeywords, totalKeywords });

  for (const batch of tqdm(batches, { description: "DataForSEO search_volume" })) {
    const tasks = [
      {
        location_code,
        language_code,
        keywords: batch,
        sort_by: "search_volume",
      },
    ];

    const { data } = await client.post<DataForSeoSearchVolumeResponse>(
      "/v3/keywords_data/google_ads/search_volume/live",
      tasks,
    );
    responses.push(data);
    completedBatches += 1;
    processedKeywords = Math.min(processedKeywords + batch.length, totalKeywords);
    await onProgress?.({ completedBatches, totalBatches, processedKeywords, totalKeywords });
  }

  console.log("[search-volume] complete");
  return { responses, skipped };
}
