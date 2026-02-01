import { NextResponse } from "next/server";
import { syncProjectToR2 } from "@/lib/storage/project-files";

const headers = { "cache-control": "no-store" };

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400, headers });
  }

  try {
    const result = await syncProjectToR2(projectId);
    return NextResponse.json({ projectId, ...result }, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to sync project";
    return NextResponse.json({ error: message }, { status: 500, headers });
  }
}
