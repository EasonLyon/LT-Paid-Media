'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CampaignPlan, CampaignStructureRow, NormalizedProjectInitInput, ProjectInitInput, Tier } from "@/types/sem";

type StepResponse = Record<string, unknown>;

const tierDetails: Record<Tier, { label: string; description: string }> = {
  A: {
    label: "Excellent",
    description: "Top-performing keywords to prioritize and allocate the most budget toward.",
  },
  B: {
    label: "Average",
    description: "Solid keywords to test and expand with moderate budget.",
  },
  C: {
    label: "Poor",
    description: "Early-stage or long-tail ideas to monitor with limited spend.",
  },
};

interface StartFormState {
  website: string;
  goal: string;
  location: string;
  state_list: string;
  language: string;
  monthly_adspend_myr: number;
  context: string;
}

type StepKey =
  | "start"
  | "search"
  | "serp"
  | "site"
  | "combine"
  | "score"
  | "campaign"
  | "campaignPlan"
  | "visualizer";
type CollapsibleKey = "project" | "step1" | "runSteps" | "step7" | "step8" | "step9";

interface StepStatus {
  status: "idle" | "running" | "success" | "error";
  message?: string;
}

interface ExistingProjectSummary {
  id: string;
  createdMs: number;
  fileCount: number;
  websiteDomain?: string | null;
}

type TierSelection = Record<Tier, boolean>;

interface CampaignFiltersState {
  tiers: TierSelection;
  paidFlag: boolean;
  seoFlag: boolean;
}

interface AppliedCampaignFilters {
  tiers: Tier[];
  paidFlag: boolean;
  seoFlag: boolean;
}

const MIN_AD_SPEND_MYR = 1000;
const MAX_SLIDER_AD_SPEND_MYR = 50000;
const GOAL_OPTIONS = ["Lead", "Traffic", "Sales", "Awareness"];
const LOCATION_OPTIONS = ["Malaysia", "Singapore", "Indonesia", "Philippines", "Thailand"];
const LANGUAGE_OPTIONS = ["English", "Malay", "Chinese", "Tamil"];
const OTHER_VALUE = "__other";

const DEFAULT_START_FORM: StartFormState = {
  website: "",
  goal: "Lead",
  location: "Malaysia",
  state_list: "",
  language: "English",
  monthly_adspend_myr: 5000,
  context: "",
};

function toStateListString(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .join(", ");
  }
  return typeof value === "string" ? value : "";
}

function coerceAdSpend(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function buildStartFormFromInput(
  source: Partial<ProjectInitInput> | Partial<NormalizedProjectInitInput> | null | undefined,
): StartFormState {
  const fallback = DEFAULT_START_FORM;
  if (!source || typeof source !== "object") return fallback;
  const stateListValue =
    "state_list" in source
      ? (source as ProjectInitInput | NormalizedProjectInitInput).state_list
      : (source as { state_list?: unknown }).state_list;
  const adSpend =
    (source as ProjectInitInput).monthly_adspend_myr ?? (source as NormalizedProjectInitInput).monthly_adspend_myr;

  return {
    website: typeof source.website === "string" ? source.website : fallback.website,
    goal: typeof source.goal === "string" && source.goal ? source.goal : fallback.goal,
    location: typeof source.location === "string" && source.location ? source.location : fallback.location,
    state_list: toStateListString(stateListValue),
    language: typeof source.language === "string" && source.language ? source.language : fallback.language,
    monthly_adspend_myr: coerceAdSpend(adSpend, fallback.monthly_adspend_myr),
    context: typeof source.context === "string" ? source.context : fallback.context,
  };
}

function useLogs() {
  const [logs, setLogs] = useState<string[]>([]);
  const push = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${timestamp}] ${message}`, ...prev]);
  }, []);
  return { logs, push };
}

interface CollapsibleSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function CollapsibleSection({ title, isOpen, onToggle, children }: CollapsibleSectionProps) {
  return (
    <section className="border rounded-lg border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-xl font-medium text-slate-900 dark:text-white">{title}</h2>
        <button
          type="button"
          className="inline-flex items-center gap-2 border rounded px-3 py-1 text-sm bg-white hover:bg-blue-50 transition-colors dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          aria-expanded={isOpen}
          onClick={onToggle}
        >
          <span>{isOpen ? "Collapse" : "Expand"}</span>
          <span className={`transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden>
            ▾
          </span>
        </button>
      </div>
      {isOpen && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </section>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="M8.5 11.5 12 15l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 18h16" strokeLinecap="round" />
    </svg>
  );
}

