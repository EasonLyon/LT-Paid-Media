import { NormalizedProjectInitInput, ProjectInitInput } from "@/types/sem";
import { ensureProjectFolder, listOutputProjects, writeProjectJson } from "../storage/project-files";

const SAFE_PROJECT_ID = /^[a-zA-Z0-9._-]+$/;

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

  const normalizeAdSpend = (value: unknown): number => {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
        ? Number(value.replace(/,/g, ""))
        : null;
    if (parsed === null || Number.isNaN(parsed) || !Number.isFinite(parsed)) return 1000;
    return Math.max(1000, Math.round(parsed));
  };

  return {
    website,
    goal: (input.goal ?? "Lead").trim() || "Lead",
    location: (input.location ?? "Malaysia").trim() || "Malaysia",
    state_list: normalizeStateList(input.state_list),
    language: (input.language ?? "English").trim() || "English",
    monthly_adspend_myr: normalizeAdSpend(input.monthly_adspend_myr),
  };
}

export async function buildProjectId(): Promise<string> {
  console.log("[buildProjectId] start");
  const now = new Date();
  const prefix = `${now.getFullYear().toString()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}`;

  let maxIndex = 0;
  try {
    const projects = await listOutputProjects();
    for (const project of projects) {
      if (!project.id.startsWith(prefix)) continue;
      const parts = project.id.split("-");
      const indexStr = parts[2];
      const index = Number(indexStr);
      if (!Number.isNaN(index)) {
        maxIndex = Math.max(maxIndex, index);
      }
    }
  } catch (err) {
    console.warn("[buildProjectId] unable to scan output projects", err);
  }

  const nextIndex = maxIndex + 1;
  const projectId = `${prefix}-${nextIndex.toString().padStart(3, "0")}`;
  await ensureProjectFolder(projectId);
  console.log(`[buildProjectId] generated ${projectId}`);
  return projectId;
}

function normalizeProjectId(candidate?: string | null): string | null {
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  if (!SAFE_PROJECT_ID.test(trimmed) || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return trimmed;
}

export async function resolveProjectId(requested?: string | null): Promise<string> {
  const normalized = normalizeProjectId(requested);
  if (normalized) {
    await ensureProjectFolder(normalized);
    console.log(`[resolveProjectId] using provided projectId ${normalized}`);
    return normalized;
  }
  return buildProjectId();
}

export async function previewNextProjectId(): Promise<string> {
  const now = new Date();
  const prefix = `${now.getFullYear().toString()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}`;

  let maxIndex = 0;
  try {
    const projects = await listOutputProjects();
    for (const project of projects) {
      if (!project.id.startsWith(prefix)) continue;
      const parts = project.id.split("-");
      const indexStr = parts[2];
      const index = Number(indexStr);
      if (!Number.isNaN(index)) {
        maxIndex = Math.max(maxIndex, index);
      }
    }
  } catch (err) {
    console.warn("[previewNextProjectId] unable to scan output projects", err);
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
