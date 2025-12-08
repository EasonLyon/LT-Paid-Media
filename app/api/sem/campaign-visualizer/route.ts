import path from "path";
import { NextResponse } from "next/server";
import {
  CampaignPlan,
  CampaignPlanKeyword,
  CampaignPlanPayload,
  NormalizedProjectInitInput,
  ScoredKeywordRecord,
} from "@/types/sem";
import {
  listOutputProjects,
  listProjectFileSummaries,
  projectFileExists,
  projectFilePath,
  readProjectJson,
  readProjectText,
  writeProjectJson,
  writeProjectText,
} from "@/lib/storage/project-files";

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;
const PLAN_PREFIX = "10-";
const ENRICHED_PREFIX = "11-";
const ENRICHED_NAME = `${ENRICHED_PREFIX}campaign-plan-enriched.json`;
const USER_INPUT_FILE = "00-user-input.json";

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
): Promise<{ fileName: string; source: PlanSource }> {
  assertSafeName(projectId, "projectId");
  const summaries = await listProjectFileSummaries(projectId);
  const fileNames = summaries.map((entry) => entry.name);

  if (fileName) {
    assertSafeName(fileName, "file");
    if (!fileNames.includes(fileName)) {
      throw new Error(`File ${fileName} not found for project ${projectId}`);
    }
    const source: PlanSource = fileName.startsWith(ENRICHED_PREFIX) ? "enriched" : "base";
    return { fileName, source };
  }

  const enrichedCandidate = fileNames.find((entry) => entry.startsWith(ENRICHED_PREFIX) && entry.endsWith(".json"));
  if (enrichedCandidate) {
    return { fileName: enrichedCandidate, source: "enriched" };
  }
  const baseCandidate = fileNames.find((entry) => entry.startsWith(PLAN_PREFIX) && entry.endsWith(".json"));
  if (baseCandidate) {
    return { fileName: baseCandidate, source: "base" };
  }
  throw new Error(`No 10-*.json or 11-*.json plan found for project ${projectId}.`);
}

async function ensureBackup(projectId: string, fileName: string): Promise<string | null> {
  if (!fileName.startsWith(PLAN_PREFIX)) return null;
  const backupName = fileName.replace(/\.json$/i, ".backup.json");
  const exists = await projectFileExists(projectId, backupName);
  if (exists) return backupName;
  try {
    const content = await readProjectText(projectId, fileName);
    await writeProjectText(projectId, backupName, content, "application/json; charset=utf-8");
    return backupName;
  } catch {
    return null;
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

async function loadNormalizedInput(projectId: string): Promise<NormalizedProjectInitInput | null> {
  try {
    const stored = await readProjectJson<{ normalizedInput?: NormalizedProjectInitInput }>(projectId, USER_INPUT_FILE);
    return stored?.normalizedInput ?? null;
  } catch (err) {
    console.warn("[Step9][GET] unable to read normalized input", err);
    return null;
  }
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

async function writeEnrichedPlan(projectId: string, campaigns: CampaignPlan[]): Promise<{ fileName: string }> {
  const payload: CampaignPlanPayload = { Campaigns: campaigns };
  const savedPath = await writeProjectJson(projectId, "11", "campaign-plan-enriched.json", payload);
  return { fileName: path.basename(savedPath) };
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

    const { fileName, source } = await resolveCampaignPlanFile(projectId, file);
    const backupFileName = await ensureBackup(projectId, fileName);
    const raw = await readProjectText(projectId, fileName);
    const parsed = JSON.parse(raw) as CampaignPlanPayload | CampaignPlan[];
    const campaigns = normalizeCampaigns(parsed);
    if (!campaigns.length) {
      throw new Error(`No campaigns found inside ${fileName}`);
    }

    const metricsMap = await loadKeywordMetrics(projectId);
    const enrichedCampaigns = enrichCampaigns(campaigns, metricsMap);
    const target = source === "enriched" ? { fileName } : await writeEnrichedPlan(projectId, enrichedCampaigns);
    const normalizedInput = await loadNormalizedInput(projectId);

    return NextResponse.json({
      projectId,
      campaigns: enrichedCampaigns,
      fileName: target.fileName,
      backupFileName,
      sourceFileName: fileName,
      normalizedInput,
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
    const payload: CampaignPlanPayload = { Campaigns: campaigns };
    const content = JSON.stringify(payload, null, 2);
    await writeProjectText(projectId, safeFileName, content, "application/json; charset=utf-8");

    return NextResponse.json({
      projectId,
      fileName: path.basename(safeFileName),
      path: projectFilePath(projectId, safeFileName),
      campaignsCount: campaigns.length,
      savedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("[Step9][PUT] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
