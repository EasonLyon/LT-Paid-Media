import { NextResponse } from "next/server";
import fs from "fs/promises";
import { getDataForSeoClient } from "@/lib/dataforseo/client";
import { extractSerpNewKeywords, extractTopUrls } from "@/lib/sem/serp-expansion";
import {
  readProjectJson,
  writeProjectJson,
  writeProjectProgress,
  projectFilePath,
  readProjectProgress,
} from "@/lib/storage/project-files";
import { EnrichedKeywordRecord, InitialKeywordJson, SerpExpansionResult, TopOrganicUrl } from "@/types/sem";
import { flattenKeywordsWithCategories } from "@/lib/sem/keywords";

export async function POST(req: Request) {
  try {
    console.log("[Step3] start");
    const { projectId, force } = (await req.json()) as { projectId?: string; force?: boolean };
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const filtered = await readProjectJson<EnrichedKeywordRecord[]>(projectId, "04-keywords-enriched-all.json");
    const seedKeywords = filtered
      .filter(
        (k) =>
          k.category_level_1 === "core_product_keywords" ||
          k.category_level_1 === "use_case_segment_keywords",
      )
      .map((k) => k.keyword);

    const initialJson = await readProjectJson<InitialKeywordJson>(projectId, "01-initial-keyword-clusters.json");
    const originalKeywords = flattenKeywordsWithCategories(initialJson).keywords;
    const originalKeywordSet = new Set(originalKeywords.map((k) => k.trim()));

    const existingProgress = await readProjectProgress<{
      completed?: number;
      startTimestamp?: number;
      history?: Array<{ target: string; timestamp: string; completed: number }>;
    }>(projectId, "step3-progress.json");

    const completedExisting = Math.min(existingProgress?.completed ?? 0, seedKeywords.length);
    const startTimestamp = existingProgress?.startTimestamp ?? Date.now();
    const history: Array<{ target: string; timestamp: string; completed: number }> = existingProgress?.history ?? [];

    const startIndex = force ? 0 : completedExisting;
    if (!force && startIndex >= seedKeywords.length) {
      return NextResponse.json({
        alreadyCompleted: true,
        seeds: seedKeywords.length,
        message: "Step 3 already completed. Pass force=true to rerun.",
      });
    }

    let existingResult: SerpExpansionResult = { new_keywords: [], top_organic_urls: [] };
    try {
      const rawExisting = await fs.readFile(
        projectFilePath(projectId, "05-serp-new-keywords-and-top-urls.json"),
        "utf8",
      );
      existingResult = JSON.parse(rawExisting) as SerpExpansionResult;
    } catch {
      // ignore
    }

    let done = startIndex;
    const writeProg = async (completed: number, keyword: string | null, final = false) => {
      const elapsed = Date.now() - startTimestamp;
      const nextPollMs = elapsed < 10000 ? 1000 : 4000;
      await writeProjectProgress(projectId, "step3-progress.json", {
        step: 3,
        keyword,
        completed,
        total: seedKeywords.length,
        percent: seedKeywords.length === 0 ? 0 : Math.round((completed / seedKeywords.length) * 100),
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
        const current = idx++;
        const keyword = seedsToProcess[current];
        await limiter();
        const tasks = [
          {
            keyword,
            location_code: 2458,
            language_code: "en",
            device: "mobile",
            os: "android",
            depth: 10,
            people_also_ask_click_depth: 1,
          },
        ];
        const { data } = await client.post("/v3/serp/google/organic/live/advanced", tasks);
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
        history.push({ target: keyword, timestamp: new Date().toISOString(), completed: done });
        await writeProg(done, keyword);
        await writeProjectJson(projectId, "05", "serp-new-keywords-and-top-urls.json", {
          new_keywords: Array.from(newKeywordSet),
          top_organic_urls: mergedTopUrls,
        });
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, seedsToProcess.length || 1) }, () => processSeed());
    await Promise.all(workers);

    await writeProg(seedKeywords.length, null, true);

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
