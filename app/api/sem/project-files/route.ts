import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { projectFilePath } from "@/lib/storage/project-files";

const SAFE_FILENAME = /^[a-zA-Z0-9._-]+$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const file = searchParams.get("file");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const projectFolder = path.join(process.cwd(), "output", projectId);
  const headers = { "cache-control": "no-store" };

  if (!file) {
    try {
      const entries = await fs.readdir(projectFolder, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort();
      return NextResponse.json({ files }, { headers });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json({ files: [] }, { headers });
      }
      const message = err instanceof Error ? err.message : "Unable to read project folder";
      return NextResponse.json({ error: message }, { status: 500, headers });
    }
  }

  if (!SAFE_FILENAME.test(file) || file.includes("..") || file.includes("/") || file.includes("\\")) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400, headers });
  }

  try {
    const fullPath = projectFilePath(projectId, file);
    const raw = await fs.readFile(fullPath, "utf8");
    const parsed = JSON.parse(raw);
    return NextResponse.json({ file, data: parsed }, { headers });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return NextResponse.json({ error: "File not found" }, { status: 404, headers });
    }
    const message = err instanceof Error ? err.message : "Unable to read file";
    return NextResponse.json({ error: message }, { status: 500, headers });
  }
}
