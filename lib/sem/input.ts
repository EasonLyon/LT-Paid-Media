import fs from "fs/promises";
import { NormalizedProjectInitInput, ProjectInitInput } from "@/types/sem";
import { ensureOutputRoot, ensureProjectFolder, writeProjectJson } from "../storage/project-files";

function pad(num: number): string {
  return num.toString().padStart(2, "0");
}

export function normalizeProjectInitInput(input: ProjectInitInput): NormalizedProjectInitInput {
  const website = input.website?.trim();
  if (!website) {
    throw new Error("website is required");
  }

  const normalizeStateList = (state?: string | string[] | null): string[] | null => {
    if (!state) return null;
    if (Array.isArray(state)) {
      const filtered = state.map((s) => s.trim()).filter(Boolean);
      return filtered.length ? filtered : null;
    }
    const parts = state
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : null;
  };

  return {
    website,
    goal: (input.goal ?? "Lead").trim() || "Lead",
    location: (input.location ?? "Malaysia").trim() || "Malaysia",
    state_list: normalizeStateList(input.state_list),
    language: (input.language ?? "English").trim() || "English",
  };
}

export async function buildProjectId(): Promise<string> {
  console.log("[buildProjectId] start");
  const outputRoot = await ensureOutputRoot();
  const now = new Date();
  const prefix = `${now.getFullYear().toString()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}`;

  let maxIndex = 0;
  try {
    const entries = await fs.readdir(outputRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith(prefix)) continue;
      const parts = entry.name.split("-");
      const indexStr = parts[2];
      const index = Number(indexStr);
      if (!Number.isNaN(index)) {
        maxIndex = Math.max(maxIndex, index);
      }
    }
  } catch (err) {
    console.warn("[buildProjectId] unable to scan output root", err);
  }

  const nextIndex = maxIndex + 1;
  const projectId = `${prefix}-${nextIndex.toString().padStart(3, "0")}`;
  await ensureProjectFolder(projectId);
  console.log(`[buildProjectId] generated ${projectId}`);
  return projectId;
}

export async function previewNextProjectId(): Promise<string> {
  const outputRoot = await ensureOutputRoot();
  const now = new Date();
  const prefix = `${now.getFullYear().toString()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}`;

  let maxIndex = 0;
  try {
    const entries = await fs.readdir(outputRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith(prefix)) continue;
      const parts = entry.name.split("-");
      const indexStr = parts[2];
      const index = Number(indexStr);
      if (!Number.isNaN(index)) {
        maxIndex = Math.max(maxIndex, index);
      }
    }
  } catch (err) {
    console.warn("[previewNextProjectId] unable to scan output root", err);
  }

  const nextIndex = maxIndex + 1;
  return `${prefix}-${nextIndex.toString().padStart(3, "0")}`;
}

export { ensureProjectFolder };

export async function persistProjectInitInput(
  projectId: string,
  rawInput: ProjectInitInput,
  normalizedInput: NormalizedProjectInitInput,
): Promise<string> {
  return writeProjectJson(projectId, "00", "user-input.json", {
    receivedAt: new Date().toISOString(),
    rawInput,
    normalizedInput,
  });
}
