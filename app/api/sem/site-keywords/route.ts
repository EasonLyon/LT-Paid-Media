import { NextResponse } from "next/server";
import { fetchKeywordsForSites } from "@/lib/dataforseo/keywords-for-site";
import { normalizeSiteKeywordRecords, isHighQualityKeyword } from "@/lib/sem/site-keywords";
import {
  readProjectJson,
  readProjectProgress,
  writeProjectJson,
  writeProjectProgress,
} from "@/lib/storage/project-files";
import { SerpExpansionResult, SiteKeywordRecord } from "@/types/sem";

export const maxDuration = 300; // 5 minutes

export async function POST(req: Request) {
  let currentProjectId: string | null = null;
  let startTimestamp = Date.now();
  let totalTargets = 0;
  let completed = 0;
  let lastTarget: string | null = null;
  // Stop processing new items if we pass this duration to avoid 504.
  // 5m = 300s. Let's stop at 240s (4m) to be safe for writes/overhead.
  const TIMEOUT_THRESHOLD_MS = 240_000;
  let timeLimitReached = false;

  try {
    console.log("[Step4] start");
    const { projectId, force } = (await req.json()) as { projectId?: string; force?: boolean };
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    currentProjectId = projectId;

    const serpResult = await readProjectJson<SerpExpansionResult>(
      projectId,
      "05-serp-new-keywords-and-top-urls.json",
    );
    const urls = Array.from(
      new Set(
        (serpResult.top_organic_urls ?? [])
          .map((item) => item.url)
          .filter((u): u is string => !!u),
      ),
    );

    const existingProgress = await readProjectProgress<{
      completed?: number;
      startTimestamp?: number;
      history?: Array<{ target: string; timestamp: string; completed: number }>;
    }>(projectId, "step4-progress.json");

    const completedExisting = Math.min(existingProgress?.completed ?? 0, urls.length);
    startTimestamp = existingProgress?.startTimestamp ?? Date.now();
    const history: Array<{ target: string; timestamp: string; completed: number }> = existingProgress?.history ?? [];

    const existingRecords =
      (await readProjectJson<SiteKeywordRecord[]>(projectId, "06-site-keywords-from-top-domains.json").catch(
        () => [],
      )) ?? [];

    if (!force && completedExisting >= urls.length && existingRecords.length) {
      return NextResponse.json({
        alreadyCompleted: true,
        urls: urls.length,
        records: existingRecords.length,
        message: "Step 4 already completed. Pass force=true to rerun.",
      });
    }

    const startIndex = force ? 0 : completedExisting;
    let done = startIndex;
    totalTargets = urls.length;
    completed = done;
    const writeProg = async (
      completedCount: number,
      target: string | null,
      final = false,
      status: "running" | "done" | "error" = "running",
      errorMessage?: string,
    ) => {
      // If we are just pausing for timeout, don't mark as "done", keep "running".
      const elapsed = Date.now() - startTimestamp;
      const nextPollMs = elapsed < 10000 ? 1000 : 4000;
      await writeProjectProgress(projectId, "step4-progress.json", {
        step: 4,
        target,
        completed: completedCount,
        total: urls.length,
        percent: urls.length === 0 ? 0 : Math.round((completedCount / urls.length) * 100),
        status,
        errorMessage,
        timestamp: new Date().toISOString(),
        startTimestamp,
        nextPollMs: final ? 0 : nextPollMs,
        history,
      });
    };

    await writeProg(done, null);
    const progress = createProgressBar(urls.length, done);

    const targetsToProcess = urls.slice(startIndex);
    // Allow two fetches at a time while respecting the API's 12 req/minute cap.
    const limiter = createRateLimiter(12, 60_000);
    const concurrency = 2;

    const recordMap = new Map<string, SiteKeywordRecord>();
    for (const rec of existingRecords) {
      recordMap.set(rec.keyword.trim().toLowerCase(), rec);
    }

    const runStart = Date.now();

    await runWithConcurrency(targetsToProcess, concurrency, async (targetUrl) => {
      if (Date.now() - runStart > TIMEOUT_THRESHOLD_MS) {
        timeLimitReached = true;
        return; // skip remaining
      }
      if (timeLimitReached) return;

      await limiter();
      
      // Double check after await
      if (Date.now() - runStart > TIMEOUT_THRESHOLD_MS) {
        timeLimitReached = true;
        return;
      }

      lastTarget = targetUrl;
      let responses: unknown[] = [];
      try {
        responses = await fetchKeywordsForSites([targetUrl]);
      } catch (err) {
        if (isKeywordsForSiteMissingResultError(err)) {
          const message = err instanceof Error ? err.message : "missing result";
          console.warn(`[Step4] skipping ${targetUrl}: ${message}`);
          done += 1;
          completed = done;
          history.push({ target: targetUrl, timestamp: new Date().toISOString(), completed: done });
          await writeProg(done, targetUrl);
          progress.update(done);
          await writeProjectJson(projectId, "06", "site-keywords-from-top-domains.json", Array.from(recordMap.values()));
          return;
        }
        throw err;
      }
      const normalized = normalizeSiteKeywordRecords(responses, projectId);
      const filtered = normalized.filter((rec) => {
        // Must have decent volume
        if (rec.search_volume === null || rec.search_volume < 100) return false;
        // Must be a "high quality" keyword (length, intent, format)
        return isHighQualityKeyword(rec.keyword);
      });
      for (const rec of filtered) {
        const key = rec.keyword.trim().toLowerCase();
        if (!recordMap.has(key)) {
          recordMap.set(key, rec);
        }
      }
      done += 1;
      completed = done;
      history.push({ target: targetUrl, timestamp: new Date().toISOString(), completed: done });
      await writeProg(done, targetUrl);
      progress.update(done);
      await writeProjectJson(projectId, "06", "site-keywords-from-top-domains.json", Array.from(recordMap.values()));
    });

    const finalRecords = Array.from(recordMap.values());
    const filePath = await writeProjectJson(projectId, "06", "site-keywords-from-top-domains.json", finalRecords);

    if (timeLimitReached && done < urls.length) {
      console.log(`[Step4] time limit reached (${TIMEOUT_THRESHOLD_MS}ms). Pausing at ${done}/${urls.length}.`);
      await writeProg(done, null, false, "running"); // Keep running status so UI can resume
      return NextResponse.json({
        incomplete: true,
        urls: urls.length,
        processed: done - startIndex,
        records: finalRecords.length,
        filePath,
        resumedFrom: startIndex,
        message: "Time limit reached, resuming automatically...",
      });
    }

    await writeProg(urls.length, null, true, "done");
    progress.update(urls.length, true);

    console.log("[Step4] complete");
    return NextResponse.json({
      urls: urls.length,
      processed: targetsToProcess.length,
      records: finalRecords.length,
      filePath,
      resumedFrom: startIndex,
    });
  } catch (error: unknown) {
    console.error("[Step4] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (currentProjectId) {
      const safePercent = totalTargets === 0 ? 0 : Math.round((completed / totalTargets) * 100);
      await writeProjectProgress(currentProjectId, "step4-progress.json", {
        step: 4,
        target: lastTarget,
        completed,
        total: totalTargets,
        percent: safePercent,
        status: "error",
        errorMessage: message,
        timestamp: new Date().toISOString(),
        startTimestamp,
        nextPollMs: 0,
        history: [],
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isKeywordsForSiteMissingResultError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("[DataForSEO keywords_for_site]") &&
    error.message.includes("missing result")
  );
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
  const limit = Math.max(1, concurrency);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

function createRateLimiter(maxPerWindow: number, windowMs: number) {
  const timestamps: number[] = [];
  return async () => {
    while (true) {
      const now = Date.now();
      while (timestamps.length && now - timestamps[0] >= windowMs) {
        timestamps.shift();
      }
      if (timestamps.length < maxPerWindow) {
        timestamps.push(now);
        return;
      }
      const wait = Math.max(windowMs - (now - timestamps[0]), 0);
      await delay(wait);
    }
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createProgressBar(total: number, initial = 0) {
  const width = 30;
  let lastLine = "";
  let completed = initial;

  const render = (value: number, done = false) => {
    if (!process.stdout.isTTY) return;
    const percent = total === 0 ? 100 : Math.min(Math.round((value / total) * 100), 100);
    const filled = Math.round((percent / 100) * width);
    const bar = `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
    const line = `[${bar}] ${percent}% (${value}/${total})`;
    if (line !== lastLine) {
      process.stdout.write(`\r${line}`);
      lastLine = line;
    }
    if (done) process.stdout.write("\n");
  };

  render(initial);

  return {
    update(value: number, done = false) {
      completed = value;
      render(completed, done);
    },
  };
}
