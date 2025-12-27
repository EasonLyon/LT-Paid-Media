import { EnrichedKeywordRecord, MonthlySearchEntry, SiteKeywordRecord, TopOrganicUrl } from "@/types/sem";
import { computeAvgMonthlySearches } from "./enrich-search-volume";

function pickTarget(item: TopOrganicUrl): string | null {
  // Prefer full URL if available; fallback to domain
  if (item.url) return item.url;
  if (item.domain) return item.domain;
  return null;
}

export function extractDomains(urls: TopOrganicUrl[]): string[] {
  const targets = new Set<string>();
  for (const item of urls) {
    const target = pickTarget(item);
    if (target) targets.add(target);
  }
  return Array.from(targets);
}

export function mapSiteToEnriched(rec: SiteKeywordRecord): EnrichedKeywordRecord {
  return {
    keyword: rec.keyword,
    projectid: rec.projectid,
    api_job_id: rec.api_job_id,
    spell: rec.spell,
    location_code: rec.location_code ?? 0,
    language_code: rec.language_code ?? "en",
    search_partners: rec.search_partners,
    competition: rec.competition,
    competition_index: rec.competition_index,
    search_volume: rec.search_volume,
    avg_monthly_searches: rec.avg_monthly_searches,
    low_top_of_page_bid: rec.low_top_of_page_bid,
    high_top_of_page_bid: rec.high_top_of_page_bid,
    cpc: rec.cpc,
    category_level_1: null,
    category_level_2: null,
    segment_name: null,
    monthly_searches: rec.monthly_searches,
  };
}

export function normalizeSiteKeywordRecords(responses: unknown[], projectId: string): SiteKeywordRecord[] {
  const records: SiteKeywordRecord[] = [];

  for (const response of responses) {
    const typedResponse = response as { id?: string; tasks?: unknown[]; result?: unknown[] };
    const items: { item: unknown; api_job_id: string }[] = [];

    // Case 1: legacy DataForSEO shape with tasks -> result -> items
    if (Array.isArray(typedResponse.tasks) && typedResponse.tasks.length > 0) {
      for (const task of typedResponse.tasks) {
        const api_job_id = (task as { id?: string })?.id ?? typedResponse?.id ?? "";
        const results = (task as { result?: unknown[] })?.result ?? [];
        for (const r of results) {
          const resultItems = (r as { items?: unknown[] })?.items;
          if (Array.isArray(resultItems)) {
            for (const resultItem of resultItems) {
              items.push({ item: resultItem, api_job_id });
            }
            continue;
          }
          // Some responses return keywords directly in result[]
          if ((r as { keyword?: unknown }).keyword) {
            items.push({ item: r, api_job_id });
            continue;
          }
          // Rarely result itself can be an array of keyword items
          if (Array.isArray(r)) {
            for (const arrayItem of r) {
              items.push({ item: arrayItem, api_job_id });
            }
          }
        }
      }
    }

    // Case 2: flat result[] array (current keywords_for_site live response)
    if (Array.isArray(typedResponse.result) && typedResponse.result.length > 0) {
      const api_job_id = typedResponse?.id ?? "";
      for (const resultItem of typedResponse.result) {
        items.push({ item: resultItem, api_job_id });
      }
    }

    for (const { item, api_job_id } of items) {
      const keywordItem = item as Record<string, unknown>;
      const keyword = keywordItem.keyword as string | undefined;
      if (!keyword) continue;

      const record: SiteKeywordRecord = {
        keyword,
        projectid: projectId,
        api_job_id,
        spell: null,
        location_code: (keywordItem.location_code as number) ?? null,
        language_code: (keywordItem.language_code as string) ?? null,
        search_partners: (keywordItem.search_partners as boolean) ?? null,
        competition: (keywordItem.competition as string) ?? null,
        competition_index: (keywordItem.competition_index as number) ?? null,
        search_volume: (keywordItem.search_volume as number) ?? null,
        avg_monthly_searches: computeAvgMonthlySearches(
          (keywordItem.monthly_searches as MonthlySearchEntry[] | null | undefined) ?? null,
        ),
        low_top_of_page_bid: (keywordItem.low_top_of_page_bid as number) ?? null,
        high_top_of_page_bid: (keywordItem.high_top_of_page_bid as number) ?? null,
        cpc: (keywordItem.cpc as number) ?? null,
        monthly_searches: (keywordItem.monthly_searches as MonthlySearchEntry[] | null | undefined) ?? null,
      };

      records.push(record);
    }
  }

  return records;
}

const NAVIGATIONAL_TERMS = [
  "login", "log in", "signin", "sign in", "signup", "sign up",
  "contact", "support", "career", "careers", "job", "jobs",
  "admin", "account", "help", "password", "portal", "facebook",
  "instagram", "linkedin", "twitter", "tiktok", "pinterest", "youtube",
  "reddit", "whatsapp", "indeed", "glassdoor", "monster", "ziprecruiter",
  "upwork", "fiverr", "yours", "he", "she", "next",
  "this", "that", "they", "them",
];

export function isHighQualityKeyword(keyword: string): boolean {
  const lower = keyword.toLowerCase().trim();

  // 1. Word Count Heuristic: Sweet spot 2-7 words
  // Split by whitespace
  const words = lower.split(/\s+/);
  if (words.length < 2 || words.length > 7) {
    return false;
  }

  // 2. Alphanumeric Noise
  // Reject pure numbers
  if (/^\d+$/.test(lower)) {
    return false;
  }
  // Reject if contains non-standard characters (allow letters, numbers, spaces, -, &, ')
  // This regex matches if there is ANY character that is NOT allowed.
  // Allowed: a-z, 0-9, space, -, &, '
  if (/[^a-z0-9\s-&']/.test(lower)) {
    return false;
  }

  // 3. Navigational Cleanup
  // Check if any navigational term is present as a distinct word
  for (const term of NAVIGATIONAL_TERMS) {
    // Check for exact word match to avoid false positives (e.g., "administer" vs "admin")
    // \b matches word boundary
    const regex = new RegExp(`\\b${term}\\b`, "i");
    if (regex.test(lower)) {
      return false;
    }
  }

  return true;
}
