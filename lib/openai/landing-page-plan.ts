import OpenAI from "openai";

const PROMPT_ID = "pmpt_6950f12ae6048195b6c6d542c6a9c04c0ad9f956d2ea8332";
const PROMPT_VERSION = "4";

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function extractText(response: unknown): string {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") {
    throw new Error("Unable to extract text from OpenAI response");
  }

  const record = response as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  const outputs = (record.output ?? record.outputs) as unknown;
  if (Array.isArray(outputs)) {
    for (const output of outputs) {
      if (!output || typeof output !== "object") continue;
      const content = (output as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      for (const entry of content) {
        if (!entry || typeof entry !== "object") continue;
        const text = (entry as Record<string, unknown>).text;
        if (typeof text === "string") return text;
      }
    }
  }

  const choices = record.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const message = (choices[0] as Record<string, unknown>).message;
    if (message && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string") return content;
    }
  }

  throw new Error("Unable to extract text from OpenAI response");
}

export interface LandingPagePlanVariables {
  [key: string]: string; // Add index signature
  website: string;
  keywords_data: string;
  serp_questions: string;
  location: string;
  goal: string;
  context: string;
}

export async function fetchLandingPagePlan(variables: LandingPagePlanVariables): Promise<string> {
  const client = getOpenAIClient();
  console.log("[Step 10.2] Calling OpenAI with prompt", PROMPT_ID);
  
  const response = await client.responses.create({
    prompt: {
      "id": PROMPT_ID,
      "version": PROMPT_VERSION,
      "variables": variables
    }
  });

  return extractText(response);
}
