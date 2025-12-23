import { NextResponse } from "next/server";
import { fetchSearchVolumeBatches } from "@/lib/dataforseo/search-volume";
import { buildEnrichedKeywords } from "@/lib/sem/enrich-search-volume";
import { flattenKeywordsWithCategories, sanitizeKeywordForSearchVolume } from "@/lib/sem/keywords";
import { readProjectJson, writeProjectJson, writeProjectProgress } from "@/lib/storage/project-files";
import { supabaseAdmin } from "@/lib/supabase/client";
import { EnrichedKeywordRecord, InitialKeywordJson, KeywordCategoryMap } from "@/types/sem";
import { tqdm } from "node-console-progress-bar-tqdm";

export const maxDuration = 300;

type Step2ProgressInfo = {
  completedBatches: number;
  totalBatches: number;
  processedKeywords: number;
  totalKeywords: number;
};

const buildProgressWriter = (projectId: string) => {
  return async (info: Step2ProgressInfo, status: "running" | "done" | "error" = "running") => {
    const percent = info.totalKeywords === 0 ? 100 : Math.round((info.processedKeywords / info.totalKeywords) * 100);
    await writeProjectProgress(projectId, "step2-progress.json", {
      step: 2,
      status,
      percent,
      ...info,
      timestamp: new Date().toISOString(),
      nextPollMs: status === "done" ? 0 : 1000,
    });
  };
};

async function insertIntoSupabase(records: EnrichedKeywordRecord[]) {
  if (!supabaseAdmin) {
    console.warn("[Step2] supabase client missing, skip insert");
    return;
  }

  const batchSize = 300;
  const batches: EnrichedKeywordRecord[][] = [];
  for (let i = 0; i < records.length; i += batchSize) {
    batches.push(records.slice(i, i + batchSize));
  }

  console.log(`[Step2] inserting ${records.length} records to Supabase`);
  for (const batch of tqdm(batches, { description: "supabase insert" })) {
    const { error } = await supabaseAdmin.from("keywords").upsert(batch, { onConflict: "projectid,keyword" });
    if (error) {
      console.error("[Step2] supabase insert error", error);
      break;
    }
  }
}

export async function POST(req: Request) {
  let latestProgress: Step2ProgressInfo | null = null;
  let currentProjectId: string | null = null;
  try {
    console.log("[Step2] start");
    const { projectId: incomingProjectId } = await req.json();
    if (!incomingProjectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    const projectId = incomingProjectId;
    currentProjectId = projectId;

    const runStart = Date.now();
    const TIMEOUT_THRESHOLD_MS = 240_000;
    const timeoutAt = runStart + TIMEOUT_THRESHOLD_MS;

    const writeProgress = buildProgressWriter(projectId);
    const initialJson = await readProjectJson<InitialKeywordJson>(projectId, "01-initial-keyword-clusters.json");
    const { keywords, categoryMap } = flattenKeywordsWithCategories(initialJson);

    // 1. Load existing raw responses to support resume
    const existingResponses = await readProjectJson<unknown[]>(projectId, "02-dataforseo-search-volume-raw.json").catch(() => []);
    
    // 2. Identify already processed keywords
    const processedKeywords = new Set<string>();
    for (const resp of existingResponses) {
      const tasks = (resp as { tasks?: Array<{ data?: { keyword?: string } }> }).tasks ?? [];
      for (const t of tasks) {
        if (t.data?.keyword) {
           // We store them as they come back from API, but we match against sanitized input.
           // However, input sanitization happens inside fetchSearchVolumeBatches.
           // To be safe, we re-sanitize here or just trust exact match if possible.
           // Let's use the sanitizer from lib/sem/keywords if accessible, or just simple trim.
           processedKeywords.add(sanitizeKeywordForSearchVolume(t.data.keyword) ?? t.data.keyword);
        }
      }
    }

    const sanitizedKeywords: string[] = [];
    const sanitizedCategoryMap: KeywordCategoryMap = { ...categoryMap };
    const seenSanitized = new Set<string>();
    
    for (const kw of keywords) {
      const sanitized = sanitizeKeywordForSearchVolume(kw);
      if (!sanitized) continue;
      if (seenSanitized.has(sanitized)) continue;
      seenSanitized.add(sanitized);
      
      // key difference: check if already processed
      if (processedKeywords.has(sanitized)) continue;

      sanitizedKeywords.push(sanitized);
      const info = categoryMap[kw];
      if (info) sanitizedCategoryMap[sanitized] = info;
    }
    
    // If nothing new to process, we might still want to re-enrich/re-save if force=true, 
    // but the logic here implies we just want to finish the job.
    // If all done, we proceed to enrichment with *all* data.
    
    let newResponses: unknown[] = [];
    let skipped: string[] = [];
    let incomplete = false;

    if (sanitizedKeywords.length > 0) {
        console.log(`[Step2] resuming with ${sanitizedKeywords.length} keywords (already have ${processedKeywords.size})`);
        const result = await fetchSearchVolumeBatches(sanitizedKeywords, {
          timeoutAt,
          onProgress: async (info) => {
            // Adjust totals to include previously completed
            const adjustedInfo = {
                ...info,
                completedBatches: info.completedBatches, // this is just for current run
                processedKeywords: info.processedKeywords + processedKeywords.size,
                totalKeywords: info.totalKeywords + processedKeywords.size
            };
            latestProgress = adjustedInfo;
            await writeProgress(adjustedInfo);
          },
        });
        newResponses = result.responses;
        skipped = result.skipped;
        incomplete = result.incomplete ?? false;
    } else {
        console.log(`[Step2] all ${processedKeywords.size} keywords already processed.`);
    }

    // Merge
    const allResponses = [...existingResponses, ...newResponses];
    await writeProjectJson(projectId, "02", "dataforseo-search-volume-raw.json", allResponses);

    // Always re-run enrichment on the full set to ensure consistency
    const enriched = buildEnrichedKeywords(allResponses, { ...categoryMap, ...sanitizedCategoryMap }, projectId);
    await writeProjectJson(projectId, "03", "keywords-enriched-with-search-volume.json", enriched);
    await writeProjectJson(projectId, "04", "keywords-enriched-all.json", enriched);

    await insertIntoSupabase(enriched);

    if (latestProgress) {
      await writeProgress(latestProgress, incomplete ? "running" : "done");
    }

    if (incomplete) {
        console.log(`[Step2] time limit reached, pausing.`);
        return NextResponse.json({
            incomplete: true,
            totalKeywords: sanitizedKeywords.length + processedKeywords.size,
            processed: processedKeywords.size + newResponses.length * 100, // approx
            message: "Time limit reached, resuming..."
        });
    }

    console.log("[Step2] complete");
    return NextResponse.json({
      totalKeywords: sanitizedKeywords.length,
      skipped,
      enrichedCount: enriched.length,
      filteredCount: enriched.length,
    });
  } catch (error: unknown) {
    if (currentProjectId) {
      const writeProgressOnError = buildProgressWriter(currentProjectId);
      const fallbackProgress =
        latestProgress ?? { completedBatches: 0, totalBatches: 0, processedKeywords: 0, totalKeywords: 0 };
      await writeProgressOnError(fallbackProgress, "error");
    }
    console.error("[Step2] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
