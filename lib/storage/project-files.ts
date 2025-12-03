import fs from "fs/promises";
import path from "path";

const OUTPUT_ROOT = path.join(process.cwd(), "output");

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
