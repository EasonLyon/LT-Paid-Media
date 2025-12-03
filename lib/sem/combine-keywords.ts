import { EnrichedKeywordRecord, SerpExpansionResult, SiteKeywordRecord, UnifiedKeywordRecord } from "@/types/sem";
import { readProjectJson, writeProjectJson } from "../storage/project-files";

export function dedupeKeywords(records: UnifiedKeywordRecord[]): UnifiedKeywordRecord[] {
  const deduped = new Map<string, UnifiedKeywordRecord>();
  for (const rec of records) {
    const key = rec.keyword.trim().toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, rec);
    }
  }
  return Array.from(deduped.values());
}

function mapEnrichedToUnified(rec: EnrichedKeywordRecord): UnifiedKeywordRecord {
  return {
    keyword: rec.keyword,
    projectid: rec.projectid,
    api_job_id: rec.api_job_id,
    spell: rec.spell,
    location_code: rec.location_code,
    language_code: rec.language_code,
    search_partners: rec.search_partners,
    competition: rec.competition,
    competition_index: rec.competition_index,
    search_volume: rec.search_volume,
    avg_monthly_searches: rec.avg_monthly_searches,
    low_top_of_page_bid: rec.low_top_of_page_bid,
    high_top_of_page_bid: rec.high_top_of_page_bid,
    cpc: rec.cpc,
    monthly_searches: rec.monthly_searches,
    category_level_1: rec.category_level_1,
    category_level_2: rec.category_level_2,
    segment_name: rec.segment_name,
  };
}

function mapSiteToUnified(rec: SiteKeywordRecord): UnifiedKeywordRecord {
  return {
    keyword: rec.keyword,
    projectid: rec.projectid,
    api_job_id: rec.api_job_id,
    spell: rec.spell,
    location_code: rec.location_code,
    language_code: rec.language_code,
    search_partners: rec.search_partners,
    competition: rec.competition,
    competition_index: rec.competition_index,
    search_volume: rec.search_volume,
    avg_monthly_searches: rec.avg_monthly_searches,
    low_top_of_page_bid: rec.low_top_of_page_bid,
    high_top_of_page_bid: rec.high_top_of_page_bid,
    cpc: rec.cpc,
    monthly_searches: rec.monthly_searches,
    category_level_1: null,
    category_level_2: null,
    segment_name: null,
  };
}

function filterKeywords(records: UnifiedKeywordRecord[]): UnifiedKeywordRecord[] {
  const volumeThreshold = 100;
  return records.filter((rec) => {
    const hasCpc = rec.cpc !== null && rec.cpc !== undefined;
    const volume = rec.search_volume ?? 0;
    return hasCpc && volume >= volumeThreshold;
  });
}

export async function buildCombinedKeywordList(
  projectId: string,
  onProgress?: (completed: number, target?: string) => Promise<void> | void,
): Promise<UnifiedKeywordRecord[]> {
  console.log("[Step5] combine start");
  const totalSteps = 4;
  const step = async (count: number, target: string) => {
    if (onProgress) await onProgress(count, target);
  };

  await step(0, "start");

  const enrichedPromise = readProjectJson<EnrichedKeywordRecord[]>(
    projectId,
    "03-keywords-enriched-with-search-volume.json",
  );
  const sitePromise = readProjectJson<SiteKeywordRecord[]>(projectId, "06-site-keywords-from-top-domains.json");
  const serpPromise = readProjectJson<SerpExpansionResult>(projectId, "05-serp-new-keywords-and-top-urls.json");

  const [enriched, siteKeywords, serp] = await Promise.all([enrichedPromise, sitePromise, serpPromise]);
  await step(1, "loaded_sources");

  const unified: UnifiedKeywordRecord[] = [];
  unified.push(...enriched.map(mapEnrichedToUnified));
  unified.push(...siteKeywords.map(mapSiteToUnified));

  const newKeywords: string[] = serp?.new_keywords ?? [];
  for (const kw of newKeywords) {
    unified.push({
      keyword: kw,
      projectid: projectId,
      api_job_id: null,
      spell: null,
      location_code: null,
      language_code: null,
      search_partners: null,
      competition: null,
      competition_index: null,
      search_volume: null,
      avg_monthly_searches: null,
      low_top_of_page_bid: null,
      high_top_of_page_bid: null,
      cpc: null,
      monthly_searches: null,
      category_level_1: null,
      category_level_2: null,
      segment_name: null,
    });
  }

  const deduped = dedupeKeywords(unified);
  await step(2, "deduped");

  const filtered = filterKeywords(deduped);
  await step(3, "filtered");

  await writeProjectJson(projectId, "07", "all-keywords-combined-deduped.json", filtered);
  await step(totalSteps, "written");

  console.log(`[Step5] combine complete with ${filtered.length} keywords`);
  return filtered;
}
