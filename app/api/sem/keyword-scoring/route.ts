import { NextResponse } from "next/server";
import { buildKeywordScores } from "@/lib/sem/keyword-scoring";
import { TieringMode } from "@/types/sem";

export async function POST(req: Request) {
  try {
    console.log("[Step6] start");
    const { projectId, tieringMode } = (await req.json()) as { projectId?: string; tieringMode?: TieringMode };
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const mode: TieringMode = tieringMode === "fixed" ? "fixed" : "percentile";
    const result = await buildKeywordScores(projectId, mode);
    console.log("[Step6] complete");
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("[Step6] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
