import { supabaseAdmin } from "../supabase/client";
import {
  DataForSeoSearchVolumeItem,
  DataForSeoSearchVolumeResponse,
  MonthlySearchEntry,
  SupabaseKeywordRow,
  UnifiedKeywordRecord,
} from "@/types/sem";
import { readProjectJson, writeProjectJson, writeProjectProgress } from "../storage/project-files";
import { fetchSearchVolumeBatches } from "../dataforseo/search-volume";
import { computeAvgMonthlySearches } from "./enrich-search-volume";
import { isValidKeyword } from "./keywords";

interface UpsertKeywordRecord {
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
  category_level_1: string | null;
  category_level_2: string | null;
  segment_name: string | null;
  monthly_searches: MonthlySearchEntry[] | Record<string, unknown> | null;
}

async function readCombined(projectId: string): Promise<UnifiedKeywordRecord[]> {
  return readProjectJson<UnifiedKeywordRecord[]>(projectId, "07-all-keywords-combined-deduped.json");
}

async function loadDbKeywords(projectId: string): Promise<SupabaseKeywordRow[]> {
  if (!supabaseAdmin) {
    console.warn("[supabase] client missing, skipping DB fetch");
    return [];
  }
  const { data, error } = await supabaseAdmin.from("keywords").select("*").eq("projectid", projectId);
  if (error) {
    console.error("[supabase] fetch error", error);
    return [];
  }
  return data ?? [];
}

export function findKeywordsToEnrich(
  combined: UnifiedKeywordRecord[],
  dbRows: SupabaseKeywordRow[],
): string[] {
  const dbMap = new Map<string, SupabaseKeywordRow>();
  for (const row of dbRows) {
    dbMap.set(row.keyword.trim().toLowerCase(), row);
  }

  const toEnrich = new Set<string>();
  for (const rec of combined) {
    const key = rec.keyword.trim().toLowerCase();
    const dbRow = dbMap.get(key);
    if (!dbRow || dbRow.cpc === null) {
      toEnrich.add(rec.keyword);
    }
  }

  return Array.from(toEnrich).filter(isValidKeyword);
}

type Step6Status = "running" | "done" | "error";
type Step6Phase = "preparing" | "fetching_search_volume" | "upserting" | "finalizing" | "error" | "done";

async function writeStep6Progress(
  projectId: string,
  startTimestamp: number,
  payload: {
    phase: Step6Phase;
    totalKeywords: number;
    processedKeywords: number;
    status?: Step6Status;
    message?: string;
  },
) {
  const status = payload.status ?? "running";
  const total = Math.max(payload.totalKeywords, 0);
  const processed = Math.min(Math.max(payload.processedKeywords, 0), total || payload.processedKeywords);
  const basePercent =
    total === 0 ? (status === "running" ? 5 : 100) : Math.round((processed / total) * 100);
  const cap = status === "running" ? 99 : status === "error" ? 99 : 100;
  const percent = Math.min(basePercent, cap);
  const elapsed = Date.now() - startTimestamp;
  const nextPollMs = status === "done" || status === "error" ? 0 : elapsed < 10000 ? 1000 : 4000;

  await writeProjectProgress(projectId, "step6-progress.json", {
    step: 6,
    status,
    phase: payload.phase,
    totalKeywords: total,
    processedKeywords: processed,
    percent,
    message: payload.message,
    timestamp: new Date().toISOString(),
    startTimestamp,
    nextPollMs,
  });
}

function buildUpsertRecord(
  api_job_id: string,
  item: DataForSeoSearchVolumeItem,
  combinedMap: Map<string, UnifiedKeywordRecord>,
  dbMap: Map<string, SupabaseKeywordRow>,
  projectId: string,
): UpsertKeywordRecord | null {
  if (item.search_volume === null || item.search_volume === undefined || item.search_volume < 100) {
    return null;
  }

  const key = item.keyword.trim().toLowerCase();
  const combined = combinedMap.get(key);
  const existing = dbMap.get(key);
  const avgMonthly = computeAvgMonthlySearches(item.monthly_searches ?? null);

  return {
    keyword: item.keyword,
    projectid: projectId,
    api_job_id,
    spell: item.spell ?? null,
    location_code: item.location_code ?? null,
    language_code: item.language_code ?? null,
    search_partners: item.search_partners ?? null,
    competition: item.competition ?? null,
    competition_index: item.competition_index ?? null,
    search_volume: item.search_volume ?? null,
    avg_monthly_searches: avgMonthly,
    low_top_of_page_bid: item.low_top_of_page_bid ?? null,
    high_top_of_page_bid: item.high_top_of_page_bid ?? null,
    cpc: item.cpc ?? null,
    monthly_searches: item.monthly_searches ?? null,
    category_level_1: existing?.category_level_1 ?? combined?.category_level_1 ?? null,
    category_level_2: existing?.category_level_2 ?? combined?.category_level_2 ?? null,
    segment_name: existing?.segment_name ?? combined?.segment_name ?? null,
  };
}

