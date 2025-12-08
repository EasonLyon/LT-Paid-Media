import { NextResponse } from "next/server";
import { listProjectFileSummaries, projectFilePath, readOutputFile, writeProjectText } from "@/lib/storage/project-files";

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

  const headers = { "cache-control": "no-store" };

  if (!file) {
    try {
      const summaries = await listProjectFileSummaries(projectId);
      const files = summaries
        .filter((entry) => {
          if (includeAll) return true;
          const allowed = extensionFilters.length > 0 ? extensionFilters : DEFAULT_EXTENSIONS;
          return allowed.some((ext) => entry.name.toLowerCase().endsWith(ext));
        })
        .map((entry) => entry.name);
      return NextResponse.json({ files: files.sort() }, { headers });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return NextResponse.json({ files: [] }, { headers });
      }
      const message = err instanceof Error ? err.message : "Unable to read project files";
      return NextResponse.json({ error: message }, { status: 500, headers });
    }
  }

  if (!SAFE_FILENAME.test(file) || file.includes("..") || file.includes("/") || file.includes("\\")) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400, headers });
  }

  try {
    const { content, isJson, parsed } = await readOutputFile(projectId, file);

    if (mode === "download") {
      const contentType = inferContentType(file);
      return new NextResponse(content, {
        headers: {
          ...headers,
          "content-type": contentType,
          "content-disposition": `attachment; filename="${file}"`,
        },
      });
    }

    if (mode === "text") {
      return NextResponse.json({ file, content, isJson, parsed }, { headers });
    }

    if (!isJson || parsed === null) {
      return NextResponse.json({ error: "File is not valid JSON" }, { status: 400, headers });
    }
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
    await writeProjectText(projectId, file, content, inferContentType(file));
    return NextResponse.json(
      { saved: true, file, path: projectFilePath(projectId, file) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to save file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
