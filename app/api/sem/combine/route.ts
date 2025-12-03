import { NextResponse } from "next/server";
import { buildCombinedKeywordList } from "@/lib/sem/combine-keywords";
import { readProjectJson, readProjectProgress, writeProjectProgress } from "@/lib/storage/project-files";

export async function POST(req: Request) {
  try {
    console.log("[Step5] start");
    const { projectId, force } = (await req.json()) as { projectId?: string; force?: boolean };
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const existingProgress = await readProjectProgress<{
      completed?: number;
      startTimestamp?: number;
    }>(projectId, "step5-progress.json");

    let existingCombined: Array<unknown> = [];
    try {
      existingCombined = await readProjectJson(projectId, "07-all-keywords-combined-deduped.json");
    } catch {
      // ignore missing file
    }

    if (!force && existingCombined.length) {
      return NextResponse.json({
        alreadyCompleted: true,
        total: existingCombined.length,
        message: "Step 5 already completed. Rerun search volume?",
        promptSearchVolume: true,
        nextSteps: ["rerun_search_volume", "proceed_supabase_upload"],
      });
    }

    const totalSteps = 4;
    const startTimestamp = existingProgress?.startTimestamp ?? Date.now();
    const writeProg = async (completed: number, target: string | null, final = false) => {
      const percent = totalSteps === 0 ? 100 : Math.round((completed / totalSteps) * 100);
      await writeProjectProgress(projectId, "step5-progress.json", {
        step: 5,
        target,
        completed,
        total: totalSteps,
        percent,
        timestamp: new Date().toISOString(),
        startTimestamp,
        nextPollMs: final ? 0 : 1000,
      });
    };

    await writeProg(0, "start");

    const combined = await buildCombinedKeywordList(projectId, async (completed, target) => {
      await writeProg(completed, target ?? null);
    });

    await writeProg(totalSteps, null, true);
    console.log("[Step5] complete");
    return NextResponse.json({ total: combined.length });
  } catch (error: unknown) {
    console.error("[Step5] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
