# SEM Keyword Pipeline – Source of Truth

> This file is the canonical spec for the SEM automation project.
> All code and TODOs should follow this document unless explicitly updated.

---

## 0. Global Conventions (Apply to Whole Project)

1. **Progress logging**
    - At the **start and end of every process/task**, no matter how small, log a message to the terminal to show that it is running or has completed.
    - For loops over arrays/objects, use a progress bar.
2. **Environment variables**
    - All required API keys and tokens are stored in a `.env` file at the project root.
    - Example (not exhaustive):
        - `OPENAI_API_KEY=<your-key>`
        - `GOOGLE_ADS_DEVELOPER_TOKEN=<ads-dev-token>`
        - `GOOGLE_OAUTH_CLIENT_ID=<oauth-client-id>`
        - `GOOGLE_OAUTH_CLIENT_SECRET=<oauth-client-secret>`
        - `TOKEN_ENCRYPTION_KEY=<32+ chars>`
3. **Tech stack**
    - The project uses **Next.js** as the base framework.
    - Both **frontend and backend** must be written in **TypeScript**.
    - The current directory is already initialized as a Next.js project.
4. **Progress bar library**
    - Use `node-console-progress-bar-tqdm` (or a similar tqdm-like library) to draw a progress bar in the terminal when looping through arrays/objects in Node.js scripts or backend tasks.

---

## 1. Step 1 – User Input & Initial OpenAI Call

### 1.1 User Input Fields

The user must provide the following fields (e.g. via a form in the frontend or an API request body):

1. **`website` (string, required)**
    - Description: The official website URL of the business.
    - Example: `"https://www.example.com"`
2. **`goal` (string, optional, default = `"Lead"` )**
    - Description: The main marketing goal for this project.
    - Example: `"Lead"`, `"Sales"`, `"Traffic"`.
3. **`location` (string, optional, default = `"Malaysia"` )**
    - Description: Primary country/region to target.
    - Example: `"Malaysia"`.
4. **`state_list` (string or string[], optional, default = `null`)**
    - Description: Specific states/regions within the country, if needed.
    - Example: `"Selangor"` or `["Selangor", "Kuala Lumpur"]`.
    - If not provided, this should be treated as `null` (no state filtering).
5. **`language` (string, optional, default = `"English"` )**
    - Description: Preferred language for keyword generation.
    - This will map to the `language_list` variable in the OpenAI prompt.

You can define a TypeScript type like:

```tsx
export interface ProjectInitInput {
  website: string;           // required
  goal?: string;             // default "Lead"
  location?: string;         // default "Malaysia"
  state_list?: string | string[] | null; // default null
  language?: string;         // default "English"
}

```

### 1.2 OpenAI Call (Responses API with Prompt Object)

After receiving and normalizing the user input (applying defaults), the backend will call OpenAI’s Responses API using a **Prompt Object**.

### 1.2.1 OpenAI client setup (TypeScript)

```tsx
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

```

### 1.2.2 Request: use Prompt Object with variables

Replace the example values with the actual user input:

```tsx
const response = await openai.responses.create({
  prompt: {
    id: "pmpt_69281164f154819390a5306a4c2f25f00d646540e90ff078",
    version: "4",
    variables: {
      website: normalizedInput.website,
      goal: normalizedInput.goal ?? "Lead",
      location: normalizedInput.location ?? "Malaysia",
      state_list: normalizedInput.state_list ?? null,
      language_list: normalizedInput.language ?? "English",
    },
  },
});

```

> Note: normalizedInput is the user input after applying defaults.
> 

The OpenAI response will contain **JSON** content in the shape described in section **1.4**.

---

### 1.3 Output Folder & Project ID Strategy

After receiving the JSON from OpenAI, the system must:

1. **Define an output root folder**
    - Example: `./output` (relative to the project root).
2. **Generate a unique `projectId`** using date-time plus a 3-digit index:
    - Format: `YYYYMMDD-HH-XXX`
        - `YYYY` = 4-digit year
        - `MM` = 2-digit month
        - `DD` = 2-digit day
        - `HH` = 2-digit hour (24h format)
        - `XXX` = 3-digit incremental ID for that hour (`001`, `002`, `003`, …) to avoid duplicates.
    - Example: `20251202-10-001`
3. **Use `projectId` as the canonical ID for the entire workflow**
    - This `projectId` will be used throughout all subsequent steps.
    - It must be passed around to any further processes that read/write data for this project.
4. **Create a dedicated subfolder for each project**
    - Path: `./output/<projectId>/`
    - Example: `./output/20251202-10-001/`
5. **File naming inside the project folder**
    - Every file in the project folder starts with a 2-digit index, then a hyphen, then a descriptive name.
    - Example:
        - `01-openai-initial-keywords.json`
        - `02-serp-results.json`
        - `03-aggregated-keywords.json`
    - The first JSON returned by OpenAI in this step should be stored as:
        - `01-<descriptive-name>.json` (actual name can be defined later, e.g. `01-initial-keyword-clusters.json`).

---

### 1.4 Example Shape of OpenAI JSON Response

The OpenAI response body (after extracting the JSON content) will look roughly like this (mock example, real response will be longer):

