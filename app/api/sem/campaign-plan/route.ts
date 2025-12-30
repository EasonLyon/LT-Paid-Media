import { NextResponse } from "next/server";
import { generateCampaignPlan } from "@/lib/sem/campaign-plan";

export async function POST(req: Request) {
  try {
    const { projectId, additionalContext, appendContext } = (await req.json()) as {
      projectId?: string;
      additionalContext?: string;
      appendContext?: boolean;
    };
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const result = await generateCampaignPlan(projectId, {
      additionalContext,
      appendFromPrevious: typeof appendContext === "boolean" ? appendContext : true,
    });
    return NextResponse.json({
      fileName: result.fileName,
      filePath: result.filePath,
      campaigns: result.campaigns,
    });
  } catch (error: unknown) {
    console.error("[Step8] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
