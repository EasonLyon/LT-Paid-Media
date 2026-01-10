import fs from "fs/promises";
import path from "path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  _Object,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { getR2Client, isR2Enabled } from "./r2";

const OUTPUT_ROOT = path.join(process.cwd(), "output");
const SAFE_ENTRY_NAME = /^[a-zA-Z0-9._-]+$/;
const storageMode: "r2" | "local" = isR2Enabled ? "r2" : "local";

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
  websiteDomain?: string | null;
};

function assertSafeName(value: string, label: string) {
  if (!SAFE_ENTRY_NAME.test(value) || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new Error(`Invalid ${label}`);
  }
}

async function streamToString(body: unknown): Promise<string> {
  if (!body) return "";
  const candidate = body as { transformToString?: () => Promise<string> };
  if (typeof candidate.transformToString === "function") {
    return candidate.transformToString();
  }
  const readable = body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function objectKey(projectId: string, filename: string): string {
  assertSafeName(projectId, "project id");
  assertSafeName(filename, "file name");
  return `${projectId}/${filename}`;
}

async function listAllObjects(prefix?: string): Promise<_Object[]> {
  const { client, bucket } = getR2Client();
  let token: string | undefined;
  const results: _Object[] = [];
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    (response.Contents ?? []).forEach((item) => results.push(item));
    token = response.IsTruncated ? response.NextContinuationToken ?? undefined : undefined;
  } while (token);
  return results;
}

export async function ensureOutputRoot(): Promise<string> {
  if (storageMode === "local") {
    await fs.mkdir(OUTPUT_ROOT, { recursive: true });
    return OUTPUT_ROOT;
  }
  return getR2Client().bucket;
}

export async function ensureProjectFolder(projectId: string): Promise<string> {
  assertSafeName(projectId, "project id");
  if (storageMode === "local") {
    const root = await ensureOutputRoot();
    const folder = path.join(root, projectId);
    await fs.mkdir(folder, { recursive: true });
    return folder;
  }
  return projectId;
}

export function projectFilePath(projectId: string, filename: string): string {
  if (storageMode === "local") {
    return path.join(OUTPUT_ROOT, projectId, filename);
  }
  return objectKey(projectId, filename);
}

async function writeProjectFile(
  projectId: string,
  filename: string,
  content: string,
  contentType?: string,
): Promise<string> {
  const target = projectFilePath(projectId, filename);
  if (storageMode === "local") {
    const folder = await ensureProjectFolder(projectId);
    const fullPath = path.join(folder, filename);
    await fs.writeFile(fullPath, content, "utf8");
    return fullPath;
  }
  const { client, bucket } = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: target,
      Body: content,
      ContentType: contentType ?? "text/plain; charset=utf-8",
    }),
  );
  return target;
}

async function readProjectFile(projectId: string, filename: string): Promise<string> {
  const target = projectFilePath(projectId, filename);
  if (storageMode === "local") {
    return fs.readFile(target, "utf8");
  }
  const { client, bucket } = getR2Client();
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: target,
      }),
    );
    return streamToString(response.Body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Unable to read ${filename}: ${message}`);
  }
}

export async function writeProjectJson(
  projectId: string,
  index: string | number,
  filename: string,
  data: unknown,
): Promise<string> {
  const prefix = typeof index === "number" ? index.toString().padStart(2, "0") : index;
  const finalName = `${prefix}-${filename}`;
  const payload = JSON.stringify(data, null, 2);
  return writeProjectFile(projectId, finalName, payload, "application/json; charset=utf-8");
}

export async function readProjectJson<T>(projectId: string, filename: string): Promise<T> {
  const raw = await readProjectFile(projectId, filename);
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const prefix = raw.trim().slice(0, 80);
    const looksLikeHtml = prefix.startsWith("<");
    const parsedMessage = err instanceof Error ? err.message : "Unknown JSON parse error";
    const hint = looksLikeHtml
      ? "Received HTML instead of JSON (likely an error page or corrupted file)."
      : "Unable to parse JSON content.";
    throw new Error(`Unable to parse ${filename}: ${parsedMessage}. ${hint}`);
  }
}

export async function writeProjectProgress(
  projectId: string,
  filename: string,
  data: unknown,
): Promise<string> {
  const payload = JSON.stringify(data, null, 2);
  return writeProjectFile(projectId, filename, payload, "application/json; charset=utf-8");
}

export async function readProjectProgress<T>(projectId: string, filename: string): Promise<T | null> {
  try {
    const raw = await readProjectFile(projectId, filename);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function projectFileExists(projectId: string, filename: string): Promise<boolean> {
  const target = projectFilePath(projectId, filename);
  if (storageMode === "local") {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
  const { client, bucket } = getR2Client();
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: target,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

async function listProjectFiles(projectId: string): Promise<OutputFileSummary[]> {
  assertSafeName(projectId, "project id");
  if (storageMode === "local") {
    const folder = path.join(OUTPUT_ROOT, projectId);
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const fullPath = path.join(folder, entry.name);
          const stats = await fs.stat(fullPath);
          return { name: entry.name, size: stats.size, modifiedMs: stats.mtimeMs };
        }),
    );
    return summaries;
  }

  const objects = await listAllObjects(`${projectId}/`);
  return objects
    .map((item) => {
      const key = item.Key ?? "";
      const parts = key.split("/");
      if (parts.length < 2) return null;
      const fileName = parts.slice(1).join("/");
      if (!fileName || !SAFE_ENTRY_NAME.test(fileName)) return null;
      return {
        name: fileName,
        size: item.Size ?? 0,
        modifiedMs: item.LastModified ? item.LastModified.getTime() : Date.now(),
      };
    })
    .filter((entry): entry is OutputFileSummary => Boolean(entry));
}

function normalizeDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const withoutWww = trimmed.startsWith("www.") ? trimmed.slice(4) : trimmed;
  return withoutWww || null;
}

function normalizeDomainFromUrl(input: string): string | null {
  const candidate = input.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return normalizeDomain(url.hostname) || null;
  } catch {
    const withoutProtocol = candidate.replace(/^https?:\/\//i, "");
    const host = withoutProtocol.split("/")[0];
    return normalizeDomain(host);
  }
}

async function extractWebsiteDomain(projectId: string): Promise<string | null> {
  try {
    const parsed = await readProjectJson<{
      rawInput?: { website?: unknown };
      normalizedInput?: { website?: unknown };
    }>(projectId, "00-user-input.json");
    const website =
      (typeof parsed?.normalizedInput?.website === "string" && parsed.normalizedInput.website) ||
      (typeof parsed?.rawInput?.website === "string" && parsed.rawInput.website);
    if (!website) return null;
    return normalizeDomainFromUrl(website);
  } catch {
    return null;
  }
}

export async function listOutputProjects(): Promise<OutputProjectSummary[]> {
  if (storageMode === "local") {
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
          const files = await listProjectFiles(entry.name);
          const totalSize = files.reduce((sum, file) => sum + file.size, 0);
          const websiteDomain = await extractWebsiteDomain(entry.name);
          return {
            id: entry.name,
            files: files.sort((a, b) => a.name.localeCompare(b.name)),
            totalSize,
            createdMs,
            websiteDomain,
          };
        }),
    );

    return projects.sort((a, b) => {
      if (a.createdMs !== b.createdMs) return b.createdMs - a.createdMs;
      return b.id.localeCompare(a.id);
    });
  }

  const objects = await listAllObjects();
  const projectMap = new Map<string, { files: OutputFileSummary[]; createdMs: number }>();
  for (const item of objects) {
    const key = item.Key ?? "";
    const parts = key.split("/");
    if (parts.length < 2) continue;
    const [projectId, ...rest] = parts;
    if (!SAFE_ENTRY_NAME.test(projectId)) continue;
    const fileName = rest.join("/");
    if (!fileName || !SAFE_ENTRY_NAME.test(fileName)) continue;

    const entry = projectMap.get(projectId) ?? { files: [], createdMs: Number.POSITIVE_INFINITY };
    const modifiedMs = item.LastModified ? item.LastModified.getTime() : Date.now();
    entry.files.push({
      name: fileName,
      size: item.Size ?? 0,
      modifiedMs,
    });
    entry.createdMs = Math.min(entry.createdMs, modifiedMs);
    projectMap.set(projectId, entry);
  }

  const projects: OutputProjectSummary[] = [];
  for (const [id, data] of projectMap.entries()) {
    const websiteDomain = await extractWebsiteDomain(id);
    const totalSize = data.files.reduce((sum, file) => sum + file.size, 0);
    projects.push({
      id,
      files: data.files.sort((a, b) => a.name.localeCompare(b.name)),
      totalSize,
      createdMs: data.createdMs === Number.POSITIVE_INFINITY ? Date.now() : data.createdMs,
      websiteDomain,
    });
  }

  return projects.sort((a, b) => {
    if (a.createdMs !== b.createdMs) return b.createdMs - a.createdMs;
    return b.id.localeCompare(a.id);
  });
}

export async function deleteOutputFile(projectId: string, filename: string): Promise<boolean> {
  assertSafeName(projectId, "project id");
  assertSafeName(filename, "file name");
  const target = projectFilePath(projectId, filename);

  if (storageMode === "local") {
    try {
      const stats = await fs.stat(target);
      if (!stats.isFile()) {
        throw new Error("Target is not a file");
      }
      await fs.unlink(target);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  const { client, bucket } = getR2Client();
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: target,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function deleteOutputProject(projectId: string): Promise<boolean> {
  assertSafeName(projectId, "project id");
  if (storageMode === "local") {
    const folder = path.join(OUTPUT_ROOT, projectId);
    try {
      await fs.access(folder);
    } catch {
      return false;
    }
    await fs.rm(folder, { recursive: true, force: true });
    return true;
  }

  const objects = await listAllObjects(`${projectId}/`);
  if (!objects.length) return false;
  const { client, bucket } = getR2Client();
  await Promise.all(
    objects.map((item) =>
      client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: item.Key,
        }),
      ),
    ),
  );
  return true;
}

export async function readOutputFile(projectId: string, filename: string): Promise<{
  content: string;
  isJson: boolean;
  parsed: unknown | null;
}> {
  assertSafeName(projectId, "project id");
  assertSafeName(filename, "file name");
  const content = await readProjectFile(projectId, filename);
  try {
    const parsed = JSON.parse(content);
    return { content, isJson: true, parsed };
  } catch {
    return { content, isJson: false, parsed: null };
  }
}

export async function writeProjectText(
  projectId: string,
  filename: string,
  content: string,
  contentType?: string,
): Promise<string> {
  return writeProjectFile(projectId, filename, content, contentType);
}

export async function listProjectFileSummaries(projectId: string): Promise<OutputFileSummary[]> {
  const files = await listProjectFiles(projectId);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readProjectText(projectId: string, filename: string): Promise<string> {
  return readProjectFile(projectId, filename);
}

export async function duplicateOutputProject(
  sourceProjectId: string,
  targetProjectId: string,
): Promise<{ copied: number }> {
  assertSafeName(sourceProjectId, "project id");
  assertSafeName(targetProjectId, "project id");
  if (sourceProjectId === targetProjectId) {
    throw new Error("Source and target project IDs must be different");
  }

  if (storageMode === "local") {
    const sourceFolder = path.join(OUTPUT_ROOT, sourceProjectId);
    const targetFolder = path.join(OUTPUT_ROOT, targetProjectId);
    try {
      await fs.access(sourceFolder);
    } catch {
      throw new Error("Source project does not exist");
    }
    try {
      await fs.access(targetFolder);
      throw new Error("Target project already exists");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    const files = await listProjectFiles(sourceProjectId);
    if (files.length === 0) {
      throw new Error("Source project has no files to duplicate");
    }
    await fs.mkdir(targetFolder, { recursive: true });
    await Promise.all(
      files.map((file) =>
        fs.copyFile(path.join(sourceFolder, file.name), path.join(targetFolder, file.name)),
      ),
    );
    return { copied: files.length };
  }

  const sourceObjects = await listAllObjects(`${sourceProjectId}/`);
  if (!sourceObjects.length) {
    throw new Error("Source project has no files to duplicate");
  }

  const targetObjects = await listAllObjects(`${targetProjectId}/`);
  if (targetObjects.length) {
    throw new Error("Target project already exists");
  }

  const { client, bucket } = getR2Client();
  let copied = 0;
  for (const item of sourceObjects) {
    const key = item.Key ?? "";
    const parts = key.split("/");
    if (parts.length < 2) continue;
    const fileName = parts.slice(1).join("/");
    if (!fileName || !SAFE_ENTRY_NAME.test(fileName)) continue;
    const sourceKey = key;
    const targetKey = `${targetProjectId}/${fileName}`;
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: sourceKey,
      }),
    );
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: targetKey,
        Body: response.Body ?? "",
      }),
    );
    copied += 1;
  }
  if (copied === 0) {
    throw new Error("Source project has no files to duplicate");
  }
  return { copied };
}
