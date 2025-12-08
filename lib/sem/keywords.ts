import { InitialKeywordJson, KeywordCategoryInfo, KeywordCategoryMap } from "@/types/sem";

export function isValidKeyword(kw: string): boolean {
  const trimmed = kw.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 80) return false;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 10) return false;
  return true;
}

// Prefer Unicode-aware cleaning, but fall back to ASCII-only if the runtime
// does not support Unicode property escapes (avoids "Range out of order" errors).
const searchVolumeSanitizePattern: RegExp = (() => {
  try {
    return new RegExp("[^\\p{L}\\p{N}\\s'+\\-.,/&()]", "gu");
  } catch {
    return /[^A-Za-z0-9\s'+\-.,/&()]/g;
  }
})();

export function sanitizeKeywordForSearchVolume(kw: string): string {
  return kw.replace(searchVolumeSanitizePattern, " ").replace(/\s+/g, " ").trim();
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

type AddKeywordFn = (kw: string, info: KeywordCategoryInfo) => void;

function addArray(arr: string[] | undefined, info: KeywordCategoryInfo, add: AddKeywordFn) {
  if (!arr) return;
  for (const kw of arr) {
    if (!kw) continue;
    add(kw, info);
  }
}

export function flattenKeywordsWithCategories(initialJson: InitialKeywordJson): {
  keywords: string[];
  categoryMap: KeywordCategoryMap;
} {
  const keywords: string[] = [];
  const categoryMap: KeywordCategoryMap = {};

  const add: AddKeywordFn = (kw, info) => {
    const trimmed = kw.trim();
    if (!trimmed) return;
    if (categoryMap[trimmed]) return;
    keywords.push(trimmed);
    categoryMap[trimmed] = { ...info };
  };

  addArray(initialJson.core_product_keywords?.core_phrases, {
    category_level_1: "core_product_keywords",
    category_level_2: "core_phrases",
    segment_name: null,
  }, add);

  addArray(initialJson.core_product_keywords?.synonyms_variants, {
    category_level_1: "core_product_keywords",
    category_level_2: "synonyms_variants",
    segment_name: null,
  }, add);

  addArray(initialJson.problem_symptom_keywords?.problem_phrases, {
    category_level_1: "problem_symptom_keywords",
    category_level_2: "problem_phrases",
    segment_name: null,
  }, add);

  addArray(initialJson.problem_symptom_keywords?.question_phrases, {
    category_level_1: "problem_symptom_keywords",
    category_level_2: "question_phrases",
    segment_name: null,
  }, add);

  if (initialJson.use_case_segment_keywords) {
    for (const segment of initialJson.use_case_segment_keywords) {
      const segName = segment.segment_name ?? null;
      addArray(segment.keywords, {
        category_level_1: "use_case_segment_keywords",
        category_level_2: "segment_name",
        segment_name: segName,
      }, add);
    }
  }

  addArray(initialJson.brand_competitor_keywords?.your_brand, {
    category_level_1: "brand_competitor_keywords",
    category_level_2: "your_brand",
    segment_name: null,
  }, add);

  addArray(initialJson.brand_competitor_keywords?.competitors, {
    category_level_1: "brand_competitor_keywords",
    category_level_2: "competitors",
    segment_name: null,
  }, add);

  addArray(initialJson.modifier_dimensions_keywords?.location_modifiers?.keywords, {
    category_level_1: "modifier_dimensions_keywords",
    category_level_2: "location_modifiers",
    segment_name: null,
  }, add);

  addArray(initialJson.modifier_dimensions_keywords?.price_modifiers?.cheap_affordable, {
    category_level_1: "modifier_dimensions_keywords",
    category_level_2: "price_modifiers",
    segment_name: null,
  }, add);

  addArray(initialJson.modifier_dimensions_keywords?.price_modifiers?.premium_quality, {
    category_level_1: "modifier_dimensions_keywords",
    category_level_2: "price_modifiers",
    segment_name: null,
  }, add);

  addArray(initialJson.modifier_dimensions_keywords?.urgency_modifiers, {
    category_level_1: "modifier_dimensions_keywords",
    category_level_2: "urgency_modifiers",
    segment_name: null,
  }, add);

  return { keywords, categoryMap };
}

export function collectAllOriginalKeywords(initialJson: InitialKeywordJson): string[] {
  return flattenKeywordsWithCategories(initialJson).keywords;
}