```json
{
  "core_product_keywords": {
    "core_phrases": [
      "confinement centre KL",
      "confinement centre Kuala Lumpur"
    ],
    "synonyms_variants": [
      "postnatal retreat KL",
      "pusat rawatan selepas bersalin"
    ]
  },
  "problem_symptom_keywords": {
    "problem_phrases": [
      "no one help newborn",
      "产后没人照顾妈妈"
    ],
    "question_phrases": [
      "how to choose confinement centre",
      "best postnatal care in KL"
    ]
  },
  "use_case_segment_keywords": [
    {
      "segment_name": "Chinese-speaking mothers",
      "keywords": [
        "吉隆坡月子中心推荐",
        "华人月子中心吉隆坡"
      ]
    },
    {
      "segment_name": "Muslim-friendly pork-free",
      "keywords": [
        "pork free confinement centre",
        "Muslim friendly confinement centre"
      ]
    },
    {
      "segment_name": "City working mothers",
      "keywords": [
        "confinement centre near Mid Valley",
        "confinement centre near hospital"
      ]
    },
    {
      "segment_name": "First-time and c section mothers",
      "keywords": [
        "confinement care first time mom",
        "first time mom help KL"
      ]
    }
  ],
  "brand_competitor_keywords": {
    "your_brand": [
      "kimporo",
      "zell v kimporo confinement"
    ],
    "competitors": [
      "the nesting place confinement",
      "confinement centre Damansara"
    ]
  },
  "modifier_dimensions_keywords": {
    "location_modifiers": {
      "keywords": [
        "confinement centre Kuala Lumpur",
        "月子中心蕉赖"
      ],
      "locations": [
        "Kuala Lumpur",
        "Cheras"
      ]
    },
    "price_modifiers": {
      "cheap_affordable": [
        "cheap confinement centre KL",
        "月子中心优惠"
      ],
      "premium_quality": [
        "luxury confinement centre KL",
        "专业产后护理中心"
      ]
    },
    "urgency_modifiers": [
      "book confinement centre today",
      "secure confinement room now"
    ]
  }
}

```

Later steps in the project can define TypeScript interfaces for this JSON shape (e.g. `CoreProductKeywords`, `ProblemSymptomKeywords`, etc.), but for now the important part is:

- This full JSON object is saved to disk in the **project’s subfolder** under a file named like `01-<something>.json`.
- The file is associated with the `projectId` generated in this step.

---

## 2. Step 2 – Enrich Keywords with Search Volume (DataForSEO)

### 2.1 Source of Keywords

Input for this step:

- `projectId` (string): generated in Step 1, e.g. `"20251202-10-001"`.
- Initial keyword JSON file from Step 1, stored as something like:
    - `./output/<projectId>/01-initial-keyword-clusters.json`.

This file contains structured keyword groups like:

- `core_product_keywords.core_phrases[]`
- `core_product_keywords.synonyms_variants[]`
- `problem_symptom_keywords.problem_phrases[]`
- `problem_symptom_keywords.question_phrases[]`
- `use_case_segment_keywords[].segment_name` + `keywords[]`
- `brand_competitor_keywords.your_brand[]`
- `brand_competitor_keywords.competitors[]`
- `modifier_dimensions_keywords.location_modifiers.keywords[]`
- `modifier_dimensions_keywords.price_modifiers.cheap_affordable[]`
- `modifier_dimensions_keywords.price_modifiers.premium_quality[]`
- `modifier_dimensions_keywords.urgency_modifiers[]`

### 2.1.1 Collect all keywords into a flat list

From the initial JSON:

1. Traverse all the above arrays and collect **every keyword string** into a **flat array**.
2. While collecting, build a **mapping object** from keyword → category metadata:

```tsx
interface KeywordCategoryInfo {
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
  segment_name?: string | null; // only when category_level_2 === "segment_name"
}

type KeywordCategoryMap = Record<string, KeywordCategoryInfo>;

```

- For `use_case_segment_keywords`, set:
    - `category_level_1 = "use_case_segment_keywords"`
    - `category_level_2 = "segment_name"`
    - `segment_name = <segment_name from JSON>`
- For other paths, set `segment_name = null`.

This mapping will later be used to keep category info attached to each keyword record.

1. **Deduplicate** keywords:
    - If the same keyword appears in multiple places, keep **one keyword** in the flat list but **preserve all relevant category mappings if needed**.
    - For simplicity: if the same keyword appears in multiple categories, you can choose:
        - **Option A:** first occurrence wins, or
        - **Option B:** pick the “highest priority” category (you can define later)
    - For now, assume **first occurrence wins**.
2. **Validation rules before sending to DataForSEO**:
    - **Max total keywords per API call:** 1000
    - **Max characters per keyword:** 80
    - **Max words per keyword phrase:** 10

Implementation notes:

- Trim whitespace on each keyword.
- Discard or log keywords that violate character/word limits, e.g.:

```tsx
function isValidKeyword(kw: string): boolean {
  const trimmed = kw.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 80) return false;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 10) return false;
  return true;
}

```

- Only pass valid keywords to DataForSEO.
- If more than 1000 valid keywords exist, **split into multiple batches** (e.g. up to 1000 per request).

You *may* also create a comma-separated string of all keywords (for logging or debugging), but the actual request body to DataForSEO must use a `keywords: string[]` array.

---

### 2.2 DataForSEO Request (Search Volume API)

Use the DataForSEO Search Volume endpoint to fetch search volume and monthly search data for each keyword.

