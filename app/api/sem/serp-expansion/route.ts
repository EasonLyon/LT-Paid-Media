import { NextResponse } from "next/server";
import { getDataForSeoClient } from "@/lib/dataforseo/client";
import { extractSerpNewKeywords, extractTopUrls } from "@/lib/sem/serp-expansion";
import {
  readProjectJson,
  readProjectProgress,
  writeProjectJson,
  writeProjectProgress,
} from "@/lib/storage/project-files";
import {
  EnrichedKeywordRecord,
  InitialKeywordJson,
  NormalizedProjectInitInput,
  SerpExpansionResult,
  TopOrganicUrl,
} from "@/types/sem";
import { flattenKeywordsWithCategories } from "@/lib/sem/keywords";
import { ensureDataForSeoResponseOk } from "@/lib/dataforseo/validate";

export const maxDuration = 300;

interface SeedSelection {
  category: string;
  selected: string[];
  strategy: "ranked" | "random_fallback";
  totalAvailable: number;
}

type Step3HistoryEntry = { target: string; timestamp: string; completed: number; status: "completed" | "failed"; error?: string };

export async function POST(req: Request) {
  const runStart = Date.now();
  const TIMEOUT_THRESHOLD_MS = 240_000;
  let timeLimitReached = false;

  try {
    console.log("[Step3] start");
    const { projectId, force } = (await req.json()) as { projectId?: string; force?: boolean };
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const filtered = await readProjectJson<EnrichedKeywordRecord[]>(projectId, "04-keywords-enriched-all.json");
    const { seedKeywords, selection } = selectSeedsByCategoryLevel2(filtered);
    const seedFilePath = await writeProjectJson(projectId, "04a", "serp-seed-keywords.json", {
      note: "Keywords selected for SERP expansion, grouped by category_level_2",
      total_categories: selection.length,
      total_seeds: seedKeywords.length,
      selection,
      source_file: "04-keywords-enriched-all.json",
    });

    const initialJson = await readProjectJson<InitialKeywordJson>(projectId, "01-initial-keyword-clusters.json");
    const originalKeywords = flattenKeywordsWithCategories(initialJson).keywords;
    const originalKeywordSet = new Set(originalKeywords.map((k) => k.trim()));

    const existingProgress = await readProjectProgress<{
      completed?: number;
      startTimestamp?: number;
      history?: Step3HistoryEntry[];
    }>(projectId, "step3-progress.json");

    const completedExisting = Math.min(existingProgress?.completed ?? 0, seedKeywords.length);
    const startTimestamp = existingProgress?.startTimestamp ?? Date.now();
    const history: Step3HistoryEntry[] = existingProgress?.history ?? [];

    const normalizedInput = await readProjectJson<{ normalizedInput?: NormalizedProjectInitInput }>(
      projectId,
      "00-user-input.json",
    ).catch(() => null);
    const languageDetails = inferLanguageCode(
      normalizedInput?.normalizedInput?.language,
      filtered.find((rec) => Boolean(rec.language_code))?.language_code,
    );
    const language_code = languageDetails.code;
    const location_code = filtered.find((rec) => Boolean(rec.location_code))?.location_code ?? 2458;
    if (languageDetails.note) {
      console.log(`[Step3] ${languageDetails.note}`);
    }

    const startIndex = force ? 0 : completedExisting;
    if (!force && startIndex >= seedKeywords.length) {
      return NextResponse.json({
        alreadyCompleted: true,
        seeds: seedKeywords.length,
        message: "Step 3 already completed. Pass force=true to rerun.",
        seedFilePath,
      });
    }

    const existingResult =
      (await readProjectJson<SerpExpansionResult>(projectId, "05-serp-new-keywords-and-top-urls.json").catch(
        () => null,
      )) ?? { new_keywords: [], top_organic_urls: [] };

    let done = startIndex;
    const writeProg = async (completed: number, keyword: string | null, final = false, status: "running" | "done" | "error" = "running") => {
      const elapsed = Date.now() - startTimestamp;
      const nextPollMs = elapsed < 10000 ? 1000 : 4000;
      await writeProjectProgress(projectId, "step3-progress.json", {
        step: 3,
        keyword,
        completed,
        total: seedKeywords.length,
        percent: seedKeywords.length === 0 ? 0 : Math.round((completed / seedKeywords.length) * 100),
        status, // pass status through
        timestamp: new Date().toISOString(),
        startTimestamp,
        nextPollMs: final ? 0 : nextPollMs,
        history,
      });
    };

    await writeProg(done, null);

    const seedsToProcess = seedKeywords.slice(startIndex);
    const client = getDataForSeoClient();
    const limiter = createRateLimiter(2000, 60_000);
    const concurrency = 8;
    let idx = 0;

    const newKeywordSet = new Set<string>(existingResult.new_keywords);
    const topUrlSet = new Set<string>(existingResult.top_organic_urls.map((u) => u.url));
    const mergedTopUrls: TopOrganicUrl[] = [...existingResult.top_organic_urls];

    const processSeed = async () => {
      while (idx < seedsToProcess.length) {
        if (Date.now() - runStart > TIMEOUT_THRESHOLD_MS) {
          timeLimitReached = true;
          return;
        }

        const current = idx++;
        const keyword = seedsToProcess[current];
        await limiter();

        if (Date.now() - runStart > TIMEOUT_THRESHOLD_MS) {
          timeLimitReached = true;
          return;
        }

        const tasks = [
          {
            keyword,
            location_code,
            language_code,
            device: "mobile",
            os: "android",
            depth: 10,
            people_also_ask_click_depth: 1,
          },
        ];
        try {
          const { data } = await client.post("/v3/serp/google/organic/live/advanced", tasks);
          ensureDataForSeoResponseOk(data, "serp", { requireResult: true });
          const newKs = extractSerpNewKeywords([data], originalKeywordSet);
          newKs.forEach((k) => newKeywordSet.add(k));
          const topUrls = extractTopUrls([data]);
          for (const url of topUrls) {
            if (!topUrlSet.has(url.url)) {
              topUrlSet.add(url.url);
              mergedTopUrls.push(url);
            }
          }
          done += 1;
          history.push({ target: keyword, timestamp: new Date().toISOString(), completed: done, status: "completed" });
          await writeProg(done, keyword);
          await writeProjectJson(projectId, "05", "serp-new-keywords-and-top-urls.json", {
            new_keywords: Array.from(newKeywordSet),
            top_organic_urls: mergedTopUrls,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          history.push({
            target: keyword,
            timestamp: new Date().toISOString(),
            completed: done,
            status: "failed",
            error: message,
          });
          await writeProg(done, keyword);
          throw err;
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, seedsToProcess.length || 1) }, () => processSeed());
    await Promise.all(workers);

    if (timeLimitReached && done < seedKeywords.length) {
      console.log(`[Step3] time limit reached (${TIMEOUT_THRESHOLD_MS}ms). Pausing at ${done}/${seedKeywords.length}.`);
      await writeProg(done, null, false, "running");
      const filePath = await writeProjectJson(projectId, "05", "serp-new-keywords-and-top-urls.json", {
        new_keywords: Array.from(newKeywordSet),
        top_organic_urls: mergedTopUrls,
      });
      return NextResponse.json({
        incomplete: true,
        seeds: seedKeywords.length,
        processed: done - startIndex,
        newKeywords: newKeywordSet.size,
        topUrls: mergedTopUrls.length,
        filePath,
        resumedFrom: startIndex,
        seedFilePath,
        message: "Time limit reached, resuming automatically...",
      });
    }

    await writeProg(seedKeywords.length, null, true, "done");

    const filePath = await writeProjectJson(projectId, "05", "serp-new-keywords-and-top-urls.json", {
      new_keywords: Array.from(newKeywordSet),
      top_organic_urls: mergedTopUrls,
    });
    console.log("[Step3] complete");
    return NextResponse.json({
      seeds: seedKeywords.length,
      processed: seedsToProcess.length,
      newKeywords: newKeywordSet.size,
      topUrls: mergedTopUrls.length,
      filePath,
      resumedFrom: startIndex,
      seedFilePath,
      language_code,
      language_note: languageDetails.note,
      language_input: languageDetails.inputLanguages ?? undefined,
    });
  } catch (error: unknown) {
    console.error("[Step3] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function createRateLimiter(maxPerWindow: number, windowMs: number) {
  const timestamps: number[] = [];
  return async () => {
    const now = Date.now();
    while (timestamps.length && now - timestamps[0] > windowMs) {
      timestamps.shift();
    }
    if (timestamps.length >= maxPerWindow) {
      const wait = windowMs - (now - timestamps[0]);
      await delay(wait);
    }
    timestamps.push(Date.now());
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferLanguageCode(languageFromInput?: string, fallbackCodeFromData?: string): {
  code: string;
  note?: string;
  inputLanguages?: string[];
} {
  const parsedInputLanguages = splitLanguages(languageFromInput);
  const primaryLanguage = parsedInputLanguages[0] ?? null;
  const mappedFromInput = primaryLanguage ? mapLanguageToCode(primaryLanguage) : null;

  if (mappedFromInput) {
    return {
      code: mappedFromInput,
      note:
        parsedInputLanguages.length > 1
          ? `Multiple languages provided (${parsedInputLanguages.join(", ")}). Using ${primaryLanguage} -> ${mappedFromInput} for SERP.`
          : undefined,
      inputLanguages: parsedInputLanguages.length ? parsedInputLanguages : undefined,
    };
  }

  if (parsedInputLanguages.length > 0) {
    return {
      code: "en",
      note: `Could not map language(s) "${parsedInputLanguages.join(", ")}". Defaulting to English (en) for SERP.`,
      inputLanguages: parsedInputLanguages,
    };
  }

  if (fallbackCodeFromData && typeof fallbackCodeFromData === "string" && fallbackCodeFromData.trim()) {
    return { code: fallbackCodeFromData.trim(), inputLanguages: undefined };
  }

  return { code: "en", note: "Language not provided. Defaulting to English (en) for SERP." };
}

function splitLanguages(languageFromInput?: string): string[] {
  if (!languageFromInput) return [];
  const raw = languageFromInput
    .split(/[,/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (raw.length === 0 && languageFromInput.trim()) return [languageFromInput.trim()];
  return raw;
}

function mapLanguageToCode(language: string): string | null {
  const normalized = language.trim().toLowerCase();
  const map: Record<string, string> = {
    en: "en",
    english: "en",
    "en-us": "en",
    "en-gb": "en",
    malay: "ms",
    "bahasa melayu": "ms",
    "bahasa malaysia": "ms",
    malaysian: "ms",
    ms: "ms",
    chinese: "zh",
    mandarin: "zh",
    "zh-cn": "zh",
    "zh-hans": "zh",
    "zh-hant": "zh",
    zh: "zh",
    taiwanese: "zh",
    cantonese: "zh",
    tamil: "ta",
    ta: "ta",
  };
  return map[normalized] ?? null;
}

function selectSeedsByCategoryLevel2(records: EnrichedKeywordRecord[]): {
  seedKeywords: string[];
  selection: SeedSelection[];
} {
  const grouped = new Map<string, EnrichedKeywordRecord[]>();
  for (const record of records) {
    if (!record.category_level_2) continue;
    const existing = grouped.get(record.category_level_2) ?? [];
    existing.push(record);
    grouped.set(record.category_level_2, existing);
  }

  const seedSet = new Set<string>();
  const selection: SeedSelection[] = [];

  for (const [category, recs] of grouped.entries()) {
    const valid = recs.filter((r) => Boolean(r.keyword));
    if (valid.length === 0) continue;

    const hasSortable = valid.some((r) => r.search_volume !== null || r.competition_index !== null);
    const sorted = hasSortable ? sortByVolumeAndCompetition(valid) : shuffle(valid);
    const chosen = sorted
      .slice(0, 3)
      .map((r) => r.keyword)
      .filter((k): k is string => Boolean(k));

    chosen.forEach((k) => seedSet.add(k));
    selection.push({
      category,
      selected: chosen,
      strategy: hasSortable ? "ranked" : "random_fallback",
      totalAvailable: valid.length,
    });
  }

  return { seedKeywords: Array.from(seedSet), selection };
}

function sortByVolumeAndCompetition(records: EnrichedKeywordRecord[]): EnrichedKeywordRecord[] {
  return [...records].sort((a, b) => {
    const aVolume = a.search_volume ?? Number.NEGATIVE_INFINITY;
    const bVolume = b.search_volume ?? Number.NEGATIVE_INFINITY;
    if (aVolume !== bVolume) {
      return bVolume - aVolume;
    }

    const aCompetition = a.competition_index ?? Number.NEGATIVE_INFINITY;
    const bCompetition = b.competition_index ?? Number.NEGATIVE_INFINITY;
    return bCompetition - aCompetition;
  });
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
