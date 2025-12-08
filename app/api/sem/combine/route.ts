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
        nextSteps: ["rerun_search_volume", "proceed_keyword_scoring"],
      });
    }

    const totalSteps: number = 5;
    const startTimestamp = existingProgress?.startTimestamp ?? Date.now();
    const writeProg = async (
      completed: number,
      target: string | null,
      meta?: { final?: boolean; processedKeywords?: number; totalKeywords?: number; status?: "running" | "done" },
    ) => {
      const final = meta?.final ?? false;
      const percent = totalSteps === 0 ? 100 : Math.round((completed / totalSteps) * 100);
      await writeProjectProgress(projectId, "step5-progress.json", {
        step: 5,
        target,
        completed,
        total: totalSteps,
        percent,
        timestamp: new Date().toISOString(),
        startTimestamp,
        status: meta?.status ?? (final ? "done" : "running"),
        nextPollMs: final ? 0 : 1000,
        processedKeywords: meta?.processedKeywords,
        totalKeywords: meta?.totalKeywords,
      });
    };

    await writeProg(0, "start");

    const combined = await buildCombinedKeywordList(projectId, async (completed, target, info) => {
      await writeProg(completed, target ?? null, {
        processedKeywords: info?.processedKeywords,
        totalKeywords: info?.totalKeywords,
      });
    });

    await writeProg(totalSteps, null, { final: true, status: "done" });
    console.log("[Step5] complete");
    return NextResponse.json({ total: combined.length });
  } catch (error: unknown) {
    console.error("[Step5] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
