import { NextResponse } from "next/server";
import { generateLandingPagePlan } from "@/lib/sem/landing-page-plan-generation";

export const maxDuration = 900; // 15 minutes

export async function POST(req: Request) {
  try {
    const { projectId } = (await req.json()) as { projectId?: string };
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const result = await generateLandingPagePlan(projectId);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Step 10.2 Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
