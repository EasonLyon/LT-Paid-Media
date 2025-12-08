import { NextResponse } from "next/server";
import { fetchSearchVolumeBatches } from "@/lib/dataforseo/search-volume";
import { buildEnrichedKeywords } from "@/lib/sem/enrich-search-volume";
import { flattenKeywordsWithCategories, sanitizeKeywordForSearchVolume } from "@/lib/sem/keywords";
import { readProjectJson, writeProjectJson, writeProjectProgress } from "@/lib/storage/project-files";
import { supabaseAdmin } from "@/lib/supabase/client";
import { EnrichedKeywordRecord, InitialKeywordJson, KeywordCategoryMap } from "@/types/sem";
import { tqdm } from "node-console-progress-bar-tqdm";

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

    const writeProgress = buildProgressWriter(projectId);
    const initialJson = await readProjectJson<InitialKeywordJson>(projectId, "01-initial-keyword-clusters.json");
    const { keywords, categoryMap } = flattenKeywordsWithCategories(initialJson);

    const sanitizedKeywords: string[] = [];
    const sanitizedCategoryMap: KeywordCategoryMap = { ...categoryMap };
    const seenSanitized = new Set<string>();
    for (const kw of keywords) {
      const sanitized = sanitizeKeywordForSearchVolume(kw);
      if (!sanitized) continue;
      if (seenSanitized.has(sanitized)) continue;
      seenSanitized.add(sanitized);
      sanitizedKeywords.push(sanitized);
      const info = categoryMap[kw];
      if (info) sanitizedCategoryMap[sanitized] = info;
    }

    const { responses, skipped } = await fetchSearchVolumeBatches(sanitizedKeywords, {
      onProgress: async (info) => {
        latestProgress = info;
        await writeProgress(info);
      },
    });
    await writeProjectJson(projectId, "02", "dataforseo-search-volume-raw.json", responses);

    const enriched = buildEnrichedKeywords(responses, sanitizedCategoryMap, projectId);
    await writeProjectJson(projectId, "03", "keywords-enriched-with-search-volume.json", enriched);
    await writeProjectJson(projectId, "04", "keywords-enriched-all.json", enriched);

    await insertIntoSupabase(enriched);

    if (latestProgress) {
      await writeProgress(latestProgress, "done");
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
