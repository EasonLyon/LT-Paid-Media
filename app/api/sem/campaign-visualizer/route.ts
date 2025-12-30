import path from "path";
import { NextResponse } from "next/server";
import {
  CampaignPlanAdTextWithCount,
  CampaignPlan,
  CampaignPlanKeyword,
  CampaignPlanPayload,
  NormalizedProjectInitInput,
  OptimizationPlaybook,
  ScoredKeywordRecord,
} from "@/types/sem";
import { shortenString } from "@/lib/openai/shorten-string";
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
const DAYS_PER_MONTH = 30;
const HEADLINE_CHAR_LIMIT = 30;
const DESCRIPTION_CHAR_LIMIT = 90;
const MAX_SHORTEN_ATTEMPTS = 2;
const SHORTEN_TIMEOUT_MS = 15000;
const SHORTEN_CONCURRENCY = 3;
const QA_TABLES_INDEX = "11_1";
const QA_TABLES_FILENAME = "qa-tables.json";

type PlanSource = "enriched" | "base";
type AdTextType = "headline" | "description";
type AdTextRemoval = {
  campaignName: string;
  adGroupName: string;
  adIndex: number;
  textType: AdTextType;
  originalText: string;
  originalLength: number;
  limit: number;
  reason: string;
};
type QaCampaignRow = {
  Platform: string;
  Funnel: string;
  Entity: string;
  CampaignName: string;
  CampaignType: string;
  Objective: string;
  "Keywords / Audience": string;
  "Monthly Budget (RM)": number | null;
  "Landing Page URL": string;
};
type QaAdGroupRow = {
  "Campaign Name": string;
  Name: string;
  Text: string;
  Character: number | null;
  Type: "Headline" | "Description" | "Keyword";
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("shorten timeout")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

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
  options?: { requireEnriched?: boolean },
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
  if (options?.requireEnriched) {
    throw new Error(`No 11-*.json plan found for project ${projectId}. Run Step 9 from /sem first.`);
  }
  const baseCandidate = fileNames.find((entry) => entry.startsWith(PLAN_PREFIX) && entry.endsWith(".json"));
  if (baseCandidate) {
    return { fileName: baseCandidate, source: "base" };
  }
  throw new Error(`No 10-*.json or 11-*.json plan found for project ${projectId}.`);
}

