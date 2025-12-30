import OpenAI from "openai";

const PROMPT_ID = "pmpt_6953a861dbf08193add573a9f06013b60b6abf53f7c238fd";
const PROMPT_VERSION = "3";

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

export async function shortenString(characterLimit: number, text: string): Promise<string> {
  const client = getOpenAIClient();
  const response = await client.responses.create({
    prompt: {
      id: PROMPT_ID,
      version: PROMPT_VERSION,
      variables: {
        character_limit: `${characterLimit}`,
        string: text,
      },
    },
  });

  const raw = extractJsonString(response);
  let parsed: { output?: string };
  try {
    parsed = JSON.parse(raw) as { output?: string };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`OpenAI response was not valid JSON (${message})`);
  }

  if (typeof parsed.output !== "string") {
    throw new Error("OpenAI response missing output string");
  }

  return parsed.output;
}
