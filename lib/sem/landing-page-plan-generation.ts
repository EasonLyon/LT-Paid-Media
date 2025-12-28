import path from "path";
import { LandingPagePlanInput } from "@/types/sem";
import { projectFilePath, readProjectJson, writeProjectText } from "../storage/project-files";
import { fetchLandingPagePlan, LandingPagePlanVariables } from "../openai/landing-page-plan";

const INPUT_INDEX = "12_1";
const INPUT_FILE = "landing-page-plan-input.json";
const OUTPUT_INDEX = "12_2";
const OUTPUT_FILE = "landing-page-plan.txt";

export async function generateLandingPagePlan(projectId: string) {
  // 1. Read Input JSON
  let inputData: LandingPagePlanInput;
  try {
    inputData = await readProjectJson<LandingPagePlanInput>(projectId, `${INPUT_INDEX}-${INPUT_FILE}`);
  } catch (error) {
    throw new Error(`Failed to read input file for Step 10.2: ${(error as Error).message}`);
  }

  // 2. Prepare Variables
  const keywordsStr = inputData.keywords_data
    .map(k => `${k.Keyword} (${k.MatchType})`)
    .join(", ");
  
  const questionsStr = inputData.people_also_ask ? inputData.people_also_ask.join(", ") : "";
  const locationStr = inputData.location.join(", ");

  const variables: LandingPagePlanVariables = {
    website: inputData.website,
    keywords_data: keywordsStr,
    serp_questions: questionsStr,
    location: locationStr,
    goal: inputData.goal,
    context: inputData.context
  };

  // 3. Call OpenAI
  let planText = await fetchLandingPagePlan(variables);
  
  // Wrap with separators
  planText = "\n\n---\n\n# Landing Page Blueprint\n\n" + planText + "\n\n---\n\n";

  // 4. Save Output
  const filePath = await writeProjectText(projectId, `${OUTPUT_INDEX}-${OUTPUT_FILE}`, planText);

  return {
    success: true,
    fileName: path.basename(filePath),
    filePath: projectFilePath(projectId, path.basename(filePath)),
    content: planText
  };
}
