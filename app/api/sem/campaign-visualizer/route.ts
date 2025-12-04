import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { CampaignPlan, CampaignPlanKeyword, CampaignPlanPayload, ScoredKeywordRecord } from "@/types/sem";
import { ensureProjectFolder, listOutputProjects, projectFilePath, readProjectJson } from "@/lib/storage/project-files";

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;
const PLAN_PREFIX = "10-";
const ENRICHED_PREFIX = "11-";
const ENRICHED_NAME = `${ENRICHED_PREFIX}campaign-plan-enriched.json`;

type PlanSource = "enriched" | "base";

function assertSafeName(value: string, label: string) {
  if (!SAFE_NAME.test(value) || value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new Error(`Invalid ${label}`);
  }
}

function normalizeCampaigns(data: unknown): CampaignPlan[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as CampaignPlan[];
  const payload = data as CampaignPlanPayload;
  if (Array.isArray(payload?.Campaigns)) return payload.Campaigns;
  return [];
}

async function findLatestProjectWithPlan(): Promise<{ projectId: string; fileName: string } | null> {
  const projects = await listOutputProjects();
  for (const project of projects) {
    const enriched = project.files.find((file) => file.name.startsWith(ENRICHED_PREFIX) && file.name.endsWith(".json"));
    if (enriched) return { projectId: project.id, fileName: enriched.name };
    const base = project.files.find((file) => file.name.startsWith(PLAN_PREFIX) && file.name.endsWith(".json"));
    if (base) return { projectId: project.id, fileName: base.name };
  }
  return null;
}

async function resolveCampaignPlanFile(
  projectId: string,
  fileName?: string | null,
): Promise<{ fileName: string; fullPath: string; source: PlanSource }> {
  assertSafeName(projectId, "projectId");
  const folder = path.join(process.cwd(), "output", projectId);
  try {
    await fs.access(folder);
  } catch {
    throw new Error(`Project folder ${projectId} not found. Choose a different projectId.`);
  }

  if (fileName) {
    assertSafeName(fileName, "file");
    const fullPath = path.join(folder, fileName);
    try {
      await fs.access(fullPath);
    } catch {
      throw new Error(`File ${fileName} not found for project ${projectId}`);
    }
    const source: PlanSource = fileName.startsWith(ENRICHED_PREFIX) ? "enriched" : "base";
    return { fileName, fullPath, source };
  }

  const entries = await fs.readdir(folder);
  const enrichedCandidate = entries.find((entry) => entry.startsWith(ENRICHED_PREFIX) && entry.endsWith(".json"));
  if (enrichedCandidate) {
    return { fileName: enrichedCandidate, fullPath: path.join(folder, enrichedCandidate), source: "enriched" };
  }
  const baseCandidate = entries.find((entry) => entry.startsWith(PLAN_PREFIX) && entry.endsWith(".json"));
  if (baseCandidate) {
    return { fileName: baseCandidate, fullPath: path.join(folder, baseCandidate), source: "base" };
  }
  throw new Error(`No 10-*.json or 11-*.json plan found for project ${projectId}.`);
}

async function ensureBackup(fullPath: string, fileName: string): Promise<string | null> {
  if (!fileName.startsWith(PLAN_PREFIX)) return null;
  const backupName = fileName.replace(/\.json$/i, ".backup.json");
  const backupPath = path.join(path.dirname(fullPath), backupName);
  try {
    await fs.access(backupPath);
    return path.basename(backupPath);
  } catch {
    await fs.copyFile(fullPath, backupPath);
    return path.basename(backupPath);
  }
}

async function loadKeywordMetrics(projectId: string): Promise<Map<string, ScoredKeywordRecord>> {
  let scored: ScoredKeywordRecord[];
  try {
    scored = await readProjectJson<ScoredKeywordRecord[]>(projectId, "08-keywords-with-scores.json");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(
      `Unable to read 08-keywords-with-scores.json for project ${projectId}. Run Step 6 first. (${message})`,
    );
  }
  const map = new Map<string, ScoredKeywordRecord>();
  scored.forEach((row) => {
    if (row?.keyword) {
      map.set(row.keyword.toLowerCase(), row);
    }
  });
  return map;
}

