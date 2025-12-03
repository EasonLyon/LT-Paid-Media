export interface ProjectInitInput {
  website: string;
  goal?: string;
  location?: string;
  state_list?: string | string[] | null;
  language?: string;
}

export interface NormalizedProjectInitInput {
  website: string;
  goal: string;
  location: string;
  state_list: string[] | null;
  language: string;
}

export interface KeywordCategoryInfo {
  category_level_1:
    | "core_product_keywords"
    | "problem_symptom_keywords"
    | "use_case_segment_keywords"
    | "brand_competitor_keywords"
    | "modifier_dimensions_keywords";
  category_level_2:
    | "core_phrases"
    | "synonyms_variants"
    | "problem_phrases"
    | "question_phrases"
    | "segment_name"
    | "your_brand"
    | "competitors"
    | "location_modifiers"
    | "price_modifiers"
    | "urgency_modifiers";
  segment_name?: string | null;
}

export type KeywordCategoryMap = Record<string, KeywordCategoryInfo>;

export interface MonthlySearchEntry {
  year: number;
  month: number;
  search_volume: number | null;
}

export interface EnrichedKeywordRecord {
  keyword: string;
  projectid: string;
  api_job_id: string;
  spell: string | null;
  location_code: number;
  language_code: string;
  search_partners: boolean | null;
  competition: string | null;
  competition_index: number | null;
  search_volume: number | null;
  avg_monthly_searches: number | null;
  low_top_of_page_bid: number | null;
  high_top_of_page_bid: number | null;
  cpc: number | null;
  category_level_1: string | null;
  category_level_2: string | null;
  segment_name: string | null;
  monthly_searches: MonthlySearchEntry[] | null;
}

export interface SiteKeywordRecord {
  keyword: string;
  projectid: string;
  api_job_id: string;
  spell: string | null;
  location_code: number | null;
  language_code: string | null;
  search_partners: boolean | null;
  competition: string | null;
  competition_index: number | null;
  search_volume: number | null;
  avg_monthly_searches: number | null;
  low_top_of_page_bid: number | null;
  high_top_of_page_bid: number | null;
  cpc: number | null;
  monthly_searches: MonthlySearchEntry[] | null;
}

export interface UnifiedKeywordRecord {
  keyword: string;
  projectid: string;
  api_job_id: string | null;
  spell: string | null;
  location_code: number | null;
  language_code: string | null;
  search_partners: boolean | null;
  competition: string | null;
  competition_index: number | null;
  search_volume: number | null;
  avg_monthly_searches: number | null;
  low_top_of_page_bid: number | null;
  high_top_of_page_bid: number | null;
  cpc: number | null;
  monthly_searches: MonthlySearchEntry[] | null;
  category_level_1?: string | null;
  category_level_2?: string | null;
  segment_name?: string | null;
}

export interface TopOrganicUrl {
  rank_group: number;
  title: string;
  domain: string;
  url: string;
}

export interface SerpExpansionResult {
  new_keywords: string[];
  top_organic_urls: TopOrganicUrl[];
}

export interface SupabaseKeywordRow {
  id: number;
  created_at: string;
  updated_at: string | null;
  keyword: string;
  projectid: string;
  api_job_id: string | null;
  spell: string | null;
  location_code: number | null;
  language_code: string | null;
  search_partners: boolean | null;
  competition: string | null;
  competition_index: number | null;
  search_volume: number | null;
  avg_monthly_searches: number | null;
  low_top_of_page_bid: number | null;
  high_top_of_page_bid: number | null;
  cpc: number | null;
  category_level_1: string | null;
  category_level_2: string | null;
  segment_name: string | null;
  monthly_searches: MonthlySearchEntry[] | Record<string, unknown> | null;
}

export interface InitialKeywordJson {
  core_product_keywords?: {
    core_phrases?: string[];
    synonyms_variants?: string[];
  };
  problem_symptom_keywords?: {
    problem_phrases?: string[];
    question_phrases?: string[];
  };
  use_case_segment_keywords?: Array<{
    segment_name?: string;
    keywords?: string[];
  }>;
  brand_competitor_keywords?: {
    your_brand?: string[];
    competitors?: string[];
  };
  modifier_dimensions_keywords?: {
    location_modifiers?: {
      keywords?: string[];
      locations?: string[];
    };
    price_modifiers?: {
      cheap_affordable?: string[];
      premium_quality?: string[];
    };
    urgency_modifiers?: string[];
  };
}

export interface DataForSeoSearchVolumeItem {
  keyword: string;
  spell?: string | null;
  location_code?: number;
  language_code?: string;
  search_partners?: boolean | null;
  competition?: string | null;
  competition_index?: number | null;
  search_volume?: number | null;
  low_top_of_page_bid?: number | null;
  high_top_of_page_bid?: number | null;
  cpc?: number | null;
  monthly_searches?: MonthlySearchEntry[] | null;
}

export interface DataForSeoSearchVolumeTaskResult {
  items?: DataForSeoSearchVolumeItem[];
  location_code?: number;
  language_code?: string;
}

export interface DataForSeoSearchVolumeTask {
  result?: DataForSeoSearchVolumeTaskResult[];
  data?: {
    location_code?: number;
    language_code?: string;
  };
}

export interface DataForSeoSearchVolumeResponse {
  id?: string;
  tasks?: DataForSeoSearchVolumeTask[];
  result?: DataForSeoSearchVolumeTaskResult[];
  data?: {
    location_code?: number;
    language_code?: string;
  };
}