**Endpoint:**

- `POST https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live`

**Auth:**

- Basic auth with your real DataForSEO credentials.
- Store credentials in `.env` and not in source code, e.g.:

```
DATAFORSEO_LOGIN=your_login
DATAFORSEO_PASSWORD=your_password

```

**Request body schema (per batch):**

```tsx
interface DataForSEOSearchVolumeTask {
  location_code: number;  // e.g. 2458
  keywords: string[];     // flat array of all valid keywords
  sort_by: "search_volume";
}

type DataForSEOSearchVolumeRequestBody = DataForSEOSearchVolumeTask[];

```

Concrete example (TypeScript + axios or fetch):

```tsx
const tasks: DataForSEOSearchVolumeRequestBody = [
  {
    location_code: 2458,         // Malaysia
    keywords: validKeywordsBatch, // up to 1000 items
    sort_by: "search_volume",
  },
];

const response = await axios.post(
  "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live",
  tasks,
  {
    auth: {
      username: process.env.DATAFORSEO_LOGIN!,
      password: process.env.DATAFORSEO_PASSWORD!,
    },
    headers: {
      "content-type": "application/json",
    },
  },
);

```

- Use **progress logging + progress bar** when processing multiple batches:
    - e.g. `node-console-progress-bar-tqdm` while looping over `batches`.

---

### 2.3 Save Raw DataForSEO Response (File 02)

DataForSEO returns data with a structure like:

```json
{
  "id": "12011045-1164-0367-0000-734fb7e912a4",
  "status_code": 20000,
  "status_message": "Ok.",
  "time": "3.2299 sec.",
  "cost": 0.075,
  "result_count": 5,
  "path": [
    "v3",
    "keywords_data",
    "google_ads",
    "search_volume",
    "live"
  ],
  "data": {
    "api": "keywords_data",
    "function": "search_volume",
    "se": "google_ads",
    "keywords": [
      "confinement centre KL",
      "luxury confinement centre KL"
    ],
    "location_code": 2458,
    "language_code": "en",
    "sort_by": "search_volume"
  },
  "result": [
    {
      "keyword": "confinement centre KL",
      "spell": "confinement centre kl",
      "location_code": 2458,
      "language_code": "en",
      "search_partners": false,
      "competition": "LOW",
      "competition_index": 27,
      "search_volume": 880,
      "low_top_of_page_bid": 0.22,
      "high_top_of_page_bid": 0.95,
      "cpc": 0.88,
      "monthly_searches": [
        { "year": 2025, "month": 10, "search_volume": 720 },
        { "year": 2025, "month": 9, "search_volume": 1300 }
      ]
    },
    {
      "keyword": "luxury confinement centre KL",
      "spell": null,
      "location_code": 2458,
      "language_code": "en",
      "search_partners": false,
      "competition": null,
      "competition_index": null,
      "search_volume": null,
      "low_top_of_page_bid": null,
      "high_top_of_page_bid": null,
      "cpc": null,
      "monthly_searches": null
    }
  ]
}

```

For **each API call (batch)**:

1. Store the **raw response JSON** in the project’s folder as file index `02`.
    - If you have multiple batches, you can:
        - Either merge them into a single combined JSON and store as:
            - `./output/<projectId>/02-dataforseo-search-volume-raw.json`
        - Or store multiple files (`02a-...`, `02b-...`), but **simplest** is to merge into one array and save once.
2. Include:
    - Raw `tasks` / `result` objects
    - Top-level `"id"` from DataForSEO → used later as `api_job_id`.

---

### 2.4 Enriched Keyword JSON (File 03)

Now we transform the raw DataForSEO `result` objects into a normalized keyword-level JSON, adding:

- `avg_monthly_searches` (computed)
- `projectid`
- Category info (`category_level_1`, `category_level_2`, `segment_name`)
- Preserving `monthly_searches` array

### 2.4.1 Compute `avg_monthly_searches`

For each keyword in `result`:

- If `monthly_searches` is **not null** and is an array:
    
    ```tsx
    interface MonthlySearchEntry {
      year: number;
      month: number;
      search_volume: number | null;
    }
    
    function computeAvgMonthlySearches(monthly_searches: MonthlySearchEntry[] | null): number | null {
      if (!monthly_searches) return null;
      const valid = monthly_searches.filter(m => m.search_volume !== null);
      if (valid.length === 0) return null;
      const sum = valid.reduce((acc, m) => acc + (m.search_volume ?? 0), 0);
      return sum / valid.length;
    }
    
    ```
    
- If `monthly_searches` is `null` or there are no valid `search_volume` entries, set:
    - `avg_monthly_searches = null`.

### 2.4.2 Attach project & category info

For each keyword result:

1. Look up its category info from `KeywordCategoryMap` (by exact keyword string).
2. If the keyword is not found in the map (e.g. extra keyword added later), set:
    - `category_level_1 = null`
    - `category_level_2 = null`
    - `segment_name = null`
        
        (or handle as you prefer).
        
3. Attach:
    - `projectid = projectId`
    - `api_job_id = <top-level id from DataForSEO response>`
        - If you had multiple batches with different IDs, you can store the corresponding ID per batch.

### 2.4.3 Shape of enriched keyword object

Define an enriched keyword shape for the search-volume output:

```tsx
interface EnrichedKeywordRecord {
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

```

Create an array:

