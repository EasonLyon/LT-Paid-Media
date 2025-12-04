import fs from "fs/promises";
import path from "path";
import { CampaignStructureRow, ScoredKeywordRecord, Tier } from "@/types/sem";
import { ensureProjectFolder, readProjectJson } from "../storage/project-files";

const OUTPUT_FILE = "09-google-ads-campaign-structure.csv";

interface BuildCampaignStructureOptions {
  tiers?: Tier[];
  paidFlags?: boolean[];
  seoFlags?: boolean[];
}

function formatCsvValue(value: string | number | boolean | null): string {
  if (value === null) return "";
  const stringValue = typeof value === "boolean" ? (value ? "true" : "false") : value.toString();
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function normalizeTierList(input?: Tier[]): Tier[] {
  const valid = (input ?? []).filter((tier): tier is Tier => tier === "A" || tier === "B" || tier === "C");
  return Array.from(new Set(valid));
}

function normalizeBooleanList(input?: boolean[]): boolean[] {
  const valid = (input ?? []).filter((flag) => typeof flag === "boolean");
  return Array.from(new Set(valid));
}

function buildRows(records: ScoredKeywordRecord[], options: BuildCampaignStructureOptions): CampaignStructureRow[] {
  const tiers = normalizeTierList(options.tiers);
  const paidFlags = normalizeBooleanList(options.paidFlags);
  const seoFlags = normalizeBooleanList(options.seoFlags);

  const tierSet = new Set<Tier>(tiers.length ? tiers : (["A"] as Tier[]));
  const paidSet = new Set<boolean>(paidFlags.length ? paidFlags : [true]);
  const seoSet = new Set<boolean>(seoFlags.length ? seoFlags : [true, false]);

  return records
    .filter((record) => tierSet.has(record.tier) && paidSet.has(record.paid_flag) && seoSet.has(record.seo_flag))
    .map<CampaignStructureRow>((record) => {
      return {
        keyword: record.keyword,
        avg_monthly_searches: record.avg_monthly_searches ?? record.search_volume ?? null,
        cpc: record.cpc ?? null,
        tier: record.tier,
        paid_flag: record.paid_flag,
        seo_flag: record.seo_flag,
        ads_score:
          typeof record.ads_score === "number" && Number.isFinite(record.ads_score)
            ? Number(record.ads_score.toFixed(4))
            : null,
      };
    });
}

function rowsToCsv(rows: CampaignStructureRow[]): string {
  const headers = ["keyword", "avg_monthly_searches", "cpc"];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        formatCsvValue(row.keyword),
        formatCsvValue(
          typeof row.avg_monthly_searches === "number" ? Math.round(row.avg_monthly_searches) : row.avg_monthly_searches,
        ),
        formatCsvValue(row.cpc ?? null),
      ].join(","),
    ),
  ];
  return lines.join("\n");
}

export async function buildCampaignStructure(projectId: string, options: BuildCampaignStructureOptions = {}) {
  let scoredRecords: ScoredKeywordRecord[];
  try {
    scoredRecords = await readProjectJson<ScoredKeywordRecord[]>(projectId, "08-keywords-with-scores.json");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `Unable to read 08-keywords-with-scores.json for project ${projectId}. Ensure Step 6 completed. (${message})`,
    );
  }
  const rows = buildRows(scoredRecords, options);
  const csv = rowsToCsv(rows);

  const folder = await ensureProjectFolder(projectId);
  const filePath = path.join(folder, OUTPUT_FILE);
  await fs.writeFile(filePath, csv, "utf8");

  return {
    rows,
    previewRows: rows.slice(0, 5),
    csv,
    fileName: OUTPUT_FILE,
    filePath,
    totalRows: rows.length,
  };
}