export async function runSupabaseSync(projectId: string) {
  console.log("[Step6] start");
  const startTimestamp = Date.now();
  let totalKeywords = 0;
  let processedKeywords = 0;

  const updateProgress = async (phase: Step6Phase, status: Step6Status = "running", message?: string) => {
    await writeStep6Progress(projectId, startTimestamp, {
      phase,
      status,
      totalKeywords,
      processedKeywords,
      message,
    });
  };

  try {
    await updateProgress("preparing", "running", "Loading combined keywords");
    const combined = await readCombined(projectId);
    const combinedMap = new Map<string, UnifiedKeywordRecord>();
    for (const rec of combined) {
      combinedMap.set(rec.keyword.trim().toLowerCase(), rec);
    }

    const dbRows = await loadDbKeywords(projectId);
    await writeProjectJson(projectId, "08", "supabase-keywords-snapshot.json", dbRows);

    const dbMap = new Map<string, SupabaseKeywordRow>();
    for (const row of dbRows) {
      dbMap.set(row.keyword.trim().toLowerCase(), row);
    }

    const keywordsToEnrich = findKeywordsToEnrich(combined, dbRows);
    console.log(`[Step6] keywords to enrich: ${keywordsToEnrich.length}`);
    totalKeywords = keywordsToEnrich.length;
    processedKeywords = 0;

    await updateProgress(
      "preparing",
      "running",
      totalKeywords ? `Keywords to enrich: ${totalKeywords}` : "No new keywords need enrichment",
    );

    const upsertRecords: UpsertKeywordRecord[] = [];
    let responses: DataForSeoSearchVolumeResponse[] = [];

    if (keywordsToEnrich.length > 0) {
      await updateProgress("fetching_search_volume", "running", "Fetching missing search volume & CPC");
      const result = await fetchSearchVolumeBatches(keywordsToEnrich, {
        onProgress: async ({ processedKeywords: processed, totalKeywords: total }) => {
          totalKeywords = total;
          processedKeywords = processed;
          await updateProgress(
            "fetching_search_volume",
            "running",
            `Fetching search volume (${processedKeywords}/${totalKeywords})`,
          );
        },
      });
      responses = result.responses;
      for (const response of responses) {
        const api_job_id = (response as DataForSeoSearchVolumeResponse)?.id ?? "";
        const tasks =
          (response as DataForSeoSearchVolumeResponse)?.tasks ??
          (Array.isArray((response as DataForSeoSearchVolumeResponse)?.result)
            ? [
                {
                  result: (response as DataForSeoSearchVolumeResponse).result,
                  data: (response as DataForSeoSearchVolumeResponse).data,
                },
              ]
            : []);
        for (const task of tasks) {
          const results = task?.result ?? [];
          for (const r of results) {
            const items = Array.isArray(r?.items) ? r.items : [r];
            for (const item of items) {
              const record = buildUpsertRecord(api_job_id, item, combinedMap, dbMap, projectId);
              if (record) {
                upsertRecords.push(record);
              }
            }
          }
        }
      }
    } else {
      await updateProgress("fetching_search_volume", "running", "No keywords require search volume fetch");
    }

    await updateProgress(
      "upserting",
      "running",
      upsertRecords.length ? `Upserting ${upsertRecords.length} keywords into Supabase` : "No new keywords to upsert",
    );

    if (upsertRecords.length && supabaseAdmin) {
      const { error } = await supabaseAdmin
        .from("keywords")
        .upsert(upsertRecords, { onConflict: "projectid,keyword" });
      if (error) {
        console.error("[supabase] upsert error", error);
      } else {
        console.log(`[Step6] upserted ${upsertRecords.length} record(s)`);
      }
    } else if (!supabaseAdmin) {
      console.warn("[Step6] supabase client missing, skipped upsert");
    } else {
      console.log("[Step6] no records to upsert");
    }

    const finalDb = await loadDbKeywords(projectId);
    await writeProjectJson(projectId, "09", "keywords-consolidated-final.json", finalDb);
    processedKeywords = totalKeywords;
    await updateProgress(
      "finalizing",
      "done",
      `Supabase sync complete. Final keyword count: ${finalDb.length}`,
    );
    console.log("[Step6] complete");

    return {
      upserted: upsertRecords.length,
      finalCount: finalDb.length,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await updateProgress("error", "error", message);
    throw error;
  }
}