```tsx
type EnrichedKeywordArray = EnrichedKeywordRecord[];

```

Then:

1. Save this enriched array as **File 03** in the project folder, e.g.:
    - `./output/<projectId>/03-keywords-enriched-with-search-volume.json`.

### 2.5 Filter by Average Monthly Searches ≥ 100 (File 04)

After the enriched data is generated and stored:

1. Read back the enriched keyword JSON file:
    - `./output/<projectId>/03-keywords-enriched-with-search-volume.json`.
2. Filter the array to keep only records where:
    
    ```tsx
    record.avg_monthly_searches !== null &&
    record.avg_monthly_searches >= 100;
    
    ```
    
3. Discard or ignore rows with `avg_monthly_searches < 100` or `null`.
4. Save the filtered array as a **new JSON file** in the same project folder, e.g.:
    - `./output/<projectId>/04-keywords-avg-search-gte-100.json`.
5. Log the counts:
    - Total keywords
    - Count with `avg_monthly_searches >= 100`
    - Count filtered out

---

## 3. Step 3 – SERP Expansion for Core & Segment Keywords

### 3.1 Input for This Step

This step starts **after** Step 2, using:

1. `projectId` (string)
    - Same ID as before, e.g. `"20251202-10-001"`.
2. Filtered keyword JSON from Step 2:
    - File path example:
        
        `./output/<projectId>/04-keywords-avg-search-gte-100.json`
        
    - This file contains an array of `EnrichedKeywordRecord` (see Step 2) with:
        - `keyword`
        - `avg_monthly_searches >= 100`
        - `category_level_1`
        - `category_level_2`
        - `segment_name` (for segment keywords)
3. **Scope of keywords for SERP expansion**
    
    From this JSON, **only use** keywords where:
    
    - `category_level_1 = "core_product_keywords"`
        
        OR
        
    - `category_level_1 = "use_case_segment_keywords"`
    
    These are your **seed keywords** for SERP expansion.
    
    ```tsx
    const seedKeywords = allKeywords.filter(
      k =>
        k.category_level_1 === "core_product_keywords" ||
        k.category_level_1 === "use_case_segment_keywords",
    );
    
    ```
    
4. **Original keyword set** (for deduping later)
    
    Build a `Set<string>` containing all original keywords from Step 1 (across all categories), so you can later exclude them from `new_keywords`:
    
    ```tsx
    const originalKeywordSet = new Set<string>(
      allKeywordsFromStep1.map(k => k.keyword.trim()),
    );
    
    ```
    

---

### 3.2 DataForSEO SERP Organic Advanced Request

For **each seed keyword**, you will call the SERP API:

**Endpoint:**

- `POST https://api.dataforseo.com/v3/serp/google/organic/live/advanced`

**Auth:**

- Basic auth using DataForSEO credentials from `.env`:

```
DATAFORSEO_LOGIN=your_login
DATAFORSEO_PASSWORD=your_password

```

**Request body schema (per keyword):**

```tsx
interface SerpTask {
  keyword: string;
  location_code: number;          // e.g. 2458 (Malaysia)
  device: "desktop" | "mobile";   // here: "mobile"
  os: "windows" | "macos" | "android" | "ios"; // here: "android"
  depth: number;                  // e.g. 10 (number of results pages/blocks)
  people_also_ask_click_depth: number; // e.g. 1
}

type SerpRequestBody = SerpTask[];

```

**Example (TypeScript + axios):**

```tsx
const tasks: SerpRequestBody = [
  {
    keyword: seedKeyword,       // e.g. "confinement centre Kuala Lumpur"
    location_code: 2458,
    device: "mobile",
    os: "android",
    depth: 10,
    people_also_ask_click_depth: 1,
  },
];

const response = await axios.post(
  "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
  tasks,
  {
    auth: {
      username: process.env.DATAFORSEO_LOGIN!,
      password: process.env.DATAFORSEO_PASSWORD!,
    },
    headers: {
      "content-type": "application/json",
    },
  },
);

```

- Use **progress logging + tqdm-like progress bar** when looping across `seedKeywords`.

---

### 3.3 Expected SERP Response Shape

For each API call, the response structure is roughly:

```tsx
interface SerpResponse {
  tasks: Array<{
    id: string;
    status_code: number;
    status_message: string;
    result?: Array<{
      keyword: string;
      items: SerpItem[];
      // ...other fields
    }>;
  }>;
}

type SerpItem =
  | SerpOrganicItem
  | SerpPeopleAlsoAskItem
  | SerpPeopleAlsoSearchBlock
  | any; // (you can refine further)

interface SerpOrganicItem {
  type: "organic";
  rank_group: number;
  domain: string;
  title: string;
  url: string;
  description?: string | null;
  // ...other fields
}

interface SerpPeopleAlsoAskItem {
  type: "people_also_ask";
  items?: Array<{
    title?: string;        // question text
    // maybe answer / source_url etc.
  }>;
}

interface SerpPeopleAlsoSearchBlock {
  type: "people_also_search";
  items?: Array<{
    title?: string;
  }>;
}

```

For this step, we only care about:

- `result[0].keyword` – the seed keyword.
- `result[0].items[]` – the SERP items.

Specifically:

- For **organic results** (`type === "organic"`):
    - `rank_group`
    - `domain`
    - `title`
    - `url`
    - `description` (optional)
