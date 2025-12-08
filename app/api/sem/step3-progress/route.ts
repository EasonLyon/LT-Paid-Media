import { NextResponse } from "next/server";
import { projectFileExists, readProjectProgress } from "@/lib/storage/project-files";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    const progress = await readProjectProgress(projectId, "step3-progress.json");
    const hasResultFile = await projectFileExists(projectId, "05-serp-new-keywords-and-top-urls.json");
    if (progress) {
      return NextResponse.json({ ...progress, hasResultFile });
    }
    return NextResponse.json({ percent: 0, status: "pending", hasResultFile });
  } catch {
    const hasResultFile = await projectFileExists(projectId, "05-serp-new-keywords-and-top-urls.json");
    return NextResponse.json({ percent: 0, status: "pending", hasResultFile });
  }
}
