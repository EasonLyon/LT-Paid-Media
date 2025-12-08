import {
  EnrichedKeywordRecord,
  SerpExpansionResult,
  SiteKeywordRecord,
  UnifiedKeywordRecord,
} from "@/types/sem";
import { fetchSearchVolumeBatches } from "../dataforseo/search-volume";
import { buildEnrichedKeywords } from "./enrich-search-volume";
import { readProjectJson, writeProjectJson } from "../storage/project-files";
import { sanitizeKeywordForSearchVolume } from "./keywords";

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

const normalizeSpell = (keyword: string) => sanitizeKeywordForSearchVolume(keyword).toLowerCase();

async function enrichSerpKeywordsWithSearchVolume(
  projectId: string,
  serpKeywords: string[],
  existingNormalized: Set<string>,
  onProgress?: (info: { processedKeywords: number; totalKeywords: number }) => void | Promise<void>,
) {
  const uniqueKeywords: string[] = [];
  const seen = new Set<string>();

  for (const kw of serpKeywords) {
    const sanitized = sanitizeKeywordForSearchVolume(kw);
    const normalized = normalizeSpell(sanitized);
    if (!sanitized || !normalized || existingNormalized.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueKeywords.push(sanitized);
  }

  if (uniqueKeywords.length === 0) return [];

  console.log(`[Step5] fetching search volume for ${uniqueKeywords.length} serp keyword(s)`);
  const { responses, skipped } = await fetchSearchVolumeBatches(uniqueKeywords, {
    onProgress: async (info) => {
      await onProgress?.({
        processedKeywords: info.processedKeywords,
        totalKeywords: info.totalKeywords,
      });
    },
  });
  if (skipped.length) {
    const sample = skipped.slice(0, 5).join(", ");
    console.warn(
      `[Step5] skipped ${skipped.length} serp keyword(s) due to validation/DataForSEO rejection` +
        (sample ? `; e.g. ${sample}` : ""),
    );
  }

  await writeProjectJson(projectId, "05", "serp-keywords-search-volume-raw.json", responses);

  const enriched = buildEnrichedKeywords(responses, {}, projectId);
  return enriched;
}

function mapEnrichedToUnified(rec: EnrichedKeywordRecord): UnifiedKeywordRecord {
  return {
    keyword: rec.keyword,
    projectid: rec.projectid,
    api_job_id: rec.api_job_id,
    spell: normalizeSpell(rec.keyword),
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
    spell: normalizeSpell(rec.keyword),
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
    const hasBids = rec.low_top_of_page_bid !== null && rec.high_top_of_page_bid !== null;
    const hasCpc = rec.cpc !== null && rec.cpc !== undefined;
    const volume = rec.search_volume ?? 0;
    return hasBids && hasCpc && volume >= volumeThreshold;
  });
}

type CombineProgressInfo = {
  processedKeywords?: number;
  totalKeywords?: number;
};

export async function buildCombinedKeywordList(
  projectId: string,
  onProgress?: (completed: number, target?: string, info?: CombineProgressInfo) => Promise<void> | void,
): Promise<UnifiedKeywordRecord[]> {
  console.log("[Step5] combine start");
  const totalSteps = 5;
  const step = async (count: number, target: string, info?: CombineProgressInfo) => {
    if (onProgress) await onProgress(count, target, info);
  };

  await step(0, "start");

  const enrichedPromise = readProjectJson<EnrichedKeywordRecord[]>(
    projectId,
    "03-keywords-enriched-with-search-volume.json",
  );
  const sitePromise = readProjectJson<SiteKeywordRecord[]>(projectId, "06-site-keywords-from-top-domains.json");
  const serpPromise = readProjectJson<SerpExpansionResult>(projectId, "05-serp-new-keywords-and-top-urls.json");

  const [enriched, siteKeywords, serp] = await Promise.all([enrichedPromise, sitePromise, serpPromise]);
  const estimatedTotal = enriched.length + siteKeywords.length + (serp?.new_keywords?.length ?? 0);
  await step(1, "loaded_sources", { totalKeywords: estimatedTotal, processedKeywords: 0 });

  const existingNormalized = new Set<string>();
  for (const rec of enriched) existingNormalized.add(normalizeSpell(rec.keyword));
  for (const rec of siteKeywords) existingNormalized.add(normalizeSpell(rec.keyword));

  const newKeywords: string[] = serp?.new_keywords ?? [];
  const serpEnriched = await enrichSerpKeywordsWithSearchVolume(projectId, newKeywords, existingNormalized, (info) =>
    step(2, "serp_search_volume", info),
  );
  await step(2, "serp_search_volume", {
    processedKeywords: serpEnriched.length,
    totalKeywords: serpEnriched.length,
  });

  const unified: UnifiedKeywordRecord[] = [];
  unified.push(...enriched.map(mapEnrichedToUnified));
  unified.push(...siteKeywords.map(mapSiteToUnified));
  unified.push(...serpEnriched.map(mapEnrichedToUnified));

  const deduped = dedupeKeywords(unified);
  await step(3, "deduped");

  const filtered = filterKeywords(deduped);
  await step(4, "filtered");

  await writeProjectJson(projectId, "07", "all-keywords-combined-deduped.json", filtered);
  await step(totalSteps, "written");

  console.log(`[Step5] combine complete with ${filtered.length} keywords`);
  return filtered;
}
