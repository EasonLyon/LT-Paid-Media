import fs from "fs/promises";
import path from "path";
import { fetchCampaignPlan } from "@/lib/openai/campaign-plan";
import { CampaignPlanPayload, NormalizedProjectInitInput } from "@/types/sem";
import { ensureProjectFolder, readProjectJson, writeProjectJson } from "../storage/project-files";
const INPUT_FILE = "00-user-input.json";
const KEYWORD_CSV_FILE = "09-google-ads-campaign-structure.csv";
const OUTPUT_FILE = "campaign-plan.json";

interface StoredInitFile {
  normalizedInput?: NormalizedProjectInitInput;
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
  const parsed = await fetchCampaignPlan(normalizedInput, keywordData);

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
