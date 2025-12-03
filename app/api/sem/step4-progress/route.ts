import { NextResponse } from "next/server";
import fs from "fs/promises";
import { projectFilePath } from "@/lib/storage/project-files";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    const file = projectFilePath(projectId, "step4-progress.json");
    const raw = await fs.readFile(file, "utf8");
    const json = JSON.parse(raw);
    const hasResultFile = await fileExists(projectFilePath(projectId, "06-site-keywords-from-top-domains.json"));
    return NextResponse.json({ ...json, hasResultFile });
  } catch {
    const hasResultFile = await fileExists(projectFilePath(projectId, "06-site-keywords-from-top-domains.json"));
    return NextResponse.json({ percent: 0, status: "pending", hasResultFile });
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
