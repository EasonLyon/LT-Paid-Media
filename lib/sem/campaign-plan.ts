import path from "path";
import { fetchCampaignPlan } from "@/lib/openai/campaign-plan";
import { CampaignPlanPayload, NormalizedProjectInitInput } from "@/types/sem";
import { projectFilePath, readProjectJson, readProjectText, writeProjectJson } from "../storage/project-files";
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
  try {
    return await readProjectText(projectId, KEYWORD_CSV_FILE);
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
  const sortedCampaigns = [...campaigns].sort((a, b) => {
    const budgetA = a?.BudgetDailyMYR ?? -Infinity;
    const budgetB = b?.BudgetDailyMYR ?? -Infinity;
    if (budgetA === budgetB) {
      const nameA = a?.CampaignName ?? "";
      const nameB = b?.CampaignName ?? "";
      return nameA.localeCompare(nameB);
    }
    return budgetB - budgetA;
  });

  const normalizeCampaignName = (name: string, index: string) => {
    const cleaned = name.replace(/^AI\s*\|\s*/i, "").replace(/^\d{1,2}\s*\|\s*/, "");
    const parts = cleaned.split(" | ");
    if (parts.length > 1) {
      if (/^\d{2}$/.test(parts[1])) {
        parts[1] = index;
      } else {
        parts.splice(1, 0, index);
      }
      return parts.join(" | ");
    }
    return `${index} | ${cleaned}`;
  };

  const normalizeAdGroupName = (name: string, index: string) => {
    const match = name.match(/^(\d{1,2})(?:\s*\|\s*)?(.*)$/);
    if (match) {
      const [, existingIndex, restRaw] = match;
      const normalizedIndex = existingIndex.padStart(2, "0");
      const rest = (restRaw ?? "").trim();
      return `${normalizedIndex}${rest ? ` | ${rest}` : ""}`;
    }
    const rest = name.trim();
    return `${index}${rest ? ` | ${rest}` : ""}`;
  };

  const indexedCampaigns = sortedCampaigns.map((campaign, campaignIdx) => {
    const campaignIndex = (campaignIdx + 1).toString().padStart(2, "0");
    const campaignName = campaign?.CampaignName ?? "";
    const updatedCampaignName = normalizeCampaignName(campaignName, campaignIndex);

    const adGroups = Array.isArray(campaign?.AdGroups) ? campaign.AdGroups : [];
    const indexedAdGroups = adGroups.map((group, groupIdx) => {
      const groupIndex = (groupIdx + 1).toString().padStart(2, "0");
      const groupName = group?.AdGroupName ?? "";
      const updatedAdGroupName = normalizeAdGroupName(groupName, groupIndex);
      return { ...group, AdGroupName: updatedAdGroupName };
    });

    return { ...campaign, CampaignName: updatedCampaignName, AdGroups: indexedAdGroups };
  });

  const finalPayload: CampaignPlanPayload = {
    Campaigns: indexedCampaigns,
    OptimizationPlaybook: parsed.OptimizationPlaybook,
  };
  const filePath = await writeProjectJson(projectId, "10", OUTPUT_FILE, finalPayload);

  return {
    campaigns: indexedCampaigns,
    fileName: path.basename(filePath),
    filePath: projectFilePath(projectId, path.basename(filePath)),
  };
}
