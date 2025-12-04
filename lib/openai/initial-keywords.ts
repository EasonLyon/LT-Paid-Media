import OpenAI from "openai";
import { InitialKeywordJson, NormalizedProjectInitInput } from "@/types/sem";

const promptId = "pmpt_69281164f154819390a5306a4c2f25f00d646540e90ff078";

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function extractJsonString(response: unknown): string {
  if (!response) throw new Error("Empty OpenAI response");
  const candidate = response as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    outputs?: Array<{ content?: Array<{ text?: string }> }>;
  };
  if (candidate.output_text) return candidate.output_text;

  const outputs = candidate.output ?? candidate.outputs ?? [];
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

export async function fetchInitialKeywordClusters(
  normalizedInput: NormalizedProjectInitInput,
): Promise<InitialKeywordJson> {
  console.log("[Step1] OpenAI call start");
  const client = getOpenAIClient();
  let response: Awaited<ReturnType<typeof client.responses.create>>;
  try {
    response = await client.responses.create({
      prompt: {
        id: promptId,
        version: "4",
        variables: {
          website: normalizedInput.website,
          goal: normalizedInput.goal ?? "Lead",
          location: normalizedInput.location ?? "Malaysia",
          state_list: normalizedInput.state_list ? normalizedInput.state_list.join(", ") : "",
          language_list: normalizedInput.language ?? "English",
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

  const text = extractJsonString(response);
  const parsed = JSON.parse(text) as InitialKeywordJson;
  console.log("[Step1] OpenAI call complete");
  return parsed;
}
