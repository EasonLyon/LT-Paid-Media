import { NextResponse } from "next/server";
import fs from "fs/promises";
import { projectFilePath } from "@/lib/storage/project-files";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const progressFile = projectFilePath(projectId, "step2-progress.json");
  const resultFile = projectFilePath(projectId, "03-keywords-enriched-with-search-volume.json");

  try {
    const raw = await fs.readFile(progressFile, "utf8");
    const json = JSON.parse(raw);
    const hasResultFile = await fileExists(resultFile);
    return NextResponse.json({ ...json, hasResultFile });
  } catch {
    const hasResultFile = await fileExists(resultFile);
    return NextResponse.json({ percent: 0, status: "pending", hasResultFile, nextPollMs: 2000 });
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
