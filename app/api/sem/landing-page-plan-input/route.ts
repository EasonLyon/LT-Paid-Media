import { NextResponse } from "next/server";
import { generateLandingPageInput } from "@/lib/sem/landing-page-plan-input";

export async function POST(req: Request) {
  try {
    const { projectId, additionalContext } = (await req.json()) as { projectId?: string; additionalContext?: string };
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const result = await generateLandingPageInput(projectId, additionalContext);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("[Step10-1] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
