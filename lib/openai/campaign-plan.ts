import OpenAI from "openai";
import { CampaignPlanPayload, NormalizedProjectInitInput } from "@/types/sem";

const PROMPT_ID = "pmpt_69306275f10c8197b1310916806b42490e59ebe827e88503";
const PROMPT_VERSION = "16";

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

export async function fetchCampaignPlan(
  normalizedInput: NormalizedProjectInitInput,
  keywordData: string,
  contextOverride?: string,
): Promise<CampaignPlanPayload> {
  const client = getOpenAIClient();
  const context = typeof contextOverride === "string" ? contextOverride : normalizedInput.context ?? "";

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
          context,
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

  return parsed;
}