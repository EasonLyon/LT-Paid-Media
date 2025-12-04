import fs from "fs/promises";
import path from "path";

const OUTPUT_ROOT = path.join(process.cwd(), "output");
const SAFE_ENTRY_NAME = /^[a-zA-Z0-9._-]+$/;

export type OutputFileSummary = {
  name: string;
  size: number;
  modifiedMs: number;
};

export type OutputProjectSummary = {
  id: string;
  files: OutputFileSummary[];
  totalSize: number;
  createdMs: number;
};

export async function ensureOutputRoot(): Promise<string> {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  return OUTPUT_ROOT;
}

export async function ensureProjectFolder(projectId: string): Promise<string> {
  const root = await ensureOutputRoot();
  const folder = path.join(root, projectId);
  await fs.mkdir(folder, { recursive: true });
  return folder;
}

export function projectFilePath(projectId: string, filename: string): string {
  return path.join(OUTPUT_ROOT, projectId, filename);
}

export async function writeProjectJson(
  projectId: string,
  index: string | number,
  filename: string,
  data: unknown,
): Promise<string> {
  const folder = await ensureProjectFolder(projectId);
  const prefix = typeof index === "number" ? index.toString().padStart(2, "0") : index;
  const finalName = `${prefix}-${filename}`;
  const target = path.join(folder, finalName);
  await fs.writeFile(target, JSON.stringify(data, null, 2), "utf8");
  return target;
}

export async function readProjectJson<T>(projectId: string, filename: string): Promise<T> {
  const fullPath = projectFilePath(projectId, filename);
  const raw = await fs.readFile(fullPath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeProjectProgress(
  projectId: string,
  filename: string,
  data: unknown,
): Promise<string> {
  const folder = await ensureProjectFolder(projectId);
  const target = path.join(folder, filename);
  await fs.writeFile(target, JSON.stringify(data, null, 2), "utf8");
  return target;
}

export async function readProjectProgress<T>(projectId: string, filename: string): Promise<T | null> {
  try {
    const fullPath = projectFilePath(projectId, filename);
    const raw = await fs.readFile(fullPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function assertSafeName(value: string, label: string) {
  if (!SAFE_ENTRY_NAME.test(value) || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new Error(`Invalid ${label}`);
  }
}

export async function listOutputProjects(): Promise<OutputProjectSummary[]> {
  const root = await ensureOutputRoot();
  const entries = await fs.readdir(root, { withFileTypes: true });

  const projects = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && SAFE_ENTRY_NAME.test(entry.name))
      .map(async (entry) => {
        const folder = path.join(root, entry.name);
        const stats = await fs.stat(folder);
        const createdMs =
          (Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0
            ? stats.birthtimeMs
            : Number.isFinite(stats.ctimeMs)
            ? stats.ctimeMs
            : null) ?? stats.mtimeMs;
        const files = await fs.readdir(folder, { withFileTypes: true });
        const summaries = await Promise.all(
          files
            .filter((file) => file.isFile())
            .map(async (file) => {
              const fullPath = path.join(folder, file.name);
              const stats = await fs.stat(fullPath);
              return { name: file.name, size: stats.size, modifiedMs: stats.mtimeMs };
            }),
        );
        const totalSize = summaries.reduce((sum, file) => sum + file.size, 0);
        return {
          id: entry.name,
          files: summaries.sort((a, b) => a.name.localeCompare(b.name)),
          totalSize,
          createdMs,
        };
      }),
  );

  return projects.sort((a, b) => {
    if (a.createdMs !== b.createdMs) return b.createdMs - a.createdMs;
    return b.id.localeCompare(a.id);
  });
}

export async function deleteOutputFile(projectId: string, filename: string): Promise<boolean> {
  assertSafeName(projectId, "project id");
  assertSafeName(filename, "file name");
  const fullPath = projectFilePath(projectId, filename);

  try {
    const stats = await fs.stat(fullPath);
    if (!stats.isFile()) {
      throw new Error("Target is not a file");
    }
    await fs.unlink(fullPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

export async function deleteOutputProject(projectId: string): Promise<boolean> {
  assertSafeName(projectId, "project id");
  const folder = path.join(OUTPUT_ROOT, projectId);
  try {
    await fs.access(folder);
  } catch {
    return false;
  }
  await fs.rm(folder, { recursive: true, force: true });
  return true;
}

export async function readOutputFile(projectId: string, filename: string): Promise<{
  content: string;
  isJson: boolean;
  parsed: unknown | null;
}> {
  assertSafeName(projectId, "project id");
  assertSafeName(filename, "file name");
  const fullPath = projectFilePath(projectId, filename);
  let content: string;
  try {
    content = await fs.readFile(fullPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("File not found");
    }
    throw err;
  }
  try {
    const parsed = JSON.parse(content);
    return { content, isJson: true, parsed };
  } catch {
    return { content, isJson: false, parsed: null };
  }
}