- For **People Also Ask** (`type === "people_also_ask"`):
    - `items[].title` (question text)
    - (optionally `answer`, `source_url` if needed later)
- For **People Also Search** (`type === "people_also_search"` or similar):
    - `items[].title` (related queries)

> Exact field names may vary slightly depending on DataForSEO’s current schema; the implementation should be defensive (check for existence before reading).
> 

---

### 3.4 New Keyword Extraction Rules

For each SERP response (per seed keyword):

1. Initialize a local list `newKeywordsForThisSeed: string[] = []`.
2. From **People Also Ask** blocks (`type === "people_also_ask"`):
    - For each `item` in `items`:
        - If `item.title` is a non-empty string:
            - Normalize (trim, collapse whitespace).
            - Add to `newKeywordsForThisSeed`.
3. From **People Also Search** blocks (if present, `type === "people_also_search"` or similar):
    - For each `item` in `items`:
        - If `item.title` is a non-empty string:
            - Normalize.
            - Add to `newKeywordsForThisSeed`.
4. (Optional) From **Organic Results** (`type === "organic"`):
    - You may choose **not** to extract keywords from organic titles/descriptions to keep logic simple.
    - If you decide to use organic titles:
        - For each organic item:
            - Take `title`, normalize, and treat it as a candidate keyword phrase.
            - Add to `newKeywordsForThisSeed`.
5. Deduplicate at the **per-seed** level:
    - Use a `Set<string>` within that seed processing if desired.
6. **Global dedupe and original keyword exclusion**:
    - Maintain a **global `Set<string>`** called e.g. `globalNewKeywordSet`.
    - For each candidate `kw` from this seed:
        - Ignore if `kw` is in `originalKeywordSet`.
        - Ignore if `kw` already exists in `globalNewKeywordSet`.
        - Otherwise, add to `globalNewKeywordSet`.

At the end of processing **all** seed keywords, `globalNewKeywordSet` will contain all unique new keywords discovered from SERP, excluding the original ones.

---

### 3.5 Top Organic URL Extraction Rules

For each SERP response (per seed keyword):

1. From `items[]`, filter to those with `type === "organic"`.
2. Keep only items with `rank_group` in **1–3** (inclusive):
    
    ```tsx
    const topOrganicItems = items.filter(
      (item) => item.type === "organic" && item.rank_group >= 1 && item.rank_group <= 3,
    );
    
    ```
    
3. Map each item to a normalized object:
    
    ```tsx
    interface TopOrganicUrl {
      rank_group: number;
      title: string;
      domain: string;
      url: string;
    }
    
    ```
    
4. Maintain a **global array** and **global set** for URL deduplication:
    
    ```tsx
    const topOrganicUrls: TopOrganicUrl[] = [];
    const topOrganicUrlSet = new Set<string>(); // dedupe by URL
    
    ```
    
5. For each `topOrganicItem`:
    - If `item.url` is missing or empty, skip.
    - If `topOrganicUrlSet` already contains `item.url`, skip.
    - Otherwise:
        - Add `item.url` to `topOrganicUrlSet`.
        - Push a new object:
            
            ```tsx
            topOrganicUrls.push({
              rank_group: item.rank_group,
              title: item.title ?? "",
              domain: item.domain ?? "",
              url: item.url,
            });
            
            ```
            

You can optionally add the `seed_keyword` to this structure if you want to know which seed generated the URL, but your requested final output doesn’t require it.

---

### 3.6 Cumulative Results & Final JSON Structure

Throughout the loop over `seedKeywords`:

- `globalNewKeywordSet` keeps collecting unique new keywords.
- `topOrganicUrls` keeps collecting unique top URLs (rank_group 1–3).

After all seed keywords are processed:

1. Convert `globalNewKeywordSet` to an array:
    
    ```tsx
    const new_keywords = Array.from(globalNewKeywordSet);
    
    ```
    
2. Build the final JSON object:
    
    ```tsx
    const finalSerpExpansionResult = {
      new_keywords,      // string[]
      top_organic_urls: topOrganicUrls, // TopOrganicUrl[]
    };
    
    ```
    
3. Save this object to a new file in the project folder, e.g.:
    - `./output/<projectId>/05-serp-new-keywords-and-top-urls.json`
    
    with content like:
    
    ```json
    {
      "new_keywords": [
        "keyword_1",
        "keyword_2"
      ],
      "top_organic_urls": [
        {
          "rank_group": 1,
          "title": "Example Title",
          "domain": "example.com",
          "url": "https://example.com/page"
        }
      ]
    }
    
    ```
    
4. Log summary stats to the terminal:
    - Number of seed keywords processed.
    - Number of new keywords discovered (after dedupe & excluding originals).
    - Number of top organic URLs collected.

---

## 4. Step 4 – Expand via “Keywords for Site” from Top Organic Websites

### 4.1 Input for This Step

From **Step 3**, we already have:

- `projectId` (string), e.g. `"20251202-10-001"`.
- SERP expansion result file, e.g.:
    
    `./output/<projectId>/05-serp-new-keywords-and-top-urls.json`
    

Shape of that file:

```tsx
interface TopOrganicUrl {
  rank_group: number;
  title: string;
  domain: string;
  url: string;
}

interface SerpExpansionResult {
  new_keywords: string[];       // from PAA / PAS etc.
  top_organic_urls: TopOrganicUrl[];
}

```

