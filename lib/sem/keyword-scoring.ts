import { ScoredKeywordRecord, Tier, TieringMode, UnifiedKeywordRecord } from "@/types/sem";
import { readProjectJson, writeProjectJson, writeProjectProgress, writeProjectText } from "../storage/project-files";

type Step6Status = "running" | "done" | "error";
type Step6Phase = "loading_input" | "computing_percentiles" | "scoring_keywords" | "finalizing" | "error";

interface MetricStats {
  p5: number | null;
  p95: number | null;
  enabled: boolean;
}

interface Step6Summary {
  total: number;
  tierCounts: Record<Tier, number>;
  paidCount: number;
  seoCount: number;
  tieringMode: TieringMode;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function clipValue(x: number, low: number, high: number): number {
  return Math.min(Math.max(x, low), high);
}

function computeMetricStats(values: number[]): MetricStats {
  const p5 = percentile(values, 5);
  const p95 = percentile(values, 95);
  const enabled = p5 !== null && p95 !== null && p95 > p5;
  return { p5, p95, enabled };
}

function collectMetricValues(records: UnifiedKeywordRecord[]) {
  const volumeValues: number[] = [];
  const cpcValues: number[] = [];
  const compValues: number[] = [];

  for (const record of records) {
    const volume = record.avg_monthly_searches ?? record.search_volume;
    if (typeof volume === "number") volumeValues.push(volume);
    if (typeof record.cpc === "number") cpcValues.push(record.cpc);
    if (typeof record.competition_index === "number") compValues.push(record.competition_index);
  }

  return {
    volume: computeMetricStats(volumeValues),
    cpc: computeMetricStats(cpcValues),
    competition: computeMetricStats(compValues),
  };
}

function computeScoresForRecord(
  record: UnifiedKeywordRecord,
  stats: ReturnType<typeof collectMetricValues>,
): Omit<ScoredKeywordRecord, "tier" | "paid_flag" | "seo_flag"> {
  const round4 = (value: number | null) => (value === null ? null : Number(value.toFixed(4)));
  const rawVolume = record.avg_monthly_searches ?? record.search_volume ?? null;
  const rawCpc = record.cpc ?? null;
  const rawComp = record.competition_index ?? null;

  const volume_score =
    stats.volume.enabled && typeof rawVolume === "number" && stats.volume.p5 !== null && stats.volume.p95 !== null
      ? (clipValue(rawVolume, stats.volume.p5, stats.volume.p95) - stats.volume.p5) /
        (stats.volume.p95 - stats.volume.p5)
      : null;

  const cpc_score =
    stats.cpc.enabled && typeof rawCpc === "number" && stats.cpc.p5 !== null && stats.cpc.p95 !== null
      ? (clipValue(rawCpc, stats.cpc.p5, stats.cpc.p95) - stats.cpc.p5) / (stats.cpc.p95 - stats.cpc.p5)
      : null;

  const cost_score = cpc_score !== null ? 1 - cpc_score : null;

  const comp_score =
    stats.competition.enabled &&
    typeof rawComp === "number" &&
    stats.competition.p5 !== null &&
    stats.competition.p95 !== null
      ? (clipValue(rawComp, stats.competition.p5, stats.competition.p95) - stats.competition.p5) /
        (stats.competition.p95 - stats.competition.p5)
      : null;

  const difficulty_score = comp_score !== null ? 1 - comp_score : null;

  const canScoreAds =
    volume_score !== null && cost_score !== null && difficulty_score !== null && Number.isFinite(volume_score);
  const ads_score = canScoreAds && Number.isFinite(cost_score) && Number.isFinite(difficulty_score)
    ? 0.5 * (volume_score as number) + 0.3 * (cost_score as number) + 0.2 * (difficulty_score as number)
    : null;

  return {
    ...record,
    volume_score: round4(volume_score),
    cost_score: round4(cost_score),
    difficulty_score: round4(difficulty_score),
    ads_score: round4(ads_score),
  };
}

function assignTier(
  adsScore: number | null,
  mode: TieringMode,
  thresholds: { p50: number | null; p80: number | null },
): Tier {
  if (mode === "fixed") {
    if (adsScore === null) return "C";
    if (adsScore >= 0.75) return "A";
    if (adsScore >= 0.5) return "B";
    return "C";
  }

  const { p50, p80 } = thresholds;
  if (adsScore === null || p50 === null || p80 === null) return "C";
  if (adsScore >= p80) return "A";
  if (adsScore >= p50) return "B";
  return "C";
}

async function writeStep6Progress(
  projectId: string,
  startTimestamp: number,
  payload: {
    phase: Step6Phase;
    percent: number;
    status?: Step6Status;
    message?: string;
    processedKeywords?: number;
    totalKeywords?: number;
  },
) {
  const status = payload.status ?? "running";
  const percent = Math.min(Math.max(Math.round(payload.percent), 0), status === "done" ? 100 : 99);
  const nextPollMs = status === "done" || status === "error" ? 0 : percent < 25 ? 1000 : 4000;
  await writeProjectProgress(projectId, "step6-progress.json", {
    step: 6,
    phase: payload.phase,
    status,
    percent,
    message: payload.message,
    processedKeywords: payload.processedKeywords ?? null,
    totalKeywords: payload.totalKeywords ?? null,
    startTimestamp,
    timestamp: new Date().toISOString(),
    nextPollMs,
  });
}

function applyFlags(record: ScoredKeywordRecord): ScoredKeywordRecord {
  const paid_flag =
    record.volume_score !== null &&
    record.cost_score !== null &&
    record.difficulty_score !== null &&
    record.volume_score >= 0.5 &&
    record.cost_score >= 0.3 &&
    record.difficulty_score >= 0.3;

  const seo_flag =
    record.volume_score !== null &&
    record.cost_score !== null &&
    record.difficulty_score !== null &&
    record.volume_score >= 0.3 &&
    record.cost_score <= 0.5 &&
    record.difficulty_score <= 0.6;

  return { ...record, paid_flag, seo_flag };
}

function formatCsvValue(value: string | number | null | undefined): string {
  if (value === null || typeof value === "undefined") return "";
  const stringValue = typeof value === "number" ? value.toString() : value;
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export async function buildKeywordScores(projectId: string, tieringMode: TieringMode = "percentile"): Promise<Step6Summary> {
  console.log("[Step6] keyword scoring start");
  const startTimestamp = Date.now();
  await writeStep6Progress(projectId, startTimestamp, {
    phase: "loading_input",
    percent: 5,
    message: "Loading combined keywords",
    processedKeywords: 0,
  });

  try {
    const combined = await readProjectJson<UnifiedKeywordRecord[]>(projectId, "07-all-keywords-combined-deduped.json");
    const total = combined.length;

    await writeStep6Progress(projectId, startTimestamp, {
      phase: "computing_percentiles",
      percent: 15,
      message: "Computing percentiles",
      processedKeywords: 0,
      totalKeywords: total,
    });

    const stats = collectMetricValues(combined);
    const baseScored: Array<Omit<ScoredKeywordRecord, "tier" | "paid_flag" | "seo_flag">> = [];

    await writeStep6Progress(projectId, startTimestamp, {
      phase: "scoring_keywords",
      percent: 25,
      message: total ? `Scoring ${total} keywords` : "No keywords to score",
      processedKeywords: 0,
      totalKeywords: total,
    });

    for (let i = 0; i < total; i += 1) {
      baseScored.push(computeScoresForRecord(combined[i], stats));
      const shouldTick = total <= 50 || (i + 1) % Math.max(1, Math.floor(total / 10)) === 0 || i === total - 1;
      if (shouldTick) {
        const progressPortion = total === 0 ? 100 : 25 + Math.round(((i + 1) / total) * 60);
        await writeStep6Progress(projectId, startTimestamp, {
          phase: "scoring_keywords",
          percent: Math.min(progressPortion, 95),
          message: `Scored ${i + 1}/${total}`,
          processedKeywords: i + 1,
          totalKeywords: total,
        });
      }
    }

    const adsScores = baseScored
      .map((r) => r.ads_score)
      .filter((x): x is number => typeof x === "number");
    const p50_ads = percentile(adsScores, 50);
    const p80_ads = percentile(adsScores, 80);

    const finalRecords: ScoredKeywordRecord[] = baseScored.map((record) => {
      const tier = assignTier(record.ads_score ?? null, tieringMode, { p50: p50_ads, p80: p80_ads });
      return applyFlags({ ...record, tier, paid_flag: false, seo_flag: false });
    });

    const tierCounts: Record<Tier, number> = { A: 0, B: 0, C: 0 };
    let paidCount = 0;
    let seoCount = 0;

    for (const rec of finalRecords) {
      tierCounts[rec.tier] += 1;
      if (rec.paid_flag) paidCount += 1;
      if (rec.seo_flag) seoCount += 1;
    }

    const outputRecords = finalRecords.map((rec) => ({
      keyword: rec.keyword,
      avg_monthly_searches: rec.avg_monthly_searches,
      cpc: rec.cpc,
      competition_index: rec.competition_index,
      volume_score: rec.volume_score,
      cost_score: rec.cost_score,
      difficulty_score: rec.difficulty_score,
      ads_score: rec.ads_score,
      tier: rec.tier,
      paid_flag: rec.paid_flag,
      seo_flag: rec.seo_flag,
    }));

    await writeProjectJson(projectId, "08", "keywords-with-scores.json", outputRecords);
    const paidTierARecords = finalRecords
      .filter((rec) => rec.tier === "A" && rec.paid_flag)
      .map((rec) => ({
        keyword: rec.keyword,
        avg_monthly_searches: rec.avg_monthly_searches,
        cpc: rec.cpc,
      }));
    const csvLines = [
      "keyword,avg_monthly_searches,cpc",
      ...paidTierARecords.map((rec) =>
        [
          formatCsvValue(rec.keyword),
          formatCsvValue(
            typeof rec.avg_monthly_searches === "number" ? Math.round(rec.avg_monthly_searches) : rec.avg_monthly_searches,
          ),
          formatCsvValue(rec.cpc ?? null),
        ].join(","),
      ),
    ];
    await writeProjectText(projectId, "08-tier-a-paid-keywords.csv", csvLines.join("\n"), "text/csv; charset=utf-8");

    await writeStep6Progress(projectId, startTimestamp, {
      phase: "finalizing",
      percent: 100,
      status: "done",
      message: `Scored ${total} keywords`,
      processedKeywords: total,
      totalKeywords: total,
    });

    console.log(
      `[Step6] keyword scoring complete: ${total} keywords, tiers A/B/C = ${tierCounts.A}/${tierCounts.B}/${tierCounts.C}, paid=${paidCount}, seo=${seoCount}`,
    );

    return {
      total,
      tierCounts,
      paidCount,
      seoCount,
      tieringMode,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await writeStep6Progress(projectId, startTimestamp, {
      phase: "error",
      percent: 100,
      status: "error",
      message,
    });
    throw error;
  }
}
