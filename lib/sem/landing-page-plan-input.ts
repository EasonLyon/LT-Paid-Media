import path from "path";
import { CampaignPlanPayload, LandingPagePlanInput, NormalizedProjectInitInput, SerpExpansionResult } from "@/types/sem";
import { projectFilePath, readProjectJson, writeProjectJson } from "../storage/project-files";

const INPUT_FILE = "00-user-input.json";
const CAMPAIGN_PLAN_FILE = "10-campaign-plan.json";
const SERP_FILE = "05-serp-new-keywords-and-top-urls.json";
const OUTPUT_FILE = "landing-page-plan-input.json";
const OUTPUT_INDEX = "12_1";

interface StoredInitFile {
  normalizedInput?: NormalizedProjectInitInput;
  rawInput?: {
    context?: string;
    website?: string;
    goal?: string;
  };
}

async function loadInitInput(projectId: string): Promise<{ website: string; goal: string; context: string }> {
  try {
    const stored = await readProjectJson<StoredInitFile>(projectId, INPUT_FILE);
    
    // Prefer normalized input, fallback to raw
    const website = stored.normalizedInput?.website || stored.rawInput?.website || "";
    const goal = stored.normalizedInput?.goal || stored.rawInput?.goal || "";
    const context = stored.normalizedInput?.context || stored.rawInput?.context || "";

    if (!website) throw new Error("Website not found in input");
    
    return { website, goal, context };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Unable to read ${INPUT_FILE} for project ${projectId}: ${message}`);
  }
}

async function loadCampaignPlan(projectId: string): Promise<CampaignPlanPayload> {
  try {
    return await readProjectJson<CampaignPlanPayload>(projectId, CAMPAIGN_PLAN_FILE);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Unable to read ${CAMPAIGN_PLAN_FILE}. Run Step 8 (Campaign Plan) first. (${message})`);
  }
}

async function loadSerpExpansion(projectId: string): Promise<SerpExpansionResult> {
  try {
    return await readProjectJson<SerpExpansionResult>(projectId, SERP_FILE);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // Allow this to fail gracefully if step 3 hasn't run or file is missing, returning empty PAA
    console.warn(`[Step 10] Warning: Unable to read ${SERP_FILE} (${message}). Proceeding without PAA questions.`);
    return { new_keywords: [], top_organic_urls: [] };
  }
}

export async function generateLandingPageInput(projectId: string, additionalContext?: string) {
  // 1. Load Data
  const { website, goal, context: initialContext } = await loadInitInput(projectId);
  const campaignPlan = await loadCampaignPlan(projectId);
  const serpData = await loadSerpExpansion(projectId);

  // Combine context if additional provided
  const combinedContext = additionalContext 
    ? (initialContext ? `${initialContext}\n\n${additionalContext}` : additionalContext)
    : initialContext;

  // 2. Extract Keywords and Consolidate Match Types
  const keywordMap = new Map<string, { keyword: string; matchTypes: Set<string> }>();

  if (campaignPlan.Campaigns) {
    for (const campaign of campaignPlan.Campaigns) {
      if (campaign.AdGroups) {
        for (const adGroup of campaign.AdGroups) {
          if (adGroup.Targeting?.Keywords) {
            for (const kw of adGroup.Targeting.Keywords) {
              const lowerKey = kw.Keyword.trim().toLowerCase();
              if (!keywordMap.has(lowerKey)) {
                keywordMap.set(lowerKey, {
                  keyword: kw.Keyword.trim(), // Keep original casing of first occurrence
                  matchTypes: new Set(),
                });
              }
              keywordMap.get(lowerKey)?.matchTypes.add(kw.MatchType);
            }
          }
        }
      }
    }
  }

  // Convert map to array
  const keywordsData: LandingPagePlanInput["keywords_data"] = Array.from(keywordMap.values()).map(
    (entry) => ({
      Keyword: entry.keyword,
      MatchType: Array.from(entry.matchTypes).join(", "),
    })
  );

  // 3. Extract Locations from all campaigns
  const locationSet = new Set<string>();
  if (campaignPlan.Campaigns) {
    for (const campaign of campaignPlan.Campaigns) {
      if (campaign.Location?.Included) {
        for (const loc of campaign.Location.Included) {
          if (loc.Name) {
            locationSet.add(loc.Name);
          }
        }
      }
    }
  }
  const location = Array.from(locationSet);

  // 4. Extract People Also Ask Questions
  const people_also_ask = serpData.new_keywords || [];

  // 5. Construct Output
  const outputData: LandingPagePlanInput = {
    website,
    goal,
    context: combinedContext,
    location,
    keywords_data: keywordsData,
    people_also_ask,
  };

  // 6. Write File
  const filePath = await writeProjectJson(projectId, OUTPUT_INDEX, OUTPUT_FILE, outputData);

  return {
    fileName: path.basename(filePath),
    filePath: projectFilePath(projectId, path.basename(filePath)),
    data: outputData,
  };
}