async function resolveBasePlanFile(projectId: string, fileName?: string | null): Promise<string> {
  assertSafeName(projectId, "projectId");
  const summaries = await listProjectFileSummaries(projectId);
  const fileNames = summaries.map((entry) => entry.name);
  if (fileName) {
    assertSafeName(fileName, "file");
    if (!fileNames.includes(fileName)) {
      throw new Error(`File ${fileName} not found for project ${projectId}`);
    }
    if (!fileName.startsWith(PLAN_PREFIX)) {
      throw new Error(`File ${fileName} is not a Step 8 (10-*.json) plan.`);
    }
    return fileName;
  }
  const baseCandidate = fileNames.find((entry) => entry.startsWith(PLAN_PREFIX) && entry.endsWith(".json"));
  if (baseCandidate) return baseCandidate;
  throw new Error(`No 10-*.json plan found for project ${projectId}. Run Step 8 first.`);
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

async function findBackupFile(projectId: string): Promise<string | null> {
  const summaries = await listProjectFileSummaries(projectId);
  const backup = summaries.find((entry) => entry.name.startsWith(PLAN_PREFIX) && entry.name.endsWith(".backup.json"));
  return backup?.name ?? null;
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

function extractKeywordsAudience(name: string): string {
  if (!name) return "";
  const parts = name.split("|").map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : name;
}

function keywordList(
  targeting: CampaignPlan["AdGroups"][number]["Targeting"] | undefined,
  negative: boolean,
): CampaignPlanKeyword[] {
  if (!targeting) return [];
  const list = negative ? targeting.NegativeKeywords : targeting.Keywords;
  return Array.isArray(list) ? list : [];
}

function buildQaTables(
  campaigns: CampaignPlan[],
  projectId: string,
  normalizedInput: NormalizedProjectInitInput | null,
): { campaignTable: QaCampaignRow[]; adGroupTable: QaAdGroupRow[] } {
  const landingPageUrl = normalizedInput?.website ?? "";
  const campaignTable = campaigns.map((campaign, idx) => {
    const campaignName = campaign.CampaignName ?? `Campaign ${idx + 1}`;
    const monthlyBudget =
      typeof campaign.MonthlyBudgetMYR === "number" && Number.isFinite(campaign.MonthlyBudgetMYR)
        ? campaign.MonthlyBudgetMYR
        : typeof campaign.BudgetDailyMYR === "number" && Number.isFinite(campaign.BudgetDailyMYR)
          ? campaign.BudgetDailyMYR * DAYS_PER_MONTH
          : null;
    return {
      Platform: "Google",
      Funnel: "BOFU",
      Entity: projectId,
      CampaignName: campaignName,
      CampaignType: campaign.CampaignType ?? "",
      Objective: campaign.Goal ?? "",
      "Keywords / Audience": extractKeywordsAudience(campaignName),
      "Monthly Budget (RM)": monthlyBudget,
      "Landing Page URL": landingPageUrl,
    };
  });

  const adGroupTable = campaigns.flatMap((campaign, campaignIdx) =>
    (campaign.AdGroups ?? []).flatMap((adGroup, idx) => {
      const campaignName = campaign.CampaignName ?? `Campaign ${campaignIdx + 1}`;
      const name = adGroup.AdGroupName ?? `Ad Group ${idx + 1}`;
      const ads = Array.isArray(adGroup.ResponsiveSearchAds) ? adGroup.ResponsiveSearchAds : [];
      const headlines = ads.flatMap((ad) => {
        const meta = ad.HeadlinesMeta ?? ad.Headlines?.map((text) => ({ Text: text, CharCount: text.length })) ?? [];
        return meta.map((item) => ({
          "Campaign Name": campaignName,
          Name: name,
          Text: item.Text ?? "",
          Character: item.CharCount ?? null,
          Type: "Headline" as const,
        }));
      });
      const descriptions = ads.flatMap((ad) => {
        const meta =
          ad.DescriptionsMeta ?? ad.Descriptions?.map((text) => ({ Text: text, CharCount: text.length })) ?? [];
        return meta.map((item) => ({
          "Campaign Name": campaignName,
          Name: name,
          Text: item.Text ?? "",
          Character: item.CharCount ?? null,
          Type: "Description" as const,
        }));
      });
      const keywords = keywordList(adGroup.Targeting, false).map((kw) => ({
        "Campaign Name": campaignName,
        Name: name,
        Text: kw.Keyword ?? "",
        Character: null,
        Type: "Keyword" as const,
      }));
      return [...headlines, ...descriptions, ...keywords];
    }),
  );

  return { campaignTable, adGroupTable };
}

async function shortenToLimit(
  text: string,
  limit: number,
  info: { label: string; textType: AdTextType },
  log?: (message: string) => void,
): Promise<{ text: string | null; attempts: number; lastLength: number; error?: string }> {
  let current = text;
  let attempts = 0;
  while (current.length > limit && attempts < MAX_SHORTEN_ATTEMPTS) {
    attempts += 1;
    try {
      log?.(
        `OpenAI shorten ${info.textType} for ${info.label} (attempt ${attempts}, limit ${limit}, length ${current.length})`,
      );
      const shortened = await withTimeout(shortenString(limit, current), SHORTEN_TIMEOUT_MS);
      current = shortened;
      log?.(
        `OpenAI shorten result for ${info.textType} ${info.label} (attempt ${attempts}, length ${current.length})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "shorten error";
      log?.(`OpenAI shorten failed for ${info.textType} ${info.label} (attempt ${attempts}: ${message})`);
      return { text: null, attempts, lastLength: current.length, error: message };
    }
  }
  if (current.length > limit) {
    log?.(`OpenAI shorten exceeded limit for ${info.textType} ${info.label} after ${attempts} attempts.`);
    return { text: null, attempts, lastLength: current.length };
  }
  return { text: current, attempts, lastLength: current.length };
}

async function enforceAdTextLimits(
  texts: string[] | undefined,
  limit: number,
  removalLog: AdTextRemoval[],
  info: { campaignName: string; adGroupName: string; adIndex: number; textType: AdTextType },
  log?: (message: string) => void,
): Promise<string[]> {
  const list = Array.isArray(texts) ? texts : [];
  const label = `${info.campaignName} → ${info.adGroupName} (Ad ${info.adIndex + 1})`;
  const processed = await mapWithConcurrency(list, SHORTEN_CONCURRENCY, async (text) => {
    const originalLength = text.length;
    if (originalLength <= limit) return text;
    const result = await shortenToLimit(text, limit, { label, textType: info.textType }, log);
    if (result.text && result.text.length <= limit) return result.text;
    removalLog.push({
      ...info,
      originalText: text,
      originalLength,
      limit,
      reason: result.error ?? "Still above limit after retries",
    });
    return null;
  });
  return processed.filter((value): value is string => typeof value === "string");
}

async function enrichCampaigns(
  campaigns: CampaignPlan[],
  metricsMap: Map<string, ScoredKeywordRecord>,
  log?: (message: string) => void,
): Promise<{ campaigns: CampaignPlan[]; adTextRemovals: AdTextRemoval[] }> {
  const adTextRemovals: AdTextRemoval[] = [];
  const buildAdTextMeta = (items: string[] | undefined): CampaignPlanAdTextWithCount[] => {
    const list = Array.isArray(items) ? items : [];
    return list.map((text) => ({ Text: text, CharCount: text.length }));
  };

  const enriched = [];
  for (const campaign of campaigns) {
    const campaignName = campaign.CampaignName ?? "Unnamed Campaign";
    const adGroups = [];
    for (const group of campaign.AdGroups ?? []) {
      const adGroupName = group.AdGroupName ?? "Unnamed Ad Group";
      const ads = [];
      const responsiveAds = Array.isArray(group.ResponsiveSearchAds) ? group.ResponsiveSearchAds : [];
      for (let adIndex = 0; adIndex < responsiveAds.length; adIndex += 1) {
        const ad = responsiveAds[adIndex];
        log?.(`Enriching ad text for ${campaignName} → ${adGroupName} (Ad ${adIndex + 1}).`);
        const headlines = await enforceAdTextLimits(ad.Headlines, HEADLINE_CHAR_LIMIT, adTextRemovals, {
          campaignName,
          adGroupName,
          adIndex,
          textType: "headline",
        }, log);
        const descriptions = await enforceAdTextLimits(ad.Descriptions, DESCRIPTION_CHAR_LIMIT, adTextRemovals, {
          campaignName,
          adGroupName,
          adIndex,
          textType: "description",
        }, log);
        ads.push({
          ...ad,
          Headlines: headlines,
          Descriptions: descriptions,
          HeadlinesMeta: buildAdTextMeta(headlines),
          DescriptionsMeta: buildAdTextMeta(descriptions),
        });
      }
      adGroups.push({
        ...group,
        ResponsiveSearchAds: ads,
        Targeting: {
          Keywords: (group.Targeting?.Keywords ?? []).map((kw) => enrichKeyword(kw, metricsMap)),
          NegativeKeywords: (group.Targeting?.NegativeKeywords ?? []).map((kw) => enrichKeyword(kw, metricsMap)),
        },
      });
    }
    enriched.push({
      ...campaign,
      MonthlyBudgetMYR:
        typeof campaign.BudgetDailyMYR === "number" && Number.isFinite(campaign.BudgetDailyMYR)
          ? campaign.BudgetDailyMYR * DAYS_PER_MONTH
          : null,
      AdGroups: adGroups,
    });
  }

  return { campaigns: enriched, adTextRemovals };
}

function applyMonthlyBudget(campaigns: CampaignPlan[]): CampaignPlan[] {
  return campaigns.map((campaign) => ({
    ...campaign,
    MonthlyBudgetMYR:
      typeof campaign.BudgetDailyMYR === "number" && Number.isFinite(campaign.BudgetDailyMYR)
        ? campaign.BudgetDailyMYR * DAYS_PER_MONTH
        : null,
  }));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let projectId = searchParams.get("projectId");
  const file = searchParams.get("file");
  const progressLog: string[] = [];
  const log = (message: string) => {
    progressLog.push(message);
  };

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

    const { fileName, source } = await resolveCampaignPlanFile(projectId, file, { requireEnriched: !file });
    log(`Resolved plan file ${fileName} (${source}).`);
    const raw = await readProjectText(projectId, fileName);
    const parsed = JSON.parse(raw) as CampaignPlanPayload | CampaignPlan[];
    const campaigns = normalizeCampaigns(parsed);
    const optimizationPlaybook = (parsed as CampaignPlanPayload).OptimizationPlaybook;

    if (!campaigns.length) {
      throw new Error(`No campaigns found inside ${fileName}`);
    }

    log(`Loaded ${campaigns.length} campaign(s).`);
    const normalizedInput = await loadNormalizedInput(projectId);
    log("Loaded normalized input.");
    const backupFileName = await findBackupFile(projectId);
    const qaTables = buildQaTables(campaigns, projectId, normalizedInput);
    let qaTablesFileName: string | null = null;
    try {
      const savedPath = await writeProjectJson(projectId, QA_TABLES_INDEX, QA_TABLES_FILENAME, {
        projectId,
        sourceFileName: fileName,
        generatedAt: new Date().toISOString(),
        campaignTable: qaTables.campaignTable,
        adGroupTable: qaTables.adGroupTable,
      });
      qaTablesFileName = path.basename(savedPath);
      log(`Wrote ${qaTablesFileName}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      log(`Unable to write ${QA_TABLES_INDEX}-${QA_TABLES_FILENAME}: ${message}`);
    }

    return NextResponse.json({
      projectId,
      campaigns,
      optimizationPlaybook,
      fileName,
      backupFileName,
      normalizedInput,
      qaTablesFileName,
      progressLog,
    });
  } catch (error: unknown) {
    console.error("[Step9][GET] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message, progressLog }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const progressLog: string[] = [];
  const log = (message: string) => {
    progressLog.push(message);
  };

  try {
    const { projectId, fileName } = (await req.json()) as { projectId?: string; fileName?: string | null };
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const baseFileName = await resolveBasePlanFile(projectId, fileName ?? null);
    log(`Resolved base plan file ${baseFileName}.`);

    const backupFileName = await ensureBackup(projectId, baseFileName);
    if (backupFileName) {
      log(`Backup ready: ${backupFileName}.`);
    } else {
      log("Backup not created or not needed.");
    }

    const raw = await readProjectText(projectId, baseFileName);
    const parsed = JSON.parse(raw) as CampaignPlanPayload | CampaignPlan[];
    const campaigns = normalizeCampaigns(parsed);
    const optimizationPlaybook = (parsed as CampaignPlanPayload).OptimizationPlaybook;

    if (!campaigns.length) {
      throw new Error(`No campaigns found inside ${baseFileName}`);
    }

    log(`Loaded ${campaigns.length} campaign(s).`);
    const metricsMap = await loadKeywordMetrics(projectId);
    log("Enriching keywords and ad text.");
    const { campaigns: enrichedCampaigns, adTextRemovals } = await enrichCampaigns(campaigns, metricsMap, log);

    log("Writing enriched plan to 11-campaign-plan-enriched.json.");
    const payload: CampaignPlanPayload = { Campaigns: enrichedCampaigns, OptimizationPlaybook: optimizationPlaybook };
    const savedPath = await writeProjectJson(projectId, "11", "campaign-plan-enriched.json", payload);
    const targetFileName = path.basename(savedPath);

    log("Step 9 complete.");

    return NextResponse.json({
      projectId,
      fileName: targetFileName,
      backupFileName,
      sourceFileName: baseFileName,
      campaignsCount: enrichedCampaigns.length,
      adTextRemovals,
      progressLog,
    });
  } catch (error: unknown) {
    console.error("[Step9][POST] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message, progressLog }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { projectId, campaigns, optimizationPlaybook, fileName } = (await req.json()) as {
      projectId?: string;
      campaigns?: CampaignPlan[];
      optimizationPlaybook?: OptimizationPlaybook | null;
      fileName?: string | null;
    };

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (!Array.isArray(campaigns)) {
      return NextResponse.json({ error: "campaigns must be an array" }, { status: 400 });
    }

    const safeFileName = fileName && SAFE_NAME.test(fileName) ? fileName : ENRICHED_NAME;
    const payload: CampaignPlanPayload = {
      Campaigns: applyMonthlyBudget(campaigns),
      OptimizationPlaybook: optimizationPlaybook ?? undefined,
    };
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