function enrichKeyword(
  keyword: CampaignPlanKeyword,
  metricsMap: Map<string, ScoredKeywordRecord>,
): CampaignPlanKeyword {
  const key = keyword.Keyword?.toLowerCase();
  const metrics = key ? metricsMap.get(key) : undefined;
  if (!metrics) {
    return {
      ...keyword,
      AvgMonthlySearches:
        typeof keyword.AvgMonthlySearches === "number" && Number.isFinite(keyword.AvgMonthlySearches)
          ? Math.round(keyword.AvgMonthlySearches)
          : keyword.AvgMonthlySearches ?? null,
    };
  }
  const avgMonthlySearches =
    typeof metrics.avg_monthly_searches === "number" && Number.isFinite(metrics.avg_monthly_searches)
      ? metrics.avg_monthly_searches
      : keyword.AvgMonthlySearches ?? null;
  return {
    ...keyword,
    AvgMonthlySearches: avgMonthlySearches === null ? null : Math.round(avgMonthlySearches),
    CPC: metrics.cpc ?? keyword.CPC ?? null,
    CompetitionIndex: metrics.competition_index ?? keyword.CompetitionIndex ?? null,
  };
}

function enrichCampaigns(campaigns: CampaignPlan[], metricsMap: Map<string, ScoredKeywordRecord>): CampaignPlan[] {
  return campaigns.map((campaign) => ({
    ...campaign,
    AdGroups: (campaign.AdGroups ?? []).map((group) => ({
      ...group,
      Targeting: {
        Keywords: (group.Targeting?.Keywords ?? []).map((kw) => enrichKeyword(kw, metricsMap)),
        NegativeKeywords: (group.Targeting?.NegativeKeywords ?? []).map((kw) => enrichKeyword(kw, metricsMap)),
      },
    })),
  }));
}

async function writeEnrichedPlan(projectId: string, campaigns: CampaignPlan[]): Promise<{ fileName: string; fullPath: string }> {
  const folder = await ensureProjectFolder(projectId);
  const fullPath = path.join(folder, ENRICHED_NAME);
  const payload: CampaignPlanPayload = { Campaigns: campaigns };
  await fs.writeFile(fullPath, JSON.stringify(payload, null, 2), "utf8");
  return { fileName: path.basename(fullPath), fullPath };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let projectId = searchParams.get("projectId");
  const file = searchParams.get("file");

  try {
    if (!projectId) {
      const latest = await findLatestProjectWithPlan();
      if (!latest) {
        return NextResponse.json(
          { error: "No Step 10/11 plan found. Run Step 8 first or provide a projectId." },
          { status: 404 },
        );
      }
      projectId = latest.projectId;
    }

    const { fileName, fullPath, source } = await resolveCampaignPlanFile(projectId, file);
    const backupFileName = await ensureBackup(fullPath, fileName);
    const raw = await fs.readFile(fullPath, "utf8");
    const parsed = JSON.parse(raw) as CampaignPlanPayload | CampaignPlan[];
    const campaigns = normalizeCampaigns(parsed);
    if (!campaigns.length) {
      throw new Error(`No campaigns found inside ${fileName}`);
    }

    const metricsMap = await loadKeywordMetrics(projectId);
    const enrichedCampaigns = enrichCampaigns(campaigns, metricsMap);
    const target = source === "enriched" ? { fileName, fullPath } : await writeEnrichedPlan(projectId, enrichedCampaigns);

    return NextResponse.json({
      projectId,
      campaigns: enrichedCampaigns,
      fileName: target.fileName,
      backupFileName,
      sourceFileName: fileName,
    });
  } catch (error: unknown) {
    console.error("[Step9][GET] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { projectId, campaigns, fileName } = (await req.json()) as {
      projectId?: string;
      campaigns?: CampaignPlan[];
      fileName?: string | null;
    };

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (!Array.isArray(campaigns)) {
      return NextResponse.json({ error: "campaigns must be an array" }, { status: 400 });
    }

    const safeFileName = fileName && SAFE_NAME.test(fileName) ? fileName : ENRICHED_NAME;
    const targetPath = projectFilePath(projectId, safeFileName);
    await ensureProjectFolder(projectId);
    const payload: CampaignPlanPayload = { Campaigns: campaigns };
    await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), "utf8");

    return NextResponse.json({
      projectId,
      fileName: path.basename(targetPath),
      campaignsCount: campaigns.length,
      savedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("[Step9][PUT] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
