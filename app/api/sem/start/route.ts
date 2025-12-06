import { NextResponse } from "next/server";
import { normalizeProjectInitInput, buildProjectId, ensureProjectFolder, persistProjectInitInput } from "@/lib/sem/input";
import { fetchInitialKeywordClusters } from "@/lib/openai/initial-keywords";
import { ensureOutputRoot, writeProjectJson } from "@/lib/storage/project-files";
import { ProjectInitInput } from "@/types/sem";

export async function POST(req: Request) {
  try {
    console.log("[api/start] init");
    await ensureOutputRoot();
    const body = (await req.json()) as ProjectInitInput;
    const normalized = normalizeProjectInitInput(body);
    const projectId = await buildProjectId();
    await ensureProjectFolder(projectId);
    const inputFilePath = await persistProjectInitInput(projectId, body, normalized);
    const initialJson = await fetchInitialKeywordClusters(normalized);
    const filePath = await writeProjectJson(projectId, "01", "initial-keyword-clusters.json", initialJson);
    console.log("[api/start] complete");
    return NextResponse.json({ projectId, filePath, inputFilePath, normalizedInput: normalized });
  } catch (error: unknown) {
    console.error("[api/start] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
