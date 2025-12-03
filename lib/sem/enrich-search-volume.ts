import {
  DataForSeoSearchVolumeResponse,
  DataForSeoSearchVolumeTask,
  DataForSeoSearchVolumeTaskResult,
  EnrichedKeywordRecord,
  KeywordCategoryMap,
  MonthlySearchEntry,
} from "@/types/sem";

export function computeAvgMonthlySearches(monthly_searches: MonthlySearchEntry[] | null | undefined): number | null {
  if (!monthly_searches) return null;
  const valid = monthly_searches.filter((m) => m.search_volume !== null);
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, m) => acc + (m.search_volume ?? 0), 0);
  const avg = sum / valid.length;
  return Math.round(avg * 100) / 100;
}

export function buildEnrichedKeywords(
  rawResponses: DataForSeoSearchVolumeResponse[],
  categoryMap: KeywordCategoryMap,
  projectId: string,
): EnrichedKeywordRecord[] {
  const enriched: EnrichedKeywordRecord[] = [];

  for (const response of rawResponses) {
    const apiJobId = response?.id ?? "";
    const tasks =
      response?.tasks ??
      (Array.isArray(response?.result)
        ? ([{ result: response.result, data: response.data }] as DataForSeoSearchVolumeTask[])
        : []);
    // DataForSEO may return result directly on response or inside tasks
    if (Array.isArray(tasks)) {
      for (const task of tasks) {
        const results = (task as DataForSeoSearchVolumeTask)?.result ?? [];
        const inferredItems: Array<DataForSeoSearchVolumeTaskResult | DataForSeoSearchVolumeItem> = results.length
          ? results
          : [];

        for (const r of inferredItems) {
          const resultItem = r as DataForSeoSearchVolumeTaskResult | DataForSeoSearchVolumeItem;
          const items = Array.isArray((resultItem as DataForSeoSearchVolumeTaskResult).items)
            ? (resultItem as DataForSeoSearchVolumeTaskResult).items!
            : [resultItem as DataForSeoSearchVolumeItem];

          const location_code =
            (resultItem as DataForSeoSearchVolumeTaskResult)?.location_code ?? task?.data?.location_code ?? 2458;
          const language_code =
            (resultItem as DataForSeoSearchVolumeTaskResult)?.language_code ?? task?.data?.language_code ?? "en";

          for (const item of items) {
            if (!item?.keyword) continue;
            const keyword: string = item.keyword;
            const categoryInfo = categoryMap[keyword];

            const record: EnrichedKeywordRecord = {
              keyword,
              projectid: projectId,
              api_job_id: apiJobId,
              spell: item.spell ?? null,
              location_code,
              language_code,
              search_partners: item.search_partners ?? null,
              competition: item.competition ?? null,
              competition_index: item.competition_index ?? null,
              search_volume: item.search_volume ?? null,
              avg_monthly_searches: computeAvgMonthlySearches(item.monthly_searches ?? null),
              low_top_of_page_bid: item.low_top_of_page_bid ?? null,
              high_top_of_page_bid: item.high_top_of_page_bid ?? null,
              cpc: item.cpc ?? null,
              category_level_1: categoryInfo?.category_level_1 ?? null,
              category_level_2: categoryInfo?.category_level_2 ?? null,
              segment_name: categoryInfo?.segment_name ?? null,
              monthly_searches: item.monthly_searches ?? null,
            };

            enriched.push(record);
          }
        }
      }
    }
  }

  return enriched;
}

export function filterByAvgMonthlySearches(
  records: EnrichedKeywordRecord[],
  minAvg: number,
): EnrichedKeywordRecord[] {
  return records.filter((rec) => rec.avg_monthly_searches !== null && rec.avg_monthly_searches >= minAvg);
}