async function callApi<T extends StepResponse = StepResponse>(endpoint: string, payload: Record<string, unknown>) {
  const res = await fetch(`/api/sem/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();

  let parsed: unknown;
  try {
    parsed = raw ? (JSON.parse(raw) as unknown) : {};
  } catch (err) {
    const snippet = raw.trim().slice(0, 200).replace(/\s+/g, " ");
    const parseMessage = err instanceof Error ? err.message : "Unknown parse failure";
    const summary = snippet ? ` Response preview: "${snippet}"` : " Response was empty.";
    throw new Error(
      `Unexpected non-JSON response from /api/sem/${endpoint}: ${parseMessage}.${summary} (status ${res.status})`,
    );
  }

  if (!res.ok) {
    const parsedStep = parsed as StepResponse;
    const messageFromError = typeof parsedStep.error === "string" ? parsedStep.error : undefined;
    const messageFromMessage =
      typeof (parsedStep as { message?: string }).message === "string"
        ? (parsedStep as { message: string }).message
        : undefined;
    const message = messageFromError ?? messageFromMessage ?? res.statusText;
    throw new Error(message);
  }
  return parsed as T;
}

function buildLocalProjectIdFallback(): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  const now = new Date();
  const prefix = `${now.getFullYear().toString()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}`;
  const suffix = `${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${suffix}`;
}

function getShortFileLabel(filename: string): string {
  const dashIndex = filename.indexOf("-");
  if (dashIndex > 0) {
    return filename.slice(0, dashIndex);
  }
  return filename;
}

export default function SemPage() {
  const [projectId, setProjectId] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);
  const [existingProjects, setExistingProjects] = useState<ExistingProjectSummary[]>([]);
  const [isFetchingProjects, setIsFetchingProjects] = useState(false);
  const [projectListError, setProjectListError] = useState<string | null>(null);
  const [availableFiles, setAvailableFiles] = useState<string[]>([]);
  const [isFetchingFiles, setIsFetchingFiles] = useState(false);
  const [fileListError, setFileListError] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState<string>("");
  const [fileTypeFilter, setFileTypeFilter] = useState<"json" | "csv" | "any">("json");
  const [hideStepFiles, setHideStepFiles] = useState<boolean>(true);
  const [selectedFilesForDownload, setSelectedFilesForDownload] = useState<Set<string>>(() => new Set());
  const [isDownloadingFiles, setIsDownloadingFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string>("");
  const [fileContentMeta, setFileContentMeta] = useState<{ isJson: boolean } | null>(null);
  const [isLoadingFileContent, setIsLoadingFileContent] = useState(false);
  const [isSavingFileContent, setIsSavingFileContent] = useState(false);
  const [fileViewerError, setFileViewerError] = useState<string | null>(null);
  const [fileViewerMessage, setFileViewerMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [step1Elapsed, setStep1Elapsed] = useState<number>(0);
  const { logs, push } = useLogs();
  const [stepStatuses, setStepStatuses] = useState<Record<StepKey, StepStatus>>({
    start: { status: "idle" },
    search: { status: "idle" },
    serp: { status: "idle" },
    site: { status: "idle" },
    combine: { status: "idle" },
    score: { status: "idle" },
    campaign: { status: "idle" },
    campaignPlan: { status: "idle" },
    visualizer: { status: "idle" },
  });

  const [startForm, setStartForm] = useState<StartFormState>({ ...DEFAULT_START_FORM });
  const [adSpendInput, setAdSpendInput] = useState<string>(DEFAULT_START_FORM.monthly_adspend_myr.toString());
  const [useCustomLocation, setUseCustomLocation] = useState<boolean>(
    !LOCATION_OPTIONS.includes(DEFAULT_START_FORM.location),
  );
  const [useCustomLanguage, setUseCustomLanguage] = useState<boolean>(
    !LANGUAGE_OPTIONS.includes(DEFAULT_START_FORM.language),
  );
  const [campaignFilters, setCampaignFilters] = useState<CampaignFiltersState>({
    tiers: { A: true, B: false, C: false },
    paidFlag: true,
    seoFlag: false,
  });
  const [campaignPreview, setCampaignPreview] = useState<CampaignStructureRow[]>([]);
  const [campaignCsvName, setCampaignCsvName] = useState<string | null>(null);
  const [campaignFiltersApplied, setCampaignFiltersApplied] = useState<AppliedCampaignFilters | null>(null);
  const [campaignPlanResult, setCampaignPlanResult] = useState<{
    fileName: string;
    campaigns: CampaignPlan[];
  } | null>(null);
  const [step8Elapsed, setStep8Elapsed] = useState<number>(0);
  const [openSections, setOpenSections] = useState<Record<CollapsibleKey, boolean>>({
    project: true,
    step1: true,
    runSteps: true,
    step7: true,
    step8: true,
    step9: true,
  });

  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
  } | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  const hasUserSetProjectIdRef = useRef(false);

  const stepCompletion = useMemo(
    () => ({
      start: availableFiles.some((file) => file.startsWith("00-")),
      search: availableFiles.some((file) => file.startsWith("03-keywords-enriched-with-search-volume")),
      serp: availableFiles.some((file) => file.startsWith("05-")),
      site: availableFiles.some((file) => file.startsWith("06-site-keywords-from-top-domains")),
      combine: availableFiles.some((file) => file.startsWith("07-all-keywords-combined-deduped")),
      score: availableFiles.some((file) => file.startsWith("08-")),
      campaign: availableFiles.some((file) => file.startsWith("09-")),
      campaignPlan: availableFiles.some((file) => file.startsWith("10-") || file.startsWith("11-")),
    }),
    [availableFiles],
  );

  const askConfirm = (title: string, message: string, confirmLabel = "Rerun", cancelLabel = "Use existing") =>
    new Promise<boolean>((resolve) => {
      confirmResolver.current = resolve;
      setConfirmDialog({ title, message, confirmLabel, cancelLabel });
    });

  const handleConfirmResponse = (value: boolean) => {
    confirmResolver.current?.(value);
    confirmResolver.current = null;
    setConfirmDialog(null);
  };

  const toggleSection = (key: CollapsibleKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleStart = async (e: FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    setProgress(0);
    startStep1Timer();
    updateStepStatus("start", { status: "running", message: "Running Step 1" });
    push("Starting Step 1 – OpenAI init");
    try {
      const payload = {
        projectId,
        website: startForm.website,
        goal: startForm.goal,
        location: startForm.location,
        state_list: startForm.state_list || undefined,
        language: startForm.language,
        monthly_adspend_myr: startForm.monthly_adspend_myr,
        context: startForm.context || undefined,
      };
      const res = await callApi<{ projectId: string }>("start", payload);
      setProjectId(res.projectId);
      persistProjectId(res.projectId);
      refreshProjectFiles(res.projectId);
      void refreshExistingProjects();
      push(`Step 1 done. projectId=${res.projectId}`);
      updateStepStatus("start", { status: "success", message: "Step 1 complete" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      push(`Step 1 failed: ${message}`);
      updateStepStatus("start", { status: "error", message });
    } finally {
      stopStep1Timer();
      setIsBusy(false);
    }
  };

  const refreshExistingProjects = useCallback(async () => {
    setIsFetchingProjects(true);
    setProjectListError(null);
    try {
      const res = await fetch("/api/sem/projects", { cache: "no-store" });
      const json = (await res.json()) as { projects?: ExistingProjectSummary[]; error?: string };
      if (!res.ok || json.error) {
        const message = json.error ?? res.statusText;
        throw new Error(message);
      }
      const projects = Array.isArray(json.projects) ? json.projects : [];
      const sorted = projects.sort((a, b) => (b.createdMs ?? 0) - (a.createdMs ?? 0));
      setExistingProjects(sorted);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to load projects";
      setExistingProjects([]);
      setProjectListError(message);
    } finally {
      setIsFetchingProjects(false);
    }
  }, []);

  useEffect(() => {
    const fetchSuggested = async () => {
      try {
        const stored = typeof window !== "undefined" ? window.localStorage.getItem("sem_projectId") : null;
        if (stored && !hasUserSetProjectIdRef.current) {
          setProjectId(stored);
          push(`Restored projectId: ${stored}`);
          refreshProjectFiles(stored);
          return;
        }
        const res = await fetch("/api/sem/next-project-id", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(res.statusText);
        }
        const json = (await res.json()) as { suggested?: string };
        if (json.suggested && !hasUserSetProjectIdRef.current) {
          setProjectId(json.suggested);
          persistProjectId(json.suggested);
          refreshProjectFiles(json.suggested);
          push(`Suggested projectId: ${json.suggested}`);
          return;
        }
        if (!hasUserSetProjectIdRef.current) {
          const fallback = buildLocalProjectIdFallback();
          setProjectId(fallback);
          persistProjectId(fallback);
          refreshProjectFiles(fallback);
          push(`Suggested projectId: ${fallback} (fallback)`);
        }
      } catch {
        if (!hasUserSetProjectIdRef.current) {
          const fallback = buildLocalProjectIdFallback();
          setProjectId(fallback);
          persistProjectId(fallback);
          refreshProjectFiles(fallback);
          push(`Suggested projectId: ${fallback} (fallback)`);
        }
      }
    };
    fetchSuggested();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshExistingProjects();
  }, [refreshExistingProjects]);

  useEffect(() => {
    return () => {
      stopStep1Timer();
      stopStep8Timer();
    };
  }, []);

  const persistProjectId = (value: string) => {
    try {
      if (value) {
        window.localStorage.setItem("sem_projectId", value);
      } else {
        window.localStorage.removeItem("sem_projectId");
      }
    } catch {
      // ignore storage errors
    }
  };

  const refreshProjectFiles = useCallback(async (pid: string) => {
    if (!pid) {
      setAvailableFiles([]);
      return;
    }
    setIsFetchingFiles(true);
    setFileListError(null);
    try {
      const res = await fetch(`/api/sem/project-files?projectId=${encodeURIComponent(pid)}&include=all`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { files?: string[]; error?: string };
      if (!res.ok || json.error) {
        const message = json.error ?? res.statusText;
        throw new Error(message);
      }
      const files = json.files ?? [];
      setAvailableFiles(files);
      setSelectedFilesForDownload((prev) => {
        const next = new Set<string>();
        for (const name of prev) {
          if (files.includes(name)) next.add(name);
        }
        return next;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to load files";
      setAvailableFiles([]);
      setFileListError(message);
    } finally {
      setIsFetchingFiles(false);
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      setStartForm({ ...DEFAULT_START_FORM });
      setAdSpendInput(String(DEFAULT_START_FORM.monthly_adspend_myr));
      setUseCustomLocation(!LOCATION_OPTIONS.includes(DEFAULT_START_FORM.location));
      setUseCustomLanguage(!LANGUAGE_OPTIONS.includes(DEFAULT_START_FORM.language));
      return;
    }
    let aborted = false;
    // reset fields when projectId changes before loading any cached inputs
    setStartForm({ ...DEFAULT_START_FORM });
    setAdSpendInput(String(DEFAULT_START_FORM.monthly_adspend_myr));
    setUseCustomLocation(!LOCATION_OPTIONS.includes(DEFAULT_START_FORM.location));
    setUseCustomLanguage(!LANGUAGE_OPTIONS.includes(DEFAULT_START_FORM.language));
    const loadSavedInputs = async () => {
      try {
        const res = await fetch(
          `/api/sem/project-files?projectId=${encodeURIComponent(projectId)}&file=00-user-input.json`,
          { cache: "no-store" },
        );
        if (res.status === 404) return;
        const json = (await res.json()) as {
          data?: { rawInput?: ProjectInitInput; normalizedInput?: NormalizedProjectInitInput };
          error?: string;
        };
        if (!res.ok || json.error) {
          const message = json.error ?? res.statusText;
          throw new Error(message);
        }
        const source = json.data?.rawInput ?? json.data?.normalizedInput;
        if (!source) return;
        const nextForm = buildStartFormFromInput(source);
        if (aborted) return;
        setStartForm(nextForm);
        setAdSpendInput(String(nextForm.monthly_adspend_myr));
        setUseCustomLocation(!LOCATION_OPTIONS.includes(nextForm.location));
        setUseCustomLanguage(!LANGUAGE_OPTIONS.includes(nextForm.language));
        push(`Loaded saved inputs for ${projectId}`);
      } catch (err: unknown) {
        if (aborted) return;
        const message = err instanceof Error ? err.message : "Unable to load saved inputs";
        console.warn("[sem] unable to load saved inputs", message);
      }
    };
    loadSavedInputs();
    return () => {
      aborted = true;
    };
  }, [projectId, push]);

  const handleProjectIdChange = (value: string) => {
    hasUserSetProjectIdRef.current = true;
    setProjectId(value);
    persistProjectId(value);
  };

  const openFile = async (filename: string) => {
    if (!projectId || !filename) return;
    setSelectedFile(filename);
    setSelectedFileContent("");
    setFileContentMeta(null);
    setFileViewerError(null);
    setFileViewerMessage(null);
    setIsSavingFileContent(false);
    setIsLoadingFileContent(true);
    try {
      const res = await fetch(
        `/api/sem/project-files?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(filename)}&mode=text`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as { content?: string; parsed?: unknown; isJson?: boolean; error?: string };
      if (!res.ok || json.error) {
        const message = json.error ?? res.statusText;
        throw new Error(message);
      }
      const content =
        json.isJson && json.parsed !== undefined
          ? JSON.stringify(json.parsed, null, 2)
          : json.content ?? "";
      setSelectedFileContent(content);
      setFileContentMeta({ isJson: Boolean(json.isJson) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to read file";
      setSelectedFileContent("");
      setFileViewerError(message);
    } finally {
      setIsLoadingFileContent(false);
    }
  };

  const closeFileViewer = () => {
    setSelectedFile(null);
    setSelectedFileContent("");
    setFileContentMeta(null);
    setFileViewerError(null);
    setFileViewerMessage(null);
    setIsLoadingFileContent(false);
    setIsSavingFileContent(false);
  };

  const toggleFileSelection = (filename: string) => {
    setSelectedFilesForDownload((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  const matchesFileTypeFilter = (filename: string) => {
    const lower = filename.toLowerCase();
    if (hideStepFiles && lower.startsWith("step")) return false;
    if (fileTypeFilter === "json") return lower.endsWith(".json");
    if (fileTypeFilter === "csv") return lower.endsWith(".csv");
    return true;
  };

  const getFileTypeLabel = (filename: string) => {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".json")) return "JSON";
    if (lower.endsWith(".csv")) return "CSV";
    return "File";
  };

  const downloadFile = async (filename: string) => {
    if (!projectId) return;
    setFileListError(null);
    try {
      const res = await fetch(
        `/api/sem/project-files?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(filename)}&mode=download`,
      );
      if (!res.ok) {
        const fallbackMessage = await res.text();
        const message = fallbackMessage || res.statusText;
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to download file";
      setFileListError(message);
      push(`Download failed for ${filename}: ${message}`);
    }
  };

  const downloadSelectedFiles = async () => {
    if (!projectId) return;
    const files = filteredFiles.filter((file) => selectedFilesForDownload.has(file));
    if (files.length === 0) return;
    setIsDownloadingFiles(true);
    setFileListError(null);
    try {
      for (const file of files) {
        await downloadFile(file);
      }
      push(`Downloaded ${files.length} file(s)`);
    } finally {
      setIsDownloadingFiles(false);
    }
  };

  const formatJsonContent = () => {
    if (!fileContentMeta?.isJson) return;
    try {
      const parsed = JSON.parse(selectedFileContent);
      setSelectedFileContent(JSON.stringify(parsed, null, 2));
      setFileViewerMessage("Formatted JSON");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to format JSON";
      setFileViewerError(message);
    }
  };

  const saveFileEdits = async () => {
    if (!projectId || !selectedFile) return;
    setIsSavingFileContent(true);
    setFileViewerError(null);
    setFileViewerMessage(null);
    try {
      const res = await fetch(
        `/api/sem/project-files?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(selectedFile)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: selectedFileContent }),
        },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok || json.error) {
        const message = json?.error ?? res.statusText;
        throw new Error(message);
      }
      setFileViewerMessage("Saved to output");
      refreshProjectFiles(projectId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save file";
      setFileViewerError(message);
    } finally {
      setIsSavingFileContent(false);
    }
  };

  useEffect(() => {
    if (projectId) {
      refreshProjectFiles(projectId);
    } else {
      setAvailableFiles([]);
      setSelectedFilesForDownload(new Set());
    }
  }, [projectId, refreshProjectFiles]);

  useEffect(() => {
    setStepStatuses((prev) => {
      let changed = false;
      const next: typeof prev = { ...prev };
      const markComplete = (key: keyof typeof stepCompletion, message: string) => {
        if (!stepCompletion[key]) return;
        const current = next[key];
        if (current.status === "running") return;
        if (current.status === "success" && current.message === message) return;
        next[key] = { status: "success", message };
        changed = true;
      };

      markComplete("start", "Inputs ready");
      markComplete("search", "Search volume ready");
      markComplete("serp", "SERP expansion ready");
      markComplete("site", "Site keywords ready");
      markComplete("combine", "Combined keywords ready");
      markComplete("score", "Keyword scores ready");
      markComplete("campaign", "Campaign CSV ready");
      markComplete("campaignPlan", "Plan ready for QA");

      const visualizerStatus: StepStatus = stepCompletion.campaignPlan
        ? { status: "success", message: "10/11 plan ready" }
        : { status: "idle", message: "Run Step 8 to generate plan" };
      if (
        next.visualizer.status !== visualizerStatus.status ||
        next.visualizer.message !== visualizerStatus.message
      ) {
        next.visualizer = visualizerStatus;
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [stepCompletion]);

  const runStep = async (
    endpoint: string,
    label: string,
    options?: { manageBusy?: boolean },
  ): Promise<boolean> => {
    const manageBusy = options?.manageBusy ?? true;
    if (!projectId) {
      push("Provide projectId first");
      return false;
    }
    // Step 3 pre-checks for resume / rerun
    let force = false;
    if (endpoint === "serp-expansion") {
      const decision = await evaluateStep3(projectId);
      if (!decision.allow) return false;
      force = decision.force;
    }
    if (endpoint === "site-keywords") {
      const decision = await evaluateStep4(projectId);
      if (!decision.allow) return false;
      force = decision.force;
    }
    if (manageBusy) setIsBusy(true);
    const isSerp = endpoint === "serp-expansion";
    const isStep2 = endpoint === "search-volume";
    const isStep4 = endpoint === "site-keywords";
    const isStep5 = endpoint === "combine";
    const isStep6 = endpoint === "keyword-scoring";
    if (isSerp) {
      startStep3Polling(projectId);
    } else if (isStep2) {
      startStep2Polling(projectId);
    } else if (isStep4) {
      startStep4Polling(projectId);
    } else if (isStep5) {
      startStep5Polling(projectId);
    } else if (isStep6) {
      startStep6Polling(projectId);
    } else {
      startProgress();
    }
    updateStepStatus(mapEndpointToKey(endpoint), { status: "running", message: label });
    push(`Running ${label} for ${projectId}`);
    let succeeded = false;
    try {
      let keepGoing = true;
      while (keepGoing) {
        const res = await callApi<{ incomplete?: boolean } & StepResponse>(endpoint, { projectId, force });
        if (res.incomplete) {
          push(`${label}: Time limit reached, auto-resuming...`);
          // For subsequent calls, we must NOT force restart; we want to resume.
          force = false; 
        } else {
          push(`${label} success: ${JSON.stringify(res)}`);
          updateStepStatus(mapEndpointToKey(endpoint), { status: "success", message: `${label} success` });
          succeeded = true;
          refreshProjectFiles(projectId);
          keepGoing = false;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      push(`${label} failed: ${message}`);
      updateStepStatus(mapEndpointToKey(endpoint), { status: "error", message });
    } finally {
      if (isSerp) {
        stopStep3Polling(succeeded);
      } else if (isStep2) {
        stopStep2Polling(succeeded);
      } else if (isStep4) {
        stopStep4Polling(succeeded);
      } else if (isStep5) {
        stopStep5Polling(succeeded);
      } else if (isStep6) {
        stopStep6Polling(succeeded);
      } else {
        stopProgress(succeeded);
      }
      if (manageBusy) setIsBusy(false);
    }
    return succeeded;
  };

  const openVisualizerTab = () => {
    const href = `/sem/visualizer${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`;
    const newWindow = window.open(href, "_blank", "noreferrer");
    if (!newWindow) {
      push("Unable to open visualization (popup blocked?). Please open manually.");
      updateStepStatus("visualizer", { status: "success", message: "Open visualizer manually" });
      return true;
    }
    push("Opened visualization workspace in a new tab");
    updateStepStatus("visualizer", { status: "success", message: "Visualizer opened" });
    return true;
  };

  const runAllSteps = async () => {
    if (!projectId) {
      push("Provide projectId first");
      return;
    }
    setIsBusy(true);
    const sequence: Array<{
      key: StepKey;
      label: string;
      run: (options?: { manageBusy?: boolean }) => Promise<boolean>;
      isComplete: () => boolean;
    }> = [
      {
        key: "search",
        label: "Step 2 – Search Volume",
        run: (options) => runStep("search-volume", "Step 2 – Search Volume", options),
        isComplete: () => stepCompletion.search,
      },
      {
        key: "serp",
        label: "Step 3 – SERP Expansion",
        run: (options) => runStep("serp-expansion", "Step 3 – SERP Expansion", options),
        isComplete: () => stepCompletion.serp,
      },
      {
        key: "site",
        label: "Step 4 – Keywords for Site",
        run: (options) => runStep("site-keywords", "Step 4 – Keywords for Site", options),
        isComplete: () => stepCompletion.site,
      },
      {
        key: "combine",
        label: "Step 5 – Combine & Dedupe",
        run: (options) => runStep("combine", "Step 5 – Combine & Dedupe", options),
        isComplete: () => stepCompletion.combine,
      },
      {
        key: "score",
        label: "Step 6 – Keyword Scoring",
        run: (options) => runStep("keyword-scoring", "Step 6 – Keyword Scoring", options),
        isComplete: () => stepCompletion.score,
      },
      {
        key: "campaign",
        label: "Step 7 – Campaign Structure",
        run: (options) => runCampaignStructureStep(options),
        isComplete: () => stepCompletion.campaign,
      },
      {
        key: "campaignPlan",
        label: "Step 8 – Campaign Plan",
        run: (options) => runCampaignPlanStep(options),
        isComplete: () => stepCompletion.campaignPlan,
      },
      {
        key: "visualizer",
        label: "Step 9 – Visualize & QA",
        run: async () => {
          openVisualizerTab();
          return true;
        },
        isComplete: () => false,
      },
    ];

    let completedAll = true;
    try {
      for (const step of sequence) {
        if (step.isComplete()) {
          push(`Skipping ${step.label} (already done)`);
          updateStepStatus(step.key, { status: "success", message: "Using existing output" });
          continue;
        }
        updateStepStatus(step.key, { status: "running", message: step.label });
        push(`Running ${step.label}`);
        const success = await step.run({ manageBusy: false });
        if (!success) {
          push(`Run all halted at ${step.label}`);
          completedAll = false;
          break;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      push(`Run all failed: ${message}`);
      cancelStepProgressPoll();
      stopProgress(false);
      completedAll = false;
    } finally {
      if (completedAll) {
        push("Run all steps finished");
      }
      setIsBusy(false);
    }
  };

  const mapEndpointToKey = (endpoint: string): StepKey => {
    switch (endpoint) {
      case "search-volume":
        return "search";
      case "serp-expansion":
        return "serp";
      case "site-keywords":
        return "site";
      case "combine":
        return "combine";
      case "keyword-scoring":
        return "score";
      case "campaign-structure":
        return "campaign";
      case "campaign-plan":
        return "campaignPlan";
      default:
        return "start";
    }
  };

  const updateStepStatus = (key: StepKey, status: StepStatus) => {
    setStepStatuses((prev) => ({ ...prev, [key]: status }));
  };

  const step1TimerRef = useRef<number | null>(null);
  const step8TimerRef = useRef<number | null>(null);

  const startStep1Timer = () => {
    stopStep1Timer();
    setStep1Elapsed(0);
    const startedAt = Date.now();
    step1TimerRef.current = window.setInterval(() => {
      setStep1Elapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
  };

  const stopStep1Timer = () => {
    if (step1TimerRef.current) {
      window.clearInterval(step1TimerRef.current);
      step1TimerRef.current = null;
    }
  };

  const startStep8Timer = () => {
    stopStep8Timer();
    setStep8Elapsed(0);
    const startedAt = Date.now();
    step8TimerRef.current = window.setInterval(() => {
      setStep8Elapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
  };

  const stopStep8Timer = () => {
    if (step8TimerRef.current) {
      window.clearInterval(step8TimerRef.current);
      step8TimerRef.current = null;
    }
  };

  const formatElapsed = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatProjectTimestamp = (ms: number) => {
    if (!Number.isFinite(ms) || ms <= 0) return "Unknown";
    const date = new Date(ms);
    return date.toLocaleString();
  };

  // generic progress indicator (used for steps without server polling)
  const startProgress = () => {
    setProgress(5);
    let current = 5;
    const id = window.setInterval(() => {
      current = Math.min(current + 5, 95);
      setProgress(current);
    }, 400);
    (window as unknown as { __semProgressInterval?: number }).__semProgressInterval = id;
  };

  const stopProgress = (complete: boolean) => {
    const typedWindow = window as unknown as { __semProgressInterval?: number };
    if (typedWindow.__semProgressInterval) {
      window.clearInterval(typedWindow.__semProgressInterval);
      typedWindow.__semProgressInterval = undefined;
    }
    setProgress(complete ? 100 : 0);
    if (complete) {
      setTimeout(() => setProgress(0), 800);
    }
  };

  // Step 2 polling with adaptive interval
  const MIN_PROGRESS_POLL_INTERVAL_MS = 1000;

  const startStep2Polling = (pid: string) => {
    stopProgress(false);
    cancelStepProgressPoll();
    pollStartRef.current = Date.now();
    scheduleStepProgressPoll("step2", pid, MIN_PROGRESS_POLL_INTERVAL_MS);
  };

  const stopStep2Polling = (complete: boolean) => {
    cancelStepProgressPoll();
    stopProgress(complete);
  };

  // Step 3 polling with adaptive interval
  const startStep3Polling = (pid: string) => {
    stopProgress(false);
    cancelStepProgressPoll();
    pollStartRef.current = Date.now();
    scheduleStepProgressPoll("step3", pid, 1000);
  };

  const stopStep3Polling = (complete: boolean) => {
    cancelStepProgressPoll();
    stopProgress(complete);
  };

  // Step 4 polling with adaptive interval
  const startStep4Polling = (pid: string) => {
    stopProgress(false);
    cancelStepProgressPoll();
    pollStartRef.current = Date.now();
    scheduleStepProgressPoll("step4", pid, 1000);
  };

  const stopStep4Polling = (complete: boolean) => {
    cancelStepProgressPoll();
    stopProgress(complete);
  };

  // Step 5 polling with adaptive interval
  const startStep5Polling = (pid: string) => {
    stopProgress(false);
    cancelStepProgressPoll();
    pollStartRef.current = Date.now();
    scheduleStepProgressPoll("step5", pid, 1000);
  };

  const stopStep5Polling = (complete: boolean) => {
    cancelStepProgressPoll();
    stopProgress(complete);
  };

  // Step 6 polling with adaptive interval
  const startStep6Polling = (pid: string) => {
    stopProgress(false);
    cancelStepProgressPoll();
    pollStartRef.current = Date.now();
    scheduleStepProgressPoll("step6", pid, 1000);
  };

  const stopStep6Polling = (complete: boolean) => {
    cancelStepProgressPoll();
    stopProgress(complete);
  };

  const pollTimer = useRef<number | null>(null);
  const pollStartRef = useRef<number>(0);

  const cancelStepProgressPoll = () => {
    if (pollTimer.current) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const scheduleStepProgressPoll = (
    step: "step2" | "step3" | "step4" | "step5" | "step6",
    pid: string,
    nextDelay: number,
  ) => {
    const pollFn =
      step === "step3"
        ? fetchStep3Progress
        : step === "step4"
        ? fetchStep4Progress
        : step === "step5"
        ? fetchStep5Progress
        : step === "step6"
        ? fetchStep6Progress
        : fetchStep2Progress;
    const delay = Math.max(nextDelay, MIN_PROGRESS_POLL_INTERVAL_MS);
    pollTimer.current = window.setTimeout(async () => {
      const elapsed = Date.now() - pollStartRef.current;
      const isEarly = elapsed < 10000;
      const fallback = Math.max(isEarly ? 1000 : 4000, MIN_PROGRESS_POLL_INTERVAL_MS);
      const nextMs = await pollFn(pid, nextDelay || fallback);
      if (nextMs === null) {
        cancelStepProgressPoll();
        return;
      }
      scheduleStepProgressPoll(step, pid, Math.max(nextMs ?? fallback, MIN_PROGRESS_POLL_INTERVAL_MS));
    }, delay);
  };

  const fetchStep2Progress = async (pid: string, fallback: number): Promise<number> => {
    try {
      const res = await fetch(`/api/sem/step2-progress?projectId=${encodeURIComponent(pid)}`);
      if (!res.ok) return fallback;
      const json = (await res.json()) as {
        percent?: number;
        nextPollMs?: number;
        status?: "pending" | "running" | "done" | "error";
        completedBatches?: number | null;
        totalBatches?: number | null;
        processedKeywords?: number | null;
        totalKeywords?: number | null;
      };
      if (typeof json.percent === "number") {
        setProgress(Math.min(Math.max(json.percent, 0), 100));
      }
      const status: StepStatus["status"] =
        json.status === "done" ? "success" : json.status === "error" ? "error" : "running";
      const batchLabel =
        typeof json.completedBatches === "number" && typeof json.totalBatches === "number"
          ? `Batch ${json.completedBatches}/${json.totalBatches}`
          : null;
      const keywordLabel =
        typeof json.processedKeywords === "number" && typeof json.totalKeywords === "number"
          ? `${json.processedKeywords}/${json.totalKeywords} keywords`
          : null;
      const message =
        batchLabel || keywordLabel ? [batchLabel, keywordLabel].filter(Boolean).join(" • ") : undefined;
      updateStepStatus("search", { status, message });
      return typeof json.nextPollMs === "number" ? json.nextPollMs : fallback;
    } catch {
      return fallback;
    }
  };

  const fetchStep3Progress = async (pid: string, fallback: number): Promise<number | null> => {
    try {
      const res = await fetch(`/api/sem/step3-progress?projectId=${encodeURIComponent(pid)}`);
      if (!res.ok) return fallback;
      const json = (await res.json()) as { percent?: number; nextPollMs?: number; hasResultFile?: boolean };
      if (typeof json.percent === "number") {
        setProgress(Math.min(Math.max(json.percent, 0), 100));
      }
      const isComplete = (json.percent ?? 0) >= 100 || json.hasResultFile;
      if (isComplete) {
        updateStepStatus("serp", { status: "success", message: "Step 3 complete" });
        return null;
      }
      return typeof json.nextPollMs === "number" ? json.nextPollMs : fallback;
    } catch {
      return fallback;
    }
  };

  const fetchStep4Progress = async (pid: string, fallback: number): Promise<number | null> => {
    try {
      const res = await fetch(`/api/sem/step4-progress?projectId=${encodeURIComponent(pid)}`);
      if (!res.ok) return fallback;
      const json = (await res.json()) as {
        percent?: number;
        nextPollMs?: number;
        status?: "pending" | "running" | "done" | "error";
        errorMessage?: string;
        hasResultFile?: boolean;
      };
      if (typeof json.percent === "number") {
        setProgress(Math.min(Math.max(json.percent, 0), 100));
      }
      const status: StepStatus["status"] =
        json.status === "done" ? "success" : json.status === "error" ? "error" : "running";
      const isComplete = status === "success" || (json.percent ?? 0) >= 100 || json.hasResultFile;
      updateStepStatus("site", { status, message: json.errorMessage });
      if (isComplete || status === "error") {
        return null;
      }
      return typeof json.nextPollMs === "number" ? json.nextPollMs : fallback;
    } catch {
      return fallback;
    }
  };

  const fetchStep5Progress = async (pid: string, fallback: number): Promise<number | null> => {
    try {
      const res = await fetch(`/api/sem/step5-progress?projectId=${encodeURIComponent(pid)}`);
      if (!res.ok) return fallback;
      const json = (await res.json()) as {
        percent?: number;
        nextPollMs?: number;
        status?: "pending" | "running" | "done" | "error";
        target?: string | null;
        hasResultFile?: boolean;
        processedKeywords?: number | null;
        totalKeywords?: number | null;
      };
      if (typeof json.percent === "number") {
        setProgress(Math.min(Math.max(json.percent, 0), 100));
      }
      const isComplete = (json.percent ?? 0) >= 100 || json.hasResultFile;
      const status: StepStatus["status"] = isComplete
        ? "success"
        : json.status === "error"
        ? "error"
        : "running";
      const processed = typeof json.processedKeywords === "number" ? json.processedKeywords : null;
      const total = typeof json.totalKeywords === "number" ? json.totalKeywords : null;
      const countLabel =
        processed !== null && total !== null ? ` (${processed}/${total} keywords)` : processed !== null ? ` (${processed})` : "";
      const phaseLabel = json.target ? `Phase: ${json.target}` : undefined;
      updateStepStatus("combine", {
        status,
        message: phaseLabel ? `${phaseLabel}${countLabel}` : countLabel || undefined,
      });
      if (isComplete || status === "error") {
        return null;
      }
      return typeof json.nextPollMs === "number" ? json.nextPollMs : fallback;
    } catch {
      return fallback;
    }
  };

  const fetchStep6Progress = async (pid: string, fallback: number): Promise<number> => {
    try {
      const res = await fetch(`/api/sem/step6-progress?projectId=${encodeURIComponent(pid)}`);
      if (!res.ok) return fallback;
      const json = (await res.json()) as {
        percent?: number;
        nextPollMs?: number;
        status?: "pending" | "running" | "done" | "error";
        phase?: string;
        message?: string;
        processedKeywords?: number | null;
        totalKeywords?: number | null;
      };
      if (typeof json.percent === "number") {
        setProgress(Math.min(Math.max(json.percent, 0), 100));
      }
      const status: StepStatus["status"] =
        json.status === "done" ? "success" : json.status === "error" ? "error" : "running";
      const processed = typeof json.processedKeywords === "number" ? json.processedKeywords : null;
      const total = typeof json.totalKeywords === "number" ? json.totalKeywords : null;
      const countLabel =
        processed !== null && total !== null ? ` (${processed}/${total})` : processed !== null ? ` (${processed})` : "";
      const phaseLabel = json.message ?? (json.phase ? `Phase: ${json.phase}` : undefined);
      updateStepStatus("score", { status, message: phaseLabel ? `${phaseLabel}${countLabel}` : undefined });
      return typeof json.nextPollMs === "number" ? json.nextPollMs : fallback;
    } catch {
      return fallback;
    }
  };

  const evaluateStep4 = async (pid: string): Promise<{ allow: boolean; force: boolean }> => {
    try {
      const res = await fetch(`/api/sem/step4-progress?projectId=${encodeURIComponent(pid)}`);
      if (!res.ok) return { allow: true, force: false };
      const json = (await res.json()) as { percent?: number; hasResultFile?: boolean };
      const percent = json.percent ?? 0;
      const hasResult = json.hasResultFile ?? false;

      if (percent >= 100 && hasResult) {
        const confirmRun = await askConfirm(
          "Step 4 already completed",
          "We found an existing Step 4 result. Rerun to refresh or keep existing?",
        );
        return { allow: confirmRun, force: confirmRun };
      }
      if (percent > 0 && percent < 100) {
        push("Resuming Step 4 from previous progress...");
        return { allow: true, force: false };
      }
      return { allow: true, force: false };
    } catch {
      return { allow: true, force: false };
    }
  };

  const evaluateStep3 = async (pid: string): Promise<{ allow: boolean; force: boolean }> => {
    try {
      const res = await fetch(`/api/sem/step3-progress?projectId=${encodeURIComponent(pid)}`);
      if (!res.ok) return { allow: true, force: false };
      const json = (await res.json()) as { percent?: number; hasResultFile?: boolean };
      const percent = json.percent ?? 0;
      const hasResult = json.hasResultFile ?? false;

      if (percent >= 100 && hasResult) {
        const confirmRun = await askConfirm(
          "Step 3 already completed",
          "We found an existing Step 3 result. Rerun to refresh or keep existing?",
        );
        return { allow: confirmRun, force: confirmRun };
      }
      if (percent > 0 && percent < 100) {
        push("Resuming Step 3 from previous progress...");
        return { allow: true, force: false };
      }
      return { allow: true, force: false };
    } catch {
      return { allow: true, force: false };
    }
  };

  const isStep1Running = stepStatuses.start.status === "running";
  const isStep8Running = stepStatuses.campaignPlan.status === "running";

  const sanitizeAdSpend = (value: number): number => {
    if (!Number.isFinite(value)) return MIN_AD_SPEND_MYR;
    return Math.max(MIN_AD_SPEND_MYR, Math.round(value));
  };

  const handleAdSpendSliderChange = (value: number) => {
    const sanitized = sanitizeAdSpend(value);
    setAdSpendInput(String(sanitized));
    setStartForm((prev) => ({ ...prev, monthly_adspend_myr: sanitized }));
  };

  const handleAdSpendInputChange = (raw: string) => {
    setAdSpendInput(raw);
    const numeric = Number(raw);
    if (!Number.isNaN(numeric)) {
      const sanitized = sanitizeAdSpend(numeric);
      setStartForm((prev) => ({ ...prev, monthly_adspend_myr: sanitized }));
    }
  };

  const handleAdSpendBlur = () => {
    const numeric = Number(adSpendInput);
    const sanitized = sanitizeAdSpend(Number.isFinite(numeric) ? numeric : MIN_AD_SPEND_MYR);
    setAdSpendInput(String(sanitized));
    setStartForm((prev) => ({ ...prev, monthly_adspend_myr: sanitized }));
  };

  const getSelectedCampaignFilters = (): AppliedCampaignFilters => {
    const tiers = (Object.entries(campaignFilters.tiers) as Array<[Tier, boolean]>)
      .filter(([, isOn]) => isOn)
      .map(([tier]) => tier);

    return {
      tiers: tiers.length ? tiers : ["A"],
      paidFlag: campaignFilters.paidFlag,
      seoFlag: campaignFilters.seoFlag,
    };
  };

  const handleTierToggle = (tier: Tier) => {
    setCampaignFilters((prev) => ({
      ...prev,
      tiers: { ...prev.tiers, [tier]: !prev.tiers[tier] },
    }));
  };

  const handleFlagToggle = (key: "paidFlags" | "seoFlags", value: "true" | "false") => {
    setCampaignFilters((prev) => {
      if (key === "paidFlags") {
        return { ...prev, paidFlag: value === "true" };
      }
      return { ...prev, seoFlag: value === "true" };
    });
  };

  const runCampaignStructureStep = async (options?: { manageBusy?: boolean }) => {
    const manageBusy = options?.manageBusy ?? true;
    if (!projectId) {
      push("Provide projectId first");
      return false;
    }
    const filters = getSelectedCampaignFilters();
    if (manageBusy) setIsBusy(true);
    startProgress();
    updateStepStatus("campaign", { status: "running", message: "Building campaign CSV" });
    push(
      `Step 7 – Generating campaign structure with tiers=${filters.tiers.join(", ")} paid=${filters.paidFlag} seo=${
        filters.seoFlag
      }`,
    );
    let completed = false;
    try {
      const res = await fetch("/api/sem/campaign-structure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          tiers: filters.tiers,
          paidFlags: [filters.paidFlag],
          seoFlags: [filters.seoFlag],
        }),
      });
      const json = (await res.json()) as {
        totalRows?: number;
        previewRows?: CampaignStructureRow[];
        fileName?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json?.error || res.statusText);
      }
      const previewRows = Array.isArray(json.previewRows) ? json.previewRows : [];
      setCampaignPreview(previewRows);
      setCampaignCsvName(typeof json.fileName === "string" ? json.fileName : "09-google-ads-campaign-structure.csv");
      setCampaignFiltersApplied(filters);
      const totalRows = typeof json.totalRows === "number" ? json.totalRows : previewRows.length;
      push(
        `Step 7 success: wrote ${totalRows} ${
          totalRows === 1 ? "row" : "rows"
        } to ${json.fileName ?? "campaign CSV"}`,
      );
      updateStepStatus("campaign", { status: "success", message: `${totalRows} rows` });
      refreshProjectFiles(projectId);
      completed = true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      push(`Step 7 failed: ${message}`);
      updateStepStatus("campaign", { status: "error", message });
    } finally {
      stopProgress(completed);
      if (manageBusy) setIsBusy(false);
    }
    return completed;
  };

  const handleCampaignStructure = async () => {
    await runCampaignStructureStep();
  };

  const handleDownloadCampaignCsv = async () => {
    if (!projectId) {
      push("Provide projectId first");
      return;
    }
    const filters = campaignFiltersApplied ?? getSelectedCampaignFilters();
    const params = new URLSearchParams({ projectId });
    if (filters.tiers.length) params.set("tiers", filters.tiers.join(","));
    params.set("paidFlags", String(filters.paidFlag));
    params.set("seoFlags", String(filters.seoFlag));
    try {
      const res = await fetch(`/api/sem/campaign-structure?${params.toString()}`);
      let errorJson: { error?: string } | null = null;
      if (!res.ok) {
        try {
          errorJson = (await res.json()) as { error?: string };
        } catch {
          // ignore JSON parse errors
        }
      }
      if (!res.ok) {
        throw new Error(errorJson?.error || res.statusText);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition");
      let filename = campaignCsvName ?? "09-google-ads-campaign-structure.csv";
      if (disposition) {
        const match = disposition.match(/filename=\"?([^\";]+)\"?/);
        if (match?.[1]) filename = match[1];
      }
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      push(`Downloaded ${filename} (${blob.size} bytes)`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      push(`Download failed: ${message}`);
    }
  };

  const formatDailyBudget = (value: number | string | null | undefined): string => {
    if (typeof value === "string") {
      const numeric = Number(value.replace(/,/g, ""));
      if (Number.isFinite(numeric)) {
        return formatDailyBudget(numeric);
      }
      return value ? ` (${value}/day)` : "";
    }
    if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) return "";
    return ` (RM ${value.toLocaleString("en-MY", { maximumFractionDigits: 2 })}/day)`;
  };

  const buildCampaignTreeLog = (campaigns: CampaignPlan[]): string => {
    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      return "No campaigns returned.";
    }
    const lines: string[] = [];
    campaigns.forEach((campaign, idx) => {
      const name = campaign?.CampaignName || `Campaign ${idx + 1}`;
      lines.push(`- ${name}${formatDailyBudget(campaign?.BudgetDailyMYR)}`);
      const adGroups = Array.isArray(campaign?.AdGroups) ? campaign.AdGroups : [];
      adGroups.forEach((group, gIdx) => {
        const adGroupName = group?.AdGroupName || `Ad Group ${gIdx + 1}`;
        const targeting = group?.Targeting;
        const keywordCount = Array.isArray(targeting?.Keywords) ? targeting.Keywords.length : 0;
        const negativeCount = Array.isArray(targeting?.NegativeKeywords) ? targeting.NegativeKeywords.length : 0;
        lines.push(`  - ${adGroupName} (keywords: ${keywordCount}, negatives: ${negativeCount})`);
      });
    });
    return lines.join("\n");
  };

  const runCampaignPlanStep = async (options?: { manageBusy?: boolean }) => {
    const manageBusy = options?.manageBusy ?? true;
    if (!projectId) {
      push("Provide projectId first");
      return false;
    }
    if (manageBusy) setIsBusy(true);
    setProgress(0);
    setCampaignPlanResult(null);
    startStep8Timer();
    updateStepStatus("campaignPlan", { status: "running", message: "Waiting for OpenAI" });
    push("Step 8 – Generating campaign plan from 09-google-ads-campaign-structure.csv");
    let completed = false;
    try {
      const res = await fetch("/api/sem/campaign-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const json = (await res.json()) as { campaigns?: CampaignPlan[]; fileName?: string; error?: string };
      if (!res.ok) {
        throw new Error(json?.error || res.statusText);
      }
      const campaigns = Array.isArray(json.campaigns) ? json.campaigns : [];
      const fileName = typeof json.fileName === "string" ? json.fileName : "10-campaign-plan.json";
      setCampaignPlanResult({ campaigns, fileName });
      const tree = buildCampaignTreeLog(campaigns);
      push(`Step 8 completed. Saved to ${fileName}.\n${tree}`);
      updateStepStatus("campaignPlan", { status: "success", message: `${campaigns.length} campaigns` });
      refreshProjectFiles(projectId);
      completed = true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      push(`Step 8 failed: ${message}`);
      updateStepStatus("campaignPlan", { status: "error", message });
    } finally {
      stopStep8Timer();
      if (manageBusy) setIsBusy(false);
    }
    return completed;
  };

  const handleGenerateCampaignPlan = async () => {
    await runCampaignPlanStep();
  };

  const filteredFiles = availableFiles
    .filter((file) => matchesFileTypeFilter(file))
    .filter((file) => file.toLowerCase().includes(fileFilter.toLowerCase()));
  const selectedDownloadCount = filteredFiles.filter((file) => selectedFilesForDownload.has(file)).length;

  return (
    <main className="min-h-screen p-6 flex justify-center bg-gray-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-6xl space-y-6">
        <header className="space-y-3">
          <h1 className="text-2xl font-semibold text-center text-slate-900 dark:text-white">SEM Keyword Pipeline</h1>
          <div className="border rounded-lg p-3 bg-gray-50 flex flex-wrap items-center gap-3 text-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700 dark:text-slate-200">Project</span>
              <span
                className={`px-2 py-1 rounded ${projectId ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200" : "bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-200"}`}
              >
                {projectId || "Not set"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700 dark:text-slate-200">Filters</span>
              <span className="px-2 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100">
                Tiers: {getSelectedCampaignFilters().tiers.join(", ")}
              </span>
              <span className="px-2 py-1 rounded bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-100">
                Paid: {getSelectedCampaignFilters().paidFlag ? "true" : "false"}
              </span>
              <span className="px-2 py-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                SEO: {getSelectedCampaignFilters().seoFlag ? "true" : "false"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700 dark:text-slate-200">Status</span>
              <span className="px-2 py-1 rounded bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-200">
                Last: {Object.values(stepStatuses).some((s) => s.status === "running") ? "Running" : "Idle"}
              </span>
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
          <div className="flex-1 min-w-0 space-y-6 md:basis-1/2">
            <CollapsibleSection
              title="Project ID & Files"
              isOpen={openSections.project}
              onToggle={() => toggleSection("project")}
            >
              <label className="grid gap-1">
                <span>projectId</span>
                <input
                  className="border rounded px-3 py-2 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  value={projectId}
                  onChange={(e) => handleProjectIdChange(e.target.value)}
                  placeholder="YYYYMMDD-HH-001"
                  autoComplete="off"
                />
              </label>
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-sm text-gray-700 dark:text-slate-200">
                  <span>Or select an existing project</span>
                  <button
                    type="button"
                    className="border rounded px-2 py-1 bg-white hover:bg-blue-50 text-xs disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    onClick={() => void refreshExistingProjects()}
                    disabled={isFetchingProjects}
                  >
                    {isFetchingProjects ? "Loading..." : "Refresh list"}
                  </button>
                </div>
                <select
                  className="border rounded px-3 py-2 text-sm w-full max-w-full truncate bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  value={existingProjects.find((p) => p.id === projectId) ? projectId : ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value) handleProjectIdChange(value);
                  }}
                >
                  <option value="">Choose existing project</option>
                  {existingProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.id} — {project.fileCount} {project.fileCount === 1 ? "file" : "files"} •{" "}
                      {formatProjectTimestamp(project.createdMs)}
                      {project.websiteDomain ? ` • ${project.websiteDomain}` : ""}
                    </option>
                  ))}
                </select>
                {projectListError && <div className="text-xs text-red-700">{projectListError}</div>}
                {!projectListError && !isFetchingProjects && existingProjects.length === 0 && (
                  <div className="text-xs text-gray-600">No existing projects found in output/ yet.</div>
                )}
                {!projectListError && existingProjects.length > 0 && (
                  <div className="text-xs text-gray-600">Sorted by latest created time first.</div>
                )}
              </div>
              <div className="text-sm text-gray-600">
                Used for starting/running steps and browsing generated files for this project.
              </div>
              {!projectId && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                  Set a projectId to run steps and fetch files.
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="Step 1 – Start Project"
              isOpen={openSections.step1}
              onToggle={() => toggleSection("step1")}
            >
              <p className="text-sm text-gray-700 leading-relaxed dark:text-slate-200">
                We scrape your website&apos;s public content here to understand your business and brainstorm ad-ready
                keyword ideas you can run campaigns with.
              </p>
              <form className="grid gap-3" onSubmit={handleStart}>
                <label className="grid gap-1">
                  <span>Website (required)</span>
                  <input
                    required
                    className="border rounded px-3 py-2 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    value={startForm.website}
                    onChange={(e) => setStartForm((prev) => ({ ...prev, website: e.target.value }))}
                    placeholder="https://www.example.com"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1">
                    <span>Goal</span>
                    <select
                      className="border rounded px-3 py-2 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      value={startForm.goal}
                      onChange={(e) => setStartForm((prev) => ({ ...prev, goal: e.target.value }))}
                    >
                      {GOAL_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span>Location</span>
                    <select
                      className="border rounded px-3 py-2 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      value={useCustomLocation ? OTHER_VALUE : startForm.location}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === OTHER_VALUE) {
                          setUseCustomLocation(true);
                        } else {
                          setUseCustomLocation(false);
                          setStartForm((prev) => ({ ...prev, location: value }));
                        }
                      }}
                    >
                      {LOCATION_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      <option value={OTHER_VALUE}>Other</option>
                    </select>
                    {useCustomLocation && (
                      <input
                        className="border rounded px-3 py-2 mt-2 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        value={startForm.location}
                        onChange={(e) => setStartForm((prev) => ({ ...prev, location: e.target.value }))}
                        placeholder="Enter a location"
                      />
                    )}
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1">
                    <span>State list (comma separated)</span>
                    <input
                      className="border rounded px-3 py-2 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      value={startForm.state_list}
                      onChange={(e) => setStartForm((prev) => ({ ...prev, state_list: e.target.value }))}
                      placeholder="Selangor, Kuala Lumpur"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span>Language</span>
                    <select
                      className="border rounded px-3 py-2 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      value={useCustomLanguage ? OTHER_VALUE : startForm.language}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === OTHER_VALUE) {
                          setUseCustomLanguage(true);
                        } else {
                          setUseCustomLanguage(false);
                          setStartForm((prev) => ({ ...prev, language: value }));
                        }
                      }}
                    >
                      {LANGUAGE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      <option value={OTHER_VALUE}>Other</option>
                    </select>
                    {useCustomLanguage && (
                      <input
                        className="border rounded px-3 py-2 mt-2 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        value={startForm.language}
                        onChange={(e) => setStartForm((prev) => ({ ...prev, language: e.target.value }))}
                        placeholder="Enter a language"
                      />
                    )}
                  </label>
                </div>
                <label className="grid gap-1">
                  <span>Context (optional extra info for business)</span>
                  <textarea
                    className="border rounded px-3 py-2 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 min-h-[100px]"
                    value={startForm.context}
                    onChange={(e) => setStartForm((prev) => ({ ...prev, context: e.target.value }))}
                    placeholder="Enter more context about the business, target audience, specific products to focus on, etc."
                  />
                </label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span>Monthly ad spend (MYR)</span>
                    <span className="text-xs text-gray-600">Slide RM1k–50k or type to go above</span>
                  </div>
                  <input
                    type="range"
                    min={MIN_AD_SPEND_MYR}
                    max={MAX_SLIDER_AD_SPEND_MYR}
                    step={100}
                    value={Math.min(startForm.monthly_adspend_myr, MAX_SLIDER_AD_SPEND_MYR)}
                    onChange={(e) => handleAdSpendSliderChange(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">RM</span>
                    <input
                      type="number"
                      min={MIN_AD_SPEND_MYR}
                      step={500}
                      className="border rounded px-3 py-2 w-40 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      value={adSpendInput}
                      onChange={(e) => handleAdSpendInputChange(e.target.value)}
                      onBlur={handleAdSpendBlur}
                      inputMode="numeric"
                    />
                    <span className="text-sm text-gray-600">
                      Selected: RM{startForm.monthly_adspend_myr.toLocaleString("en-MY")}
                    </span>
                  </div>
                  {startForm.monthly_adspend_myr < MIN_AD_SPEND_MYR && (
                    <div className="text-sm text-red-600">Min RM{MIN_AD_SPEND_MYR.toLocaleString("en-MY")}.</div>
                  )}
                </div>
                <button
                  type="submit"
                  className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
                  disabled={isBusy}
                >
                  {isBusy ? "Working..." : "Start Project"}
                </button>
              </form>
            </CollapsibleSection>

            <CollapsibleSection
              title="Run Steps (uses current projectId)"
              isOpen={openSections.runSteps}
              onToggle={() => toggleSection("runSteps")}
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-gray-700 dark:text-slate-200">
                    Runs steps 2-9 sequentially, skipping completed steps and resuming if interrupted. Finishes by
                    opening the visualizer.
                  </div>
                  <button
                    className="rounded px-4 py-2 bg-blue-600 text-white disabled:opacity-50"
                    disabled={isBusy || !projectId}
                    onClick={runAllSteps}
                  >
                    {isBusy ? "Working..." : "Run All Steps (2-9)"}
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { endpoint: "search-volume", label: "Step 2 – Search Volume", key: "search" as StepKey },
                    { endpoint: "serp-expansion", label: "Step 3 – SERP Expansion", key: "serp" as StepKey },
                    { endpoint: "site-keywords", label: "Step 4 – Keywords for Site", key: "site" as StepKey },
                    { endpoint: "combine", label: "Step 5 – Combine & Dedupe", key: "combine" as StepKey },
                    { endpoint: "keyword-scoring", label: "Step 6 – Keyword Scoring", key: "score" as StepKey },
                  ].map((step) => {
                    const state = stepStatuses[step.key];
                    const statusLabel =
                      state.status === "running"
                        ? "Running"
                        : state.status === "success"
                        ? "Done"
                        : state.status === "error"
                        ? "Error"
                        : "Idle";
                    return (
                      <button
                        key={step.endpoint}
                        className={`border rounded px-3 py-2 text-left disabled:opacity-50 ${
                          state.status === "running"
                            ? "border-blue-300 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/30"
                            : state.status === "error"
                            ? "border-red-300 bg-red-50 dark:border-red-500 dark:bg-red-900/30"
                            : "bg-white dark:border-slate-600 dark:bg-slate-800"
                        }`}
                        disabled={isBusy || !projectId}
                        onClick={() => runStep(step.endpoint, step.label)}
                      >
                        <div className="font-medium">{step.label}</div>
                        <div className="text-xs text-gray-600 flex items-center gap-2">
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${
                              state.status === "running"
                                ? "bg-blue-500 animate-pulse"
                                : state.status === "success"
                                ? "bg-green-500"
                                : state.status === "error"
                                ? "bg-red-500"
                                : "bg-gray-400"
                            }`}
                          />
                          <span>{statusLabel}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {!projectId && (
                  <div className="text-xs text-gray-600 mt-2">Enter a projectId above to enable these actions.</div>
                )}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Step 7 – Campaign Structure"
              isOpen={openSections.step7}
              onToggle={() => toggleSection("step7")}
            >
              <p className="text-sm text-gray-600">
                Filter 08-keywords-with-scores by tier/flags to build a CSV with columns: keyword, avg_monthly_searches,
                cpc (defaults: Tier A + paid_flag).
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <div className="font-medium text-sm">Tiers</div>
                  {(["A", "B", "C"] as Tier[]).map((tier) => (
                    <label key={tier} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={campaignFilters.tiers[tier]}
                        onChange={() => handleTierToggle(tier)}
                        className="h-4 w-4"
                      />
                      <span>Tier {tier} ({tierDetails[tier].label})</span>
                    </label>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="font-medium text-sm">Paid Flag</div>
                  <div className="flex items-center gap-3 text-sm">
                    {(["true", "false"] as const).map((flag) => (
                      <label key={flag} className="flex items-center gap-1">
                        <input
                          type="radio"
                          name="paid-flag"
                          checked={campaignFilters.paidFlag === (flag === "true")}
                          onChange={() => handleFlagToggle("paidFlags", flag)}
                          className="h-4 w-4"
                        />
                        <span>{flag}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="font-medium text-sm">SEO Flag</div>
                  <div className="flex items-center gap-3 text-sm">
                    {(["true", "false"] as const).map((flag) => (
                      <label key={flag} className="flex items-center gap-1">
                        <input
                          type="radio"
                          name="seo-flag"
                          checked={campaignFilters.seoFlag === (flag === "true")}
                          onChange={() => handleFlagToggle("seoFlags", flag)}
                          className="h-4 w-4"
                        />
                        <span>{flag}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
                  disabled={isBusy || !projectId}
                  onClick={handleCampaignStructure}
                >
                  {isBusy ? "Working..." : "Generate campaign CSV"}
                </button>
                <button
                  className="border rounded px-4 py-2 disabled:opacity-50"
                  disabled={!projectId}
                  onClick={handleDownloadCampaignCsv}
                >
                  Download CSV
                </button>
              </div>
              {campaignPreview.length > 0 && (
                <div className="bg-gray-50 border rounded p-3 text-xs space-y-1 dark:border-slate-700 dark:bg-slate-800">
                  <div className="font-medium text-sm">Preview (first 5 rows)</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr>
                          <th className="border-b px-2 py-1">keyword</th>
                          <th className="border-b px-2 py-1">avg_monthly_searches</th>
                          <th className="border-b px-2 py-1">cpc</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaignPreview.map((row, idx) => (
                          <tr key={`${row.keyword}-${idx}`}>
                            <td className="px-2 py-1 whitespace-pre-wrap">{row.keyword}</td>
                            <td className="px-2 py-1">
                              {row.avg_monthly_searches !== null && typeof row.avg_monthly_searches !== "undefined"
                                ? Math.round(row.avg_monthly_searches)
                                : ""}
                            </td>
                            <td className="px-2 py-1">{row.cpc ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="Step 8 – Campaign Plan"
              isOpen={openSections.step8}
              onToggle={() => toggleSection("step8")}
            >
              <p className="text-sm text-gray-600">
                Use the 09 Google Ads campaign CSV and initial user inputs (00) to ask OpenAI for a full campaign plan.
                This call can take up to 3 minutes; a timer will run while waiting.
              </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
                disabled={isBusy || !projectId}
                onClick={handleGenerateCampaignPlan}
                >
                  {isStep8Running ? "Working..." : "Generate campaign plan"}
                </button>
                {campaignPlanResult && (
                  <span className="text-sm text-gray-600">
                    Last saved: {campaignPlanResult.fileName} ({campaignPlanResult.campaigns.length} campaigns)
                  </span>
                )}
              </div>
              {isStep8Running && (
                <div className="inline-flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded px-3 py-2 dark:border-blue-900/60 dark:bg-blue-900/30">
                  <span>Waiting for OpenAI</span>
                  <span className="font-mono">{formatElapsed(step8Elapsed)}</span>
                </div>
              )}
              {campaignPlanResult && !isStep8Running && (
                <div className="bg-gray-50 border rounded p-3 text-xs whitespace-pre-wrap dark:border-slate-700 dark:bg-slate-800">
                  <div className="font-medium text-sm mb-1">Latest plan tree</div>
                  {buildCampaignTreeLog(campaignPlanResult.campaigns)}
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="Step 9 – Visualize & QA"
              isOpen={openSections.step9}
              onToggle={() => toggleSection("step9")}
            >
              <p className="text-sm text-gray-600">
                Launch the new visualization workspace to explore Campaign → Ad Group → Ads/Keywords/Negatives or switch
                to QA tables. On first load, we copy your 10-*.json to 10-campaign-plan.backup.json before edits.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <a
                  className="bg-blue-600 text-white px-4 py-2 rounded inline-flex items-center gap-2"
                  href={`/sem/visualizer${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open visualization
                  <span aria-hidden>↗</span>
                </a>
                <span className="text-sm text-gray-700 dark:text-slate-200">
                  Current project: {projectId || "Set a projectId above"} (uses files starting with 10-)
                </span>
              </div>
              <div className="text-xs text-gray-600">
                Exports CSVs, inline edits (double click cells), and lets you toggle negatives per keyword before sending to
                Google Ads/Editor.
              </div>
              {availableFiles.some((file) => file.startsWith("10-") || file.startsWith("11-")) && (
                <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200">
                  Found{" "}
                  {availableFiles.filter((file) => file.startsWith("10-") || file.startsWith("11-")).length} file(s)
                  starting with 10-/11- for this project.
                </div>
              )}
            </CollapsibleSection>
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-4 md:h-[80vh] md:basis-1/2">
            <section className="space-y-3 border rounded-lg p-4 flex-1 md:flex-[2] bg-white dark:border-slate-700 dark:bg-slate-900">
              <h2 className="text-xl font-medium">Logs</h2>
              {isStep1Running && (
                <div className="space-y-1 bg-blue-50 border border-blue-200 rounded p-2 text-sm dark:border-blue-900/60 dark:bg-blue-900/30">
                  <div className="flex items-center justify-between">
                    <span>Step 1 is running (usually takes up to 3 mins)</span>
                    <span className="font-mono">{formatElapsed(step1Elapsed)}</span>
                  </div>
                </div>
              )}
              {isStep8Running && (
                <div className="space-y-1 bg-blue-50 border border-blue-200 rounded p-2 text-sm dark:border-blue-900/60 dark:bg-blue-900/30">
                  <div className="flex items-center justify-between">
                    <span>Step 8 is running (OpenAI campaign plan)</span>
                    <span className="font-mono">{formatElapsed(step8Elapsed)}</span>
                  </div>
                </div>
              )}
              {progress > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>Progress</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 rounded bg-gray-200 overflow-hidden">
                    <div
                      className="h-2 bg-blue-600 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-64 md:max-h-[60vh] overflow-y-auto text-sm space-y-1 dark:border-slate-700 dark:bg-slate-800">
                {logs.length === 0 && <div>No logs yet.</div>}
                {logs.map((log, idx) => (
                  <div key={idx} className="whitespace-pre-wrap break-words">
                    {log}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3 border rounded-lg p-4 md:flex-1 dark:border-slate-700 dark:bg-slate-900 bg-white">
              <h2 className="text-xl font-medium">Step Status</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                {([
                  { key: "start", label: "Step 1 – Start" },
                  { key: "search", label: "Step 2 – Search Volume" },
                  { key: "serp", label: "Step 3 – SERP Expansion" },
                  { key: "site", label: "Step 4 – Keywords for Site" },
                  { key: "combine", label: "Step 5 – Combine & Dedupe" },
                  { key: "score", label: "Step 6 – Keyword Scoring" },
                  { key: "campaign", label: "Step 7 – Campaign Structure" },
                  { key: "campaignPlan", label: "Step 8 – Campaign Plan" },
                  { key: "visualizer", label: "Step 9 – Visualize & QA" },
                ] as Array<{ key: StepKey; label: string }>).map((item) => {
                  const state = stepStatuses[item.key];
                  const color =
                    state.status === "running"
                      ? "text-blue-600"
                      : state.status === "success"
                      ? "text-green-600"
                      : state.status === "error"
                      ? "text-red-600"
                      : "text-gray-600";
                  return (
                    <div key={item.key} className="flex items-center gap-2 border rounded px-3 py-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          state.status === "running"
                            ? "bg-blue-500 animate-pulse"
                            : state.status === "success"
                            ? "bg-green-500"
                            : state.status === "error"
                            ? "bg-red-500"
                            : "bg-gray-400"
                        }`}
                      />
                      <div className="flex flex-col">
                        <span className={color}>{item.label}</span>
                        {state.message && <span className="text-xs text-gray-600">{state.message}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3 border rounded-lg p-4 md:flex-1 bg-white dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-medium">Output Files</h2>
                  <div className="text-sm text-gray-600 dark:text-slate-300">
                    View, download, or edit files saved in <code className="font-mono">output/{projectId || "projectId"}</code>.
                  </div>
                </div>
                <button
                  className="border rounded px-3 py-2 bg-white hover:bg-blue-50 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  onClick={() => projectId && refreshProjectFiles(projectId)}
                  disabled={!projectId || isFetchingFiles}
                >
                  {isFetchingFiles ? "Loading..." : "Refresh"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-gray-700 dark:text-slate-200">
                  {projectId ? `Project ${projectId}` : "Set a projectId above to load files."}
                </span>
                {!fileListError && availableFiles.length > 0 && (
                  <span className="text-gray-600 dark:text-slate-300">
                    Showing {filteredFiles.length} of {availableFiles.length} file(s)
                  </span>
                )}
                {fileListError && <span className="text-red-600">{fileListError}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <span>Search</span>
                  <input
                    className="border rounded px-2 py-1 w-48 dark:border-slate-600 dark:bg-slate-800"
                    placeholder="Filter files"
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    disabled={!projectId}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span>Type</span>
                  <select
                    className="border rounded px-2 py-1 dark:border-slate-600 dark:bg-slate-800"
                    value={fileTypeFilter}
                    onChange={(e) => setFileTypeFilter(e.target.value as "json" | "csv" | "any")}
                    disabled={!projectId}
                  >
                    <option value="json">JSON only</option>
                    <option value="csv">CSV only</option>
                    <option value="any">Any file</option>
                  </select>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={hideStepFiles}
                    onChange={(e) => setHideStepFiles(e.target.checked)}
                    disabled={!projectId}
                  />
                  <span>Hide step* progress files</span>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <button
                  type="button"
                  className="border rounded px-3 py-2 bg-white hover:bg-blue-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  disabled={selectedDownloadCount === 0 || isDownloadingFiles || !projectId}
                  onClick={() => void downloadSelectedFiles()}
                >
                  {isDownloadingFiles ? "Downloading..." : `Download selected (${selectedDownloadCount})`}
                </button>
                <div className="text-gray-600 dark:text-slate-300">
                  Click a card or its checkbox to select. Hover the number to see the full filename.
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                {filteredFiles.map((file) => {
                  const isSelected = selectedFilesForDownload.has(file);
                  const shortLabel = getShortFileLabel(file);
                  const baseClasses =
                    "border rounded px-3 py-2 flex items-start justify-between gap-3 bg-white hover:bg-blue-50 transition-colors cursor-pointer dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700";
                  const selectedClasses = isSelected
                    ? "border-blue-400 ring-1 ring-blue-200 bg-blue-50 dark:border-blue-400 dark:ring-blue-500/40 dark:bg-blue-900/30"
                    : "";
                  return (
                    <div
                      key={file}
                      className={`${baseClasses} ${selectedClasses} group relative`}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleFileSelection(file)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleFileSelection(file);
                        }
                      }}
                      title={file}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4"
                          checked={isSelected}
                          onChange={() => toggleFileSelection(file)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold relative inline-flex items-center" title={file}>
                              {shortLabel}
                              <span className="absolute left-0 top-full mt-1 z-10 hidden group-hover:flex whitespace-pre rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg">
                                {file}
                              </span>
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-100">
                              {getFileTypeLabel(file)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="border rounded p-1 bg-white hover:bg-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            openFile(file);
                          }}
                          title="View / edit"
                          aria-label="View or edit file"
                        >
                          <EyeIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="border rounded p-1 bg-white hover:bg-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            void downloadFile(file);
                          }}
                          title="Download"
                          aria-label="Download file"
                        >
                          <DownloadIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {availableFiles.length === 0 && (
                  <div className="text-sm text-gray-500">No files found for this project yet.</div>
                )}
                {availableFiles.length > 0 && filteredFiles.length === 0 && (
                  <div className="text-sm text-gray-500">No matches for &quot;{fileFilter}&quot;.</div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {selectedFile && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 p-4" onClick={closeFileViewer}>
          <div
            className="bg-white w-full max-w-4xl rounded shadow-lg overflow-hidden dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3 dark:border-slate-700">
              <div className="min-w-0">
                <div className="text-lg font-medium">File viewer & editor</div>
                <div className="flex items-center gap-2 text-sm text-gray-600 truncate dark:text-slate-300">
                  <span className="truncate">{selectedFile}</span>
                  {fileContentMeta?.isJson && (
                    <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200">
                      JSON
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="border rounded px-3 py-2 text-sm bg-white hover:bg-blue-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  onClick={() => void downloadFile(selectedFile)}
                >
                  Download
                </button>
                <button className="border rounded px-3 py-2 dark:border-slate-600" onClick={closeFileViewer}>
                  Close
                </button>
              </div>
            </div>
            <div className="p-4 bg-gray-50 max-h-[70vh] overflow-y-auto space-y-3 dark:bg-slate-800">
              {isLoadingFileContent && <div className="text-sm text-gray-600 dark:text-slate-300">Loading...</div>}
              {!isLoadingFileContent && (
                <>
                  {fileViewerError && <div className="text-sm text-red-600">{fileViewerError}</div>}
                  {fileViewerMessage && <div className="text-sm text-green-700 dark:text-green-200">{fileViewerMessage}</div>}
                  <div className="flex items-center gap-2">
                    {fileContentMeta?.isJson && (
                      <button
                        type="button"
                        className="border rounded px-3 py-2 text-sm bg-white hover:bg-blue-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                        onClick={formatJsonContent}
                        disabled={isSavingFileContent}
                      >
                        Format JSON
                      </button>
                    )}
                    <div className="text-xs text-gray-600 dark:text-slate-300">
                      Edit the text below and hit save to write directly to the output folder.
                    </div>
                  </div>
                  <textarea
                    value={selectedFileContent}
                    onChange={(e) => setSelectedFileContent(e.target.value)}
                    className="w-full h-96 border rounded px-3 py-2 text-sm font-mono bg-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    spellCheck={false}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className="border rounded px-3 py-2 bg-white hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                      onClick={closeFileViewer}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="border rounded px-3 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      onClick={() => void saveFileEdits()}
                      disabled={isSavingFileContent}
                    >
                      {isSavingFileContent ? "Saving..." : "Save changes"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => handleConfirmResponse(false)}>
          <div
            className="bg-white w-full max-w-md rounded shadow-lg overflow-hidden dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-4 py-3 dark:border-slate-700">
              <div className="text-lg font-medium">{confirmDialog.title}</div>
            </div>
            <div className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">{confirmDialog.message}</div>
            <div className="flex justify-end gap-3 px-4 py-3 border-t dark:border-slate-700">
              <button className="border rounded px-4 py-2 dark:border-slate-600" onClick={() => handleConfirmResponse(false)}>
                {confirmDialog.cancelLabel || "Cancel"}
              </button>
              <button className="bg-blue-600 text-white rounded px-4 py-2" onClick={() => handleConfirmResponse(true)}>
                {confirmDialog.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