For this step we use:

- `top_organic_urls` → extract domains / targets for `keywords_for_site`.

---

### 4.2 Determine Targets for `keywords_for_site`

From `top_organic_urls`:

1. **Extract target domains**
    - Use `domain` if provided by the SERP API (usually like `"littleprecious.com.my"`).
    - If `domain` is missing but `url` is present, parse the domain from `url`.
2. **Normalize domains**
    - Lowercase.
    - Strip leading `www.` if present.
    - Example:
        - `"https://www.LittlePrecious.com.my/xyz"` → `"littleprecious.com.my"`.
3. **Deduplicate domains**
    
    ```tsx
    const targetDomainSet = new Set<string>();
    
    for (const item of top_organic_urls) {
      const domain = normalizeDomain(item.domain || item.url);
      if (domain) targetDomainSet.add(domain);
    }
    
    const uniqueTargets = Array.from(targetDomainSet); // ["littleprecious.com.my", ...]
    
    ```
    
4. Optionally, you can **limit** the number of domains you process (e.g. top N) to control cost.

---

### 4.3 DataForSEO `keywords_for_site` Request

For each target domain, you call:

- `POST https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_site/live`

**Auth:**

- Basic auth with environment variables:

```
DATAFORSEO_LOGIN=your_login
DATAFORSEO_PASSWORD=your_password

```

**Request body schema:**

```tsx
interface KeywordsForSiteTask {
  target: string;        // domain or URL, e.g. "littleprecious.com.my"
  sort_by?: string;      // e.g. "search_volume"
}

type KeywordsForSiteRequestBody = KeywordsForSiteTask[];

```

**Example (TypeScript + axios):**

```tsx
import axios, { AxiosResponse } from "axios";

interface DataForSEOKeywordsForSiteResponse {
  status_code: number;
  status_message: string;
  id?: string;       // top-level job id
  tasks?: any[];     // we’ll refine below
}

async function fetchKeywordsForSiteForTarget(target: string) {
  const postData: KeywordsForSiteTask[] = [
    {
      target,
      sort_by: "search_volume",
    },
  ];

  const response: AxiosResponse<DataForSEOKeywordsForSiteResponse> = await axios({
    method: "post",
    url: "https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_site/live",
    auth: {
      username: process.env.DATAFORSEO_LOGIN!,
      password: process.env.DATAFORSEO_PASSWORD!,
    },
    data: postData,
    headers: {
      "content-type": "application/json",
    },
  });

  return response.data;
}

```

- Again, wrap the outer loop over `uniqueTargets` with **progress logging** and your `tqdm`like progress bar.

---

### 4.4 Expected Response Shape & Keyword Items

DataForSEO returns something like:

```json
{
  "status_code": 20000,
  "status_message": "Ok.",
  "id": "12011045-1164-0367-0000-734fb7e912a4",
  "tasks": [
    {
      "result": [
        {
          "items": [
            {
              "keyword": "confinement centre singapore",
              "location_code": null,
              "language_code": null,
              "search_partners": false,
              "competition": "HIGH",
              "competition_index": 67,
              "search_volume": 2400,
              "low_top_of_page_bid": 0.48,
              "high_top_of_page_bid": 1.39,
              "cpc": 1.38,
              "monthly_searches": [
                { "year": 2025, "month": 10, "search_volume": 2400 },
                { "year": 2025, "month": 9,  "search_volume": 1900 }
              ],
              "keyword_annotations": {
                "concepts": [
                  {
                    "name": "Non-Brands",
                    "concept_group": { "name": "Non-Brands", "type": "NON_BRAND" }
                  },
                  {
                    "name": "singapore",
                    "concept_group": { "name": "Country", "type": null }
                  }
                ]
              }
            },
            {
              "keyword": "confinement centre kuala lumpur",
              "location_code": null,
              "language_code": null,
              "search_partners": false,
              "competition": "LOW",
              "competition_index": 24,
              "search_volume": 1000,
              "low_top_of_page_bid": 0.24,
              "high_top_of_page_bid": 0.97,
              "cpc": 0.9,
              "monthly_searches": [
                { "year": 2025, "month": 10, "search_volume": 880 },
                { "year": 2025, "month": 9,  "search_volume": 1300 }
              ],
              "keyword_annotations": {
                "concepts": [
                  {
                    "name": "Non-Brands",
                    "concept_group": { "name": "Non-Brands", "type": "NON_BRAND" }
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  ]
}

```

Note:

- In this endpoint, there may **not** be a `spell` field.
    
    → You can set `spell = null` for this group.
    

---

### 4.5 Compute `avg_monthly_searches` for Keywords-for-Site

Use the same logic as in Step 2:

```tsx
interface MonthlySearchEntry {
  year: number;
  month: number;
  search_volume: number | null;
}

function computeAvgMonthlySearches(monthly_searches: MonthlySearchEntry[] | null | undefined): number | null {
  if (!monthly_searches) return null;
  const valid = monthly_searches.filter(m => m.search_volume !== null);
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, m) => acc + (m.search_volume ?? 0), 0);
  return sum / valid.length;
}

```

---

### 4.6 Normalize Keywords-for-Site Items into a JSON Array

For each domain’s response:

