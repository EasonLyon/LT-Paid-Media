import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { CampaignPlanPayload, NormalizedProjectInitInput } from "@/types/sem";
import { ensureProjectFolder, readProjectJson, writeProjectJson } from "../storage/project-files";

const PROMPT_ID = "pmpt_69306275f10c8197b1310916806b42490e59ebe827e88503";
const PROMPT_VERSION = "5";
const INPUT_FILE = "00-user-input.json";
const KEYWORD_CSV_FILE = "09-google-ads-campaign-structure.csv";
const OUTPUT_FILE = "campaign-plan.json";

interface StoredInitFile {
  normalizedInput?: NormalizedProjectInitInput;
}

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function extractText(response: unknown): string {
  const candidate = response as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    outputs?: Array<{ content?: Array<{ text?: string }> }>;
  };
  if (candidate?.output_text) return candidate.output_text;

  const outputs = candidate?.output ?? candidate?.outputs ?? [];
  for (const output of outputs) {
    const content = output?.content ?? [];
    for (const c of content) {
      if (typeof c?.text === "string") {
        return c.text;
      }
    }
  }

  if (typeof response === "string") return response;
  throw new Error("Unable to extract text from OpenAI response");
}

async function loadNormalizedInput(projectId: string): Promise<NormalizedProjectInitInput> {
  try {
    const stored = await readProjectJson<StoredInitFile>(projectId, INPUT_FILE);
    if (stored?.normalizedInput) return stored.normalizedInput;
    throw new Error("normalizedInput missing in 00-user-input.json");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Unable to read ${INPUT_FILE} for project ${projectId}: ${message}`);
  }
}

async function loadKeywordCsv(projectId: string): Promise<string> {
  const folder = await ensureProjectFolder(projectId);
  const csvPath = path.join(folder, KEYWORD_CSV_FILE);
  try {
    return await fs.readFile(csvPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Unable to read ${KEYWORD_CSV_FILE}. Run Step 7 first. (${message})`);
  }
}

export async function generateCampaignPlan(projectId: string) {
  const normalizedInput = await loadNormalizedInput(projectId);
  const keywordData = await loadKeywordCsv(projectId);
  const client = getOpenAIClient();

  let response: Awaited<ReturnType<typeof client.responses.create>>;
  try {
    response = await client.responses.create({
      prompt: {
        id: PROMPT_ID,
        version: PROMPT_VERSION,
        variables: {
          website: normalizedInput.website,
          goal: normalizedInput.goal,
          location: normalizedInput.location,
          state_list: normalizedInput.state_list?.join(", ") ?? "",
          language: normalizedInput.language,
          monthly_budget: normalizedInput.monthly_adspend_myr.toString(),
          keyword_data: keywordData,
        },
      },
    });
    console.log("[OPENAI SUCCESS]", {
      responseId: response.id,
      model: response.model,
      created: response.created_at,
    });
  } catch (error) {
    const err = error as { message?: string; status?: number; response?: { data?: unknown } };
    console.error("[OPENAI ERROR]", {
      message: err.message,
      status: err.status,
      details: err.response?.data,
    });
    throw error;
  }

  const text = extractText(response);
  let parsed: CampaignPlanPayload;
  try {
    parsed = JSON.parse(text) as CampaignPlanPayload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`OpenAI response was not valid JSON (${message})`);
  }

  const campaigns = Array.isArray(parsed?.Campaigns) ? parsed.Campaigns : [];
  const indexedCampaigns = campaigns.map((campaign, campaignIdx) => {
    const campaignIndex = (campaignIdx + 1).toString().padStart(2, "0");
    const marker = "AI | ";
    const campaignName = campaign?.CampaignName ?? "";

    const normalizeNameWithIndex = (name: string, index: string, hasMarker: boolean) => {
      const prefix = hasMarker ? marker : "";
      const afterMarker = hasMarker ? name.replace(/^AI \|\s*/, "") : name;
      const match = afterMarker.match(/^(\d{1,2})(?:\s*\|\s*)?(.*)$/);

      if (match) {
        const [, existingIndex, restRaw] = match;
        const normalizedIndex = existingIndex.padStart(2, "0");
        const rest = (restRaw ?? "").trim();
        return `${prefix}${normalizedIndex}${rest ? ` | ${rest}` : ""}`;
      }

      const rest = afterMarker.trim();
      return `${prefix}${index}${rest ? ` | ${rest}` : ""}`;
    };

    const updatedCampaignName = normalizeNameWithIndex(campaignName, campaignIndex, campaignName.startsWith(marker));

    const adGroups = Array.isArray(campaign?.AdGroups) ? campaign.AdGroups : [];
    const indexedAdGroups = adGroups.map((group, groupIdx) => {
      const groupIndex = (groupIdx + 1).toString().padStart(2, "0");
      const groupName = group?.AdGroupName ?? "";
      const updatedAdGroupName = normalizeNameWithIndex(groupName, groupIndex, false);
      return { ...group, AdGroupName: updatedAdGroupName };
    });

    return { ...campaign, CampaignName: updatedCampaignName, AdGroups: indexedAdGroups };
  });

  const finalPayload: CampaignPlanPayload = { Campaigns: indexedCampaigns };
  const filePath = await writeProjectJson(projectId, "10", OUTPUT_FILE, finalPayload);

  return {
    campaigns: indexedCampaigns,
    fileName: path.basename(filePath),
    filePath,
  };
}
