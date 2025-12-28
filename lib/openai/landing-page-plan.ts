import OpenAI from "openai";

const PROMPT_ID = "pmpt_6950f12ae6048195b6c6d542c6a9c04c0ad9f956d2ea8332";
const PROMPT_VERSION = "4";

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function extractText(response: any): string {
    if (response.output_text) return response.output_text;
    
    const outputs = response.output ?? response.outputs ?? [];
    for (const output of outputs) {
      const content = output?.content ?? [];
      for (const c of content) {
        if (typeof c?.text === "string") {
          return c.text;
        }
      }
    }

    if (typeof response === "string") return response;
    
    if (response.choices && response.choices[0]?.message?.content) {
        return response.choices[0].message.content;
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
  
  // @ts-ignore: Assuming the custom responses API exists on the client as per project pattern
  const response = await client.responses.create({
    prompt: {
      "id": PROMPT_ID,
      "version": PROMPT_VERSION,
      "variables": variables
    }
  });

  return extractText(response);
}