1. Extract the top-level `id` → `api_job_id`.
2. Traverse:
    
    ```tsx
    const tasks = response.tasks ?? [];
    for (const task of tasks) {
      const results = task.result ?? [];
      for (const r of results) {
        const items = r.items ?? [];
        // each item is a keyword record as per schema
      }
    }
    
    ```
    
3. For each `item` (keyword object), build a normalized record with the required fields:

```tsx
interface SiteKeywordRecord {
  keyword: string;
  projectid: string;
  api_job_id: string;
  spell: string | null;            // this endpoint usually doesn't provide `spell` → set null
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

```

Populate:

```tsx
const record: SiteKeywordRecord = {
  keyword: item.keyword,
  projectid,                 // from current project context
  api_job_id: response.id ?? "",

  spell: null,
  location_code: item.location_code ?? null,
  language_code: item.language_code ?? null,
  search_partners: item.search_partners ?? null,
  competition: item.competition ?? null,
  competition_index: item.competition_index ?? null,
  search_volume: item.search_volume ?? null,
  avg_monthly_searches: computeAvgMonthlySearches(item.monthly_searches ?? null),
  low_top_of_page_bid: item.low_top_of_page_bid ?? null,
  high_top_of_page_bid: item.high_top_of_page_bid ?? null,
  cpc: item.cpc ?? null,
  monthly_searches: item.monthly_searches ?? null,
};

```

Collect all such records from all domains into a single array, e.g.:

```tsx
const siteKeywords: SiteKeywordRecord[] = [];

```

---

### 4.7 Save Keywords-for-Site JSON

After looping all target domains:

1. Save the full `siteKeywords` array into a new project file, e.g.:
    - `./output/<projectId>/06-site-keywords-from-top-domains.json`
2. Later, you can also insert these records into Supabase using the same columns as defined:

| Column | Type |
| --- | --- |
| `keyword` | `text` |
| `projectid` | `text` |
| `api_job_id` | `text` |
| `spell` | `text` |
| `location_code` | `int4` |
| `language_code` | `text` |
| `search_partners` | `bool` |
| `competition` | `text` |
| `competition_index` | `int4` |
| `search_volume` | `int4` |
| `avg_monthly_searches` | `float8` |
| `low_top_of_page_bid` | `float4` |
| `high_top_of_page_bid` | `float4` |
| `cpc` | `float4` |
| `monthly_searches` | `jsonb` |

> For this group, category columns (category_level_1, etc.) can remain null since these keywords come from competitor/related sites rather than your predefined taxonomy.
> 

---

## 5. Step 5 – Combine All Keyword Groups & Deduplicate (Case-Insensitive)

By now, you conceptually have **three groups of keywords**:

1. **Original from OpenAI**
    - After enrichment with search volume (Step 2).
    - Stored in e.g. `03-keywords-enriched-with-search-volume.json`.
2. **From People Also Ask / related SERP queries**
    - Extracted as `new_keywords` in Step 3 (`05-serp-new-keywords-and-top-urls.json`).
    - (Optionally, you can run these through the same `search_volume` pipeline to get full metric records like group 1.)
3. **From organic website keywords (keywords_for_site)**
    - Built in Step 4.
    - Stored in `06-site-keywords-from-top-domains.json`.

### 5.1 Normalize into a Common Shape

To combine and dedupe, it’s easiest if all three groups share a common interface, e.g.:

```tsx
interface UnifiedKeywordRecord {
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

  // optional extra fields (for original group) can still be present, but they won’t affect dedupe
  category_level_1?: string | null;
  category_level_2?: string | null;
  segment_name?: string | null;
}

```

- Group 1: map your enriched records into this type.
- Group 2: if you later fetch search volume for PAA keywords, also map them here.
- Group 3: map `SiteKeywordRecord` directly into this type.

### 5.2 Case-Insensitive Deduplication

You want to:

> “Combine all of them together and remove duplicated keyword in lower letter.”
> 

Implementation:

```tsx
const allRecords: UnifiedKeywordRecord[] = [
  ...originalKeywordsRecords,
  ...paaKeywordRecords,     // if/when enriched
  ...siteKeywordsRecords,
];

const dedupedByKeyword = new Map<string, UnifiedKeywordRecord>();

for (const rec of allRecords) {
  const key = rec.keyword.trim().toLowerCase(); // case-insensitive, trim spaces
  if (!dedupedByKeyword.has(key)) {
    dedupedByKeyword.set(key, rec);
  } else {
    // If you want a merge policy, define it here.
    // For now, keep the first occurrence and ignore later duplicates.
  }
}

const finalCombinedKeywords = Array.from(dedupedByKeyword.values());

```

### 5.3 Save Final Combined JSON

Write this final combined array into a new file under the project folder, e.g.:

- `./output/<projectId>/07-all-keywords-combined-deduped.json`

Structure:

```json
[
  {
    "keyword": "confinement centre kl",
    "projectid": "20251202-10-001",
    "api_job_id": "12011045-...",
    "spell": "confinement centre kl",
    "location_code": 2458,
    "language_code": "en",
    "search_partners": false,
    "competition": "LOW",
    "competition_index": 27,
    "search_volume": 880,
    "avg_monthly_searches": 1010.0,
    "low_top_of_page_bid": 0.22,
    "high_top_of_page_bid": 0.95,
    "cpc": 0.88,
    "monthly_searches": [
      { "year": 2025, "month": 10, "search_volume": 720 },
      { "year": 2025, "month": 9,  "search_volume": 1300 }
    ],
    "category_level_1": "core_product_keywords",
    "category_level_2": "core_phrases",
    "segment_name": null
  }
  // ...many more
]

```

