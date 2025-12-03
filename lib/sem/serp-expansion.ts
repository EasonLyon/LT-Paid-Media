import { SerpExpansionResult, TopOrganicUrl } from "@/types/sem";

function normalizeTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed || null;
}

export function extractSerpNewKeywords(responses: unknown[], originalKeywordSet: Set<string>): string[] {
  const globalNewKeywordSet = new Set<string>();

  for (const response of responses) {
    const tasks = (response as { tasks?: unknown[] })?.tasks ?? [];
    for (const task of tasks) {
      const result = (task as { result?: unknown[] })?.result ?? [];
      for (const r of result) {
        const items = (r as { items?: unknown[] })?.items ?? [];
        for (const item of items) {
          const typedItem = item as { type?: string; items?: unknown[] };
          if (typedItem?.type === "people_also_ask" || typedItem?.type === "people_also_search") {
            const subItems = typedItem.items ?? [];
            for (const sub of subItems) {
              const title = normalizeTitle((sub as { title?: string })?.title);
              if (!title) continue;
              if (originalKeywordSet.has(title)) continue;
              if (!globalNewKeywordSet.has(title)) {
                globalNewKeywordSet.add(title);
              }
            }
          }
        }
      }
    }
  }

  return Array.from(globalNewKeywordSet);
}

export function extractTopUrls(responses: unknown[]): TopOrganicUrl[] {
  const urls: TopOrganicUrl[] = [];
  const seen = new Set<string>();

  for (const response of responses) {
    const tasks = (response as { tasks?: unknown[] })?.tasks ?? [];
    for (const task of tasks) {
      const result = (task as { result?: unknown[] })?.result ?? [];
      for (const r of result) {
        const items = (r as { items?: unknown[] })?.items ?? [];
        for (const item of items) {
          const typedItem = item as { type?: string; rank_group?: number; url?: string; title?: string; domain?: string };
          if (
            typedItem?.type === "organic" &&
            typeof typedItem.rank_group === "number" &&
            typedItem.rank_group >= 1 &&
            typedItem.rank_group <= 3
          ) {
            const url = typedItem.url;
            if (!url || seen.has(url)) continue;
            seen.add(url);
            urls.push({
              rank_group: typedItem.rank_group,
              title: typedItem.title ?? "",
              domain: typedItem.domain ?? "",
              url,
            });
          }
        }
      }
    }
  }

  return urls;
}

export function buildSerpExpansionResult(
  responses: unknown[],
  originalKeywordSet: Set<string>,
): SerpExpansionResult {
  const new_keywords = extractSerpNewKeywords(responses, originalKeywordSet);
  const top_organic_urls = extractTopUrls(responses);
  return { new_keywords, top_organic_urls };
}
