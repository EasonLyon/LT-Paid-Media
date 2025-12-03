import { NextResponse } from "next/server";
import { fetchSearchVolumeBatches } from "@/lib/dataforseo/search-volume";
import { buildEnrichedKeywords } from "@/lib/sem/enrich-search-volume";
import { flattenKeywordsWithCategories } from "@/lib/sem/keywords";
import { readProjectJson, writeProjectJson } from "@/lib/storage/project-files";
import { supabaseAdmin } from "@/lib/supabase/client";
import { EnrichedKeywordRecord, InitialKeywordJson } from "@/types/sem";
import { tqdm } from "node-console-progress-bar-tqdm";

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
  try {
    console.log("[Step2] start");
    const { projectId } = await req.json();
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const initialJson = await readProjectJson<InitialKeywordJson>(projectId, "01-initial-keyword-clusters.json");
    const { keywords, categoryMap } = flattenKeywordsWithCategories(initialJson);

    const { responses, skipped } = await fetchSearchVolumeBatches(keywords);
    await writeProjectJson(projectId, "02", "dataforseo-search-volume-raw.json", responses);

    const enriched = buildEnrichedKeywords(responses, categoryMap, projectId);
    await writeProjectJson(projectId, "03", "keywords-enriched-with-search-volume.json", enriched);
    await writeProjectJson(projectId, "04", "keywords-enriched-all.json", enriched);

    await insertIntoSupabase(enriched);

    console.log("[Step2] complete");
    return NextResponse.json({
      totalKeywords: keywords.length,
      skipped,
      enrichedCount: enriched.length,
      filteredCount: enriched.length,
    });
  } catch (error: unknown) {
    console.error("[Step2] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
