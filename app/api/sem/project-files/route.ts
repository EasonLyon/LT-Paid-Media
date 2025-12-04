import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { ensureProjectFolder, projectFilePath } from "@/lib/storage/project-files";

const SAFE_FILENAME = /^[a-zA-Z0-9._-]+$/;
const DEFAULT_EXTENSIONS = [".json"];

function parseExtensions(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith(".") ? item : `.${item}`));
}

function inferContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const file = searchParams.get("file");
  const mode = searchParams.get("mode") ?? "json";
  const includeAll = searchParams.get("include") === "all" || searchParams.get("include") === "any";
  const extensionFilters = parseExtensions(searchParams.get("extensions"));

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const projectFolder = path.join(process.cwd(), "output", projectId);
  const headers = { "cache-control": "no-store" };

  if (!file) {
    try {
      const entries = await fs.readdir(projectFolder, { withFileTypes: true });
      const files = entries
        .filter((entry) => {
          if (!entry.isFile()) return false;
          if (includeAll) return true;
          const allowed = extensionFilters.length > 0 ? extensionFilters : DEFAULT_EXTENSIONS;
          return allowed.some((ext) => entry.name.toLowerCase().endsWith(ext));
        })
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
    const parsedFromRaw = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })();
    const isJson = parsedFromRaw !== null;

    if (mode === "download") {
      const contentType = inferContentType(file);
      return new NextResponse(raw, {
        headers: {
          ...headers,
          "content-type": contentType,
          "content-disposition": `attachment; filename="${file}"`,
        },
      });
    }

    if (mode === "text") {
      return NextResponse.json({ file, content: raw, isJson, parsed: parsedFromRaw }, { headers });
    }

    if (!isJson || parsedFromRaw === null) {
      return NextResponse.json({ error: "File is not valid JSON" }, { status: 400, headers });
    }
    return NextResponse.json({ file, data: parsedFromRaw }, { headers });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return NextResponse.json({ error: "File not found" }, { status: 404, headers });
    }
    const message = err instanceof Error ? err.message : "Unable to read file";
    return NextResponse.json({ error: message }, { status: 500, headers });
  }
}

export async function PUT(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const file = searchParams.get("file");

  if (!projectId || !file) {
    return NextResponse.json({ error: "projectId and file are required" }, { status: 400 });
  }
  if (!SAFE_FILENAME.test(projectId) || !SAFE_FILENAME.test(file) || file.includes("..")) {
    return NextResponse.json({ error: "Invalid projectId or file" }, { status: 400 });
  }

  let content: unknown;
  try {
    const body = (await req.json()) as { content?: unknown };
    content = body.content;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (typeof content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }

  try {
    await ensureProjectFolder(projectId);
    const fullPath = projectFilePath(projectId, file);
    await fs.writeFile(fullPath, content, "utf8");
    return NextResponse.json({ saved: true, file }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to save file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