Also log to terminal:

- Total unique keywords after dedupe.
- Breakdown per source group (optional).

---

## Step 6 – Build Keyword Scoring JSON

From JSON file **index 07**, extract the keyword information and create a new JSON file **index 08**.

### 1. Extract core metrics

For all keywords, extract these three fields:

- `avg_monthly_searches` (or `search_volume`)
- `cpc`
- `competition_index`

These will be used to build:

- `volume_score`
- `cost_score`
- `difficulty_score`
- `ads_score`
- `tier`
- `paid_flag`
- `seo_flag`

---

### 2. Compute percentiles and clip extreme values

For each metric (**volume, CPC, competition_index**):

1. Collect all values across all keywords.
2. Compute:
    - `P5` (5th percentile)
    - `P95` (95th percentile)
3. For every keyword, **clip** the raw value into the [P5, P95] range:

```
clipped_x = min( max(x, P5), P95 )

```

Do this separately for:

- `volume_clipped`
- `cpc_clipped`
- `competition_clipped`

This step removes extreme outliers so they don’t distort the scoring.

---

### 3. Normalise each metric to 0–1

Now convert each clipped metric into a 0–1 score.

### 3.1 Volume score (higher volume = better)

Use the clipped volume and the P5/P95 used above:

```
volume_score = (volume_clipped - P5_volume) / (P95_volume - P5_volume)

```

- Result range: **0–1**
- Higher = more search demand

### 3.2 Cost score (lower CPC = better)

First normalise CPC:

```
cpc_norm = (cpc_clipped - P5_cpc) / (P95_cpc - P5_cpc)

```

Then invert it so that **lower CPC becomes higher score**:

```
cost_score = 1 - cpc_norm

```

- Result range: **0–1**
- Higher = cheaper / more cost-efficient

### 3.3 Difficulty score (lower competition = better)

Same idea for `competition_index`:

```
competition_norm = (competition_clipped - P5_comp) / (P95_comp - P5_comp)
difficulty_score = 1 - competition_norm

```

- Result range: **0–1**
- Higher = easier to win (less competition)

At this point all three scores are between **0 and 1**, where **higher always means “better”**.

---

### 4. Calculate the Ads Priority Score

Combine the three metric scores into a single **Ads Priority Score**:

```
ads_score =
  0.5 * volume_score   +   // Volume is most important
  0.3 * cost_score     +   // Cost must not be too high
  0.2 * difficulty_score   // Too hard to win gets lower weight

```

This gives one `ads_score` per keyword, also between roughly 0 and 1.

---

### 5. Define Tiers (A / B / C)

You can either:

- Use **fixed thresholds** (simple V1), or
- Use **percentiles** (P20 / P50 / P80) on `ads_score` to adapt to each dataset.

### Option A – Fixed thresholds (Switchable parameter)

```
Tier A (primary Ad keywords)
ads_score >= 0.75

Tier B (test / secondary Ad Group)
0.5 <= ads_score < 0.75

Tier C (long tail / observe only)
ads_score < 0.5

```

### Option B – Percentile-based tiers (Default Choice)

1. Compute:
    - `P80_ads` = 80th percentile of `ads_score`
    - `P50_ads` = 50th percentile (median)
2. Then:

```
Tier A: ads_score >= P80_ads
Tier B: P50_ads <= ads_score < P80_ads
Tier C: ads_score < P50_ads

```

This way, Tier A is always roughly the **top 20%** of keywords in this project.

---

### 6. Define Paid / SEO flags

After you have `volume_score`, `cost_score`, and `difficulty_score`, you can label each keyword as more suitable for **Paid Ads**, **SEO**, or both.

### 6.1 Paid flag

Keywords that are good for Ads usually have:

- Decent or high volume
- Cost not too high
- Competition not insanely tough

```
paid_flag =
  volume_score      >= 0.5 AND
  cost_score        >= 0.3 AND
  difficulty_score  >= 0.3

```

If this condition is `true`, the keyword is considered **suitable for Google Ads**.

### 6.2 SEO flag

SEO-first keywords typically:

- Have okay volume
- Are relatively expensive or competitive in Ads
- Make more sense to target with content than to buy every click

```
seo_flag =
  volume_score      >= 0.3 AND
  cost_score        <= 0.5 AND   // More expensive / less cost-efficient
  difficulty_score  <= 0.6       // Not super easy to win with Ads

```

---

### 7. Final output per keyword (in JSON 08)

For each keyword in JSON file **index 08**, you’ll have something like:

- `keyword`
- `avg_monthly_searches`
- `cpc`
- `competition_index`
- `volume_score`
- `cost_score`
- `difficulty_score`
- `ads_score`
- `tier` (`"A" | "B" | "C"`) — default to **C** when `ads_score` cannot be computed (missing metrics/percentiles)
- `paid_flag` (`true | false`)
- `seo_flag` (`true | false`)

This lets you:

- Quickly filter **Tier A + paid_flag = true** for main campaigns
- Use **seo_flag = true** to decide which keywords should become blog posts / landing pages
- Keep Tier C & low scores as research / long-tail / future experiments.
