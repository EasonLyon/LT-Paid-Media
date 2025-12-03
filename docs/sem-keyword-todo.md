# SEM Keyword Pipeline – Implementation TODOs

## High-level modules

- [ ] Step 1 – Project init + OpenAI call
  - [ ] `app/api/sem/start/route.ts` – `startSemProjectHandler` POST handler orchestrating Step 1.
  - [ ] `lib/sem/input.ts` – `normalizeProjectInitInput`, `buildProjectId`, `ensureProjectFolder(projectId)`.
  - [ ] `lib/openai/initial-keywords.ts` – `fetchInitialKeywordClusters(normalizedInput)`.
  - [ ] `lib/storage/project-files.ts` – `writeProjectJson(projectId, index, filename, data)` to save `01-...json`.
- [ ] Step 2 – Search volume enrichment (DataForSEO)
  - [ ] `app/api/sem/search-volume/route.ts` – `runSearchVolumeEnrichment(projectId)` entry point.
  - [ ] `lib/dataforseo/search-volume.ts` – `fetchSearchVolumeBatches(keywords, opts)` using `node-console-progress-bar-tqdm`.
  - [ ] `lib/sem/keywords.ts` – `flattenKeywordsWithCategories(initialJson)` returning `{ keywords: string[]; categoryMap }`.
  - [ ] `lib/sem/enrich-search-volume.ts` – `buildEnrichedKeywords(rawResponses, categoryMap, projectId)`.
  - [ ] `lib/storage/project-files.ts` – reuse to write `02-...json`, `03-...json`, `04-...json`.
- [ ] Step 3 – SERP expansion (PAA + URLs)
  - [ ] `app/api/sem/serp-expansion/route.ts` – `runSerpExpansion(projectId)` entry.
  - [ ] `lib/dataforseo/serp.ts` – `fetchSerpResults(coreKeywords, segmentKeywords, options)`.
  - [ ] `lib/sem/serp-expansion.ts` – `extractSerpNewKeywords(serpResponses)` and `extractTopUrls(serpResponses)`.
  - [ ] `lib/storage/project-files.ts` – write `05-serp-new-keywords-and-top-urls.json`.
- [ ] Step 4 – Keywords for site (top organic domains)
  - [ ] `app/api/sem/site-keywords/route.ts` – `runKeywordsForSite(projectId)`.
  - [ ] `lib/dataforseo/keywords-for-site.ts` – `fetchKeywordsForSites(domains, options)` with progress bar.
  - [ ] `lib/sem/site-keywords.ts` – `normalizeSiteKeywordRecords(responses, projectId)`.
  - [ ] `lib/storage/project-files.ts` – write `06-site-keywords-from-top-domains.json`.
- [ ] Step 5 – Combine & dedupe keywords
  - [ ] `lib/sem/combine-keywords.ts` – `buildCombinedKeywordList(projectId)` and `dedupeKeywords(records)`.
  - [ ] `app/api/sem/combine/route.ts` – `runCombineAndDedupe(projectId)` to emit `07-all-keywords-combined-deduped.json`.
- [ ] Step 6 – Supabase sync & CPC backfill
  - [ ] `app/api/sem/supabase-sync/route.ts` – `runSupabaseSync(projectId)`.
  - [ ] `lib/sem/supabase-sync.ts` – `snapshotSupabaseKeywords(projectId)`, `findKeywordsToEnrich(combined, dbRows)`, `upsertKeywordsWithCpc(records, projectId)`.
  - [ ] `lib/dataforseo/search-volume.ts` – reuse `fetchSearchVolumeBatches` for backfill requests.
  - [ ] `lib/storage/project-files.ts` – write `08-supabase-keywords-snapshot.json`, `09-keywords-consolidated-final.json`.

## Next actions (short list)

- [ ] Setup Supabase client in Next.js (TS)
  - `lib/supabase/client.ts` exporting `createSupabaseServerClient()` and `supabaseAdmin`.
- [ ] Implement DataForSEO client (search_volume + serp + keywords_for_site)
  - `lib/dataforseo/client.ts` exporting configured axios instance with basic auth from `.env`.
- [ ] Create `output/<projectId>/...` folder handling utility
  - `lib/storage/project-files.ts` with `ensureProjectFolder`, `projectFilePath`, `writeProjectJson`.
