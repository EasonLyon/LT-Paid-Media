import { NextResponse } from "next/server";
import { listOutputProjects } from "@/lib/storage/project-files";

const headers = { "cache-control": "no-store" };

export async function GET() {
  try {
    const projects = await listOutputProjects();
    const simplified = projects.map((project) => ({
      id: project.id,
      createdMs: project.createdMs,
      fileCount: project.files.length,
    }));
    return NextResponse.json({ projects: simplified }, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to load projects";
    return NextResponse.json({ error: message }, { status: 500, headers });
  }
}
