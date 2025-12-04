'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { CampaignPlan, CampaignStructureRow, Tier } from "@/types/sem";

type StepResponse = Record<string, unknown>;

interface StartFormState {
  website: string;
  goal: string;
  location: string;
  state_list: string;
  language: string;
  monthly_adspend_myr: number;
}

type StepKey = "start" | "search" | "serp" | "site" | "combine" | "score" | "campaign" | "campaignPlan";
type CollapsibleKey = "project" | "step1" | "runSteps" | "step7" | "step8";

interface StepStatus {
  status: "idle" | "running" | "success" | "error";
  message?: string;
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

function useLogs() {
  const [logs, setLogs] = useState<string[]>([]);
  const push = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${timestamp}] ${message}`, ...prev]);
  };
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
    <section className="border rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h2 className="text-xl font-medium">{title}</h2>
        <button
          type="button"
          className="inline-flex items-center gap-2 border rounded px-3 py-1 text-sm bg-white hover:bg-blue-50 transition-colors"
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

async function callApi(endpoint: string, payload: Record<string, unknown>) {
  const res = await fetch(`/api/sem/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as StepResponse;
  if (!res.ok) {
    const message =
      typeof json.error === "string"
        ? json.error
        : typeof (json as { message?: string }).message === "string"
        ? (json as { message: string }).message
        : res.statusText;
    throw new Error(message);
  }
  return json;
}

export default function SemPage() {
  const MIN_AD_SPEND_MYR = 1000;
  const MAX_SLIDER_AD_SPEND_MYR = 50000;
  const [projectId, setProjectId] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);
  const [availableFiles, setAvailableFiles] = useState<string[]>([]);
  const [isFetchingFiles, setIsFetchingFiles] = useState(false);
  const [fileListError, setFileListError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<unknown>(null);
  const [isLoadingFileContent, setIsLoadingFileContent] = useState(false);
  const [fileViewerError, setFileViewerError] = useState<string | null>(null);
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
  });

  const [startForm, setStartForm] = useState<StartFormState>({
    website: "",
    goal: "Lead",
    location: "Malaysia",
    state_list: "",
    language: "English",
    monthly_adspend_myr: MIN_AD_SPEND_MYR,
  });
  const [adSpendInput, setAdSpendInput] = useState<string>(String(MIN_AD_SPEND_MYR));
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
  });

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
        website: startForm.website,
        goal: startForm.goal,
        location: startForm.location,
        state_list: startForm.state_list || undefined,
        language: startForm.language,
        monthly_adspend_myr: startForm.monthly_adspend_myr,
      };
      const res = await callApi("start", payload);
      setProjectId(res.projectId);
      persistProjectId(res.projectId);
      refreshProjectFiles(res.projectId);
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

  useEffect(() => {
    const fetchSuggested = async () => {
      try {
        const stored = typeof window !== "undefined" ? window.localStorage.getItem("sem_projectId") : null;
        if (stored) {
          setProjectId(stored);
          push(`Restored projectId: ${stored}`);
          refreshProjectFiles(stored);
          return;
        }
        const res = await fetch("/api/sem/next-project-id");
        if (!res.ok) return;
        const json = (await res.json()) as { suggested?: string };
        if (json.suggested) {
          setProjectId(json.suggested);
          persistProjectId(json.suggested);
          refreshProjectFiles(json.suggested);
          push(`Suggested projectId: ${json.suggested}`);
        }
      } catch {
        // ignore suggestion fetch errors
      }
    };
    fetchSuggested();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const res = await fetch(`/api/sem/project-files?projectId=${encodeURIComponent(pid)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { files?: string[]; error?: string };
      if (!res.ok || json.error) {
        const message = json.error ?? res.statusText;
        throw new Error(message);
      }
      setAvailableFiles(json.files ?? []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to load files";
      setAvailableFiles([]);
      setFileListError(message);
    } finally {
      setIsFetchingFiles(false);
    }
  }, []);

  const handleProjectIdChange = (value: string) => {
    setProjectId(value);
    persistProjectId(value);
  };

  const openFile = async (filename: string) => {
    if (!projectId || !filename) return;
    setSelectedFile(filename);
    setSelectedFileContent(null);
    setFileViewerError(null);
    setIsLoadingFileContent(true);
    try {
      const res = await fetch(
        `/api/sem/project-files?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(filename)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as { data?: unknown; error?: string };
      if (!res.ok || json.error) {
        const message = json.error ?? res.statusText;
        throw new Error(message);
      }
      setSelectedFileContent(json.data ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to read file";
      setSelectedFileContent(null);
      setFileViewerError(message);
    } finally {
      setIsLoadingFileContent(false);
    }
  };

  const closeFileViewer = () => {
    setSelectedFile(null);
    setSelectedFileContent(null);
    setFileViewerError(null);
    setIsLoadingFileContent(false);
  };

  useEffect(() => {
    if (projectId) {
      refreshProjectFiles(projectId);
    } else {
      setAvailableFiles([]);
    }
  }, [projectId, refreshProjectFiles]);

  const runStep = async (endpoint: string, label: string) => {
    if (!projectId) {
      push("Provide projectId first");
      return;
    }
    // Step 3 pre-checks for resume / rerun
    let force = false;
    if (endpoint === "serp-expansion") {
      const decision = await evaluateStep3(projectId);
      if (!decision.allow) return;
      force = decision.force;
    }
    if (endpoint === "site-keywords") {
      const decision = await evaluateStep4(projectId);
      if (!decision.allow) return;
      force = decision.force;
    }
    setIsBusy(true);
    const isSerp = endpoint === "serp-expansion";
    const isStep2 = endpoint === "search-volume";
    const isStep4 = endpoint === "site-keywords";
    const isStep6 = endpoint === "keyword-scoring";
    if (isSerp) {
      startStep3Polling(projectId);
    } else if (isStep2) {
      startStep2Polling(projectId);
    } else if (isStep4) {
      startStep4Polling(projectId);
    } else if (isStep6) {
      startStep6Polling(projectId);
    } else {
      startProgress();
    }
    updateStepStatus(mapEndpointToKey(endpoint), { status: "running", message: label });
    push(`Running ${label} for ${projectId}`);
    let succeeded = false;
    try {
      const res = await callApi(endpoint, { projectId, force });
      push(`${label} success: ${JSON.stringify(res)}`);
      updateStepStatus(mapEndpointToKey(endpoint), { status: "success", message: `${label} success` });
      succeeded = true;
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
      } else if (isStep6) {
        stopStep6Polling(succeeded);
      } else {
        stopProgress(succeeded);
      }
      setIsBusy(false);
    }
  };

  const runAllSteps = async () => {
    if (!projectId) {
      push("Provide projectId first");
      return;
    }
    setIsBusy(true);
    const sequence: Array<{ endpoint: string; label: string }> = [
      { endpoint: "search-volume", label: "Step 2 – Search Volume" },
      { endpoint: "serp-expansion", label: "Step 3 – SERP Expansion" },
      { endpoint: "site-keywords", label: "Step 4 – Keywords for Site" },
      { endpoint: "combine", label: "Step 5 – Combine & Dedupe" },
      { endpoint: "keyword-scoring", label: "Step 6 – Keyword Scoring" },
    ];

    try {
      for (const step of sequence) {
        updateStepStatus(mapEndpointToKey(step.endpoint), { status: "running", message: step.label });
        push(`Running ${step.label}`);
        const isSerp = step.endpoint === "serp-expansion";
        const isStep2 = step.endpoint === "search-volume";
        const isStep4 = step.endpoint === "site-keywords";
        const isStep6 = step.endpoint === "keyword-scoring";
        let force = false;
        if (step.endpoint === "serp-expansion") {
          const decision = await evaluateStep3(projectId);
          if (!decision.allow) {
            push("Skipping Step 3 (already completed and user declined rerun)");
            continue;
          }
          force = decision.force;
          startStep3Polling(projectId);
        } else if (step.endpoint === "site-keywords") {
          const decision = await evaluateStep4(projectId);
          if (!decision.allow) {
            push("Skipping Step 4 (already completed and user declined rerun)");
            continue;
          }
          force = decision.force;
          startStep4Polling(projectId);
        } else if (isStep2) {
          startStep2Polling(projectId);
        } else if (isStep6) {
          startStep6Polling(projectId);
        } else {
          startProgress();
        }
        try {
          const res = await callApi(step.endpoint, { projectId, force });
          push(`${step.label} success: ${JSON.stringify(res)}`);
          updateStepStatus(mapEndpointToKey(step.endpoint), { status: "success", message: "Done" });
          if (isSerp) stopStep3Polling(true);
          else if (isStep2) stopStep2Polling(true);
          if (isStep4) stopStep4Polling(true);
          if (isStep6) stopStep6Polling(true);
          if (!isSerp && !isStep2 && !isStep4 && !isStep6) stopProgress(true);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          push(`${step.label} failed: ${message}`);
          updateStepStatus(mapEndpointToKey(step.endpoint), { status: "error", message });
          if (isSerp) stopStep3Polling(false);
          else if (isStep2) stopStep2Polling(false);
          else if (isStep4) stopStep4Polling(false);
          else if (isStep6) stopStep6Polling(false);
          else stopProgress(false);
          throw err;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      push(`Run all failed: ${message}`);
      cancelStepProgressPoll();
      stopProgress(false);
    } finally {
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
  const startStep2Polling = (pid: string) => {
    stopProgress(false);
    cancelStepProgressPoll();
    pollStartRef.current = Date.now();
    scheduleStepProgressPoll("step2", pid, 800);
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
    step: "step2" | "step3" | "step4" | "step6",
    pid: string,
    nextDelay: number,
  ) => {
    const pollFn =
      step === "step3"
        ? fetchStep3Progress
        : step === "step4"
        ? fetchStep4Progress
        : step === "step6"
        ? fetchStep6Progress
        : fetchStep2Progress;
    pollTimer.current = window.setTimeout(async () => {
      const elapsed = Date.now() - pollStartRef.current;
      const isEarly = elapsed < 10000;
      const fallback = isEarly ? 1000 : 4000;
      const nextMs = await pollFn(pid, nextDelay || fallback);
      scheduleStepProgressPoll(step, pid, nextMs || fallback);
    }, nextDelay);
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

  const fetchStep3Progress = async (pid: string, fallback: number): Promise<number> => {
    try {
      const res = await fetch(`/api/sem/step3-progress?projectId=${encodeURIComponent(pid)}`);
      if (!res.ok) return fallback;
      const json = (await res.json()) as { percent?: number; nextPollMs?: number };
      if (typeof json.percent === "number") {
        setProgress(Math.min(Math.max(json.percent, 0), 100));
      }
      return typeof json.nextPollMs === "number" ? json.nextPollMs : fallback;
    } catch {
      return fallback;
    }
  };

  const fetchStep4Progress = async (pid: string, fallback: number): Promise<number> => {
    try {
      const res = await fetch(`/api/sem/step4-progress?projectId=${encodeURIComponent(pid)}`);
      if (!res.ok) return fallback;
      const json = (await res.json()) as { percent?: number; nextPollMs?: number };
      if (typeof json.percent === "number") {
        setProgress(Math.min(Math.max(json.percent, 0), 100));
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
        const confirmRun = window.confirm("Step 4 already completed. Rerun it?");
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
        const confirmRun = window.confirm("Step 3 already completed. Rerun it?");
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

  const handleCampaignStructure = async () => {
    if (!projectId) {
      push("Provide projectId first");
      return;
    }
    const filters = getSelectedCampaignFilters();
    setIsBusy(true);
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
      completed = true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      push(`Step 7 failed: ${message}`);
      updateStepStatus("campaign", { status: "error", message });
    } finally {
      stopProgress(completed);
      setIsBusy(false);
    }
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

  const handleGenerateCampaignPlan = async () => {
    if (!projectId) {
      push("Provide projectId first");
      return;
    }
    setIsBusy(true);
    setProgress(0);
    setCampaignPlanResult(null);
    startStep8Timer();
    updateStepStatus("campaignPlan", { status: "running", message: "Waiting for OpenAI" });
    push("Step 8 – Generating campaign plan from 09-google-ads-campaign-structure.csv");
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      push(`Step 8 failed: ${message}`);
      updateStepStatus("campaignPlan", { status: "error", message });
    } finally {
      stopStep8Timer();
      setIsBusy(false);
    }
  };

  return (
    <main className="min-h-screen p-6 flex justify-center">
      <div className="w-full max-w-6xl space-y-6">
        <h1 className="text-2xl font-semibold text-center">SEM Keyword Pipeline</h1>

        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <div className="flex-1 space-y-6">
            <CollapsibleSection
              title="Project ID & Files"
              isOpen={openSections.project}
              onToggle={() => toggleSection("project")}
            >
              <label className="grid gap-1">
                <span>projectId</span>
                <input
                  className="border rounded px-3 py-2"
                  value={projectId}
                  onChange={(e) => handleProjectIdChange(e.target.value)}
                  placeholder="YYYYMMDD-HH-001"
                  autoComplete="off"
                />
              </label>
              <div className="text-sm text-gray-600">
                Used for starting/running steps and browsing generated JSON for this project.
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <button
                  className="border rounded px-3 py-2 bg-blue-50 disabled:opacity-50"
                  onClick={() => projectId && refreshProjectFiles(projectId)}
                  disabled={!projectId || isFetchingFiles}
                >
                  {isFetchingFiles ? "Loading files..." : "Refresh files"}
                </button>
                {fileListError && <span className="text-red-600">{fileListError}</span>}
                {!fileListError && availableFiles.length > 0 && (
                  <span className="text-gray-600">{availableFiles.length} file(s) found</span>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Available JSON files</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {availableFiles.map((file) => (
                    <button
                      key={file}
                      className="border rounded px-3 py-2 text-left hover:bg-blue-50"
                      onClick={() => openFile(file)}
                    >
                      {file}
                    </button>
                  ))}
                  {availableFiles.length === 0 && (
                    <div className="text-sm text-gray-500">No JSON files found for this project yet.</div>
                  )}
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Step 1 – Start Project"
              isOpen={openSections.step1}
              onToggle={() => toggleSection("step1")}
            >
              <form className="grid gap-3" onSubmit={handleStart}>
                <label className="grid gap-1">
                  <span>Website (required)</span>
                  <input
                    required
                    className="border rounded px-3 py-2"
                    value={startForm.website}
                    onChange={(e) => setStartForm((prev) => ({ ...prev, website: e.target.value }))}
                    placeholder="https://www.example.com"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1">
                    <span>Goal</span>
                    <input
                      className="border rounded px-3 py-2"
                      value={startForm.goal}
                      onChange={(e) => setStartForm((prev) => ({ ...prev, goal: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span>Location</span>
                    <input
                      className="border rounded px-3 py-2"
                      value={startForm.location}
                      onChange={(e) => setStartForm((prev) => ({ ...prev, location: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1">
                    <span>State list (comma separated)</span>
                    <input
                      className="border rounded px-3 py-2"
                      value={startForm.state_list}
                      onChange={(e) => setStartForm((prev) => ({ ...prev, state_list: e.target.value }))}
                      placeholder="Selangor, Kuala Lumpur"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span>Language</span>
                    <input
                      className="border rounded px-3 py-2"
                      value={startForm.language}
                      onChange={(e) => setStartForm((prev) => ({ ...prev, language: e.target.value }))}
                    />
                  </label>
                </div>
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
                      className="border rounded px-3 py-2 w-40"
                      value={adSpendInput}
                      onChange={(e) => handleAdSpendInputChange(e.target.value)}
                      onBlur={handleAdSpendBlur}
                      inputMode="numeric"
                    />
                    <span className="text-sm text-gray-600">
                      Selected: RM{startForm.monthly_adspend_myr.toLocaleString("en-MY")}
                    </span>
                  </div>
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
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <button
                  className="border rounded px-3 py-2"
                  disabled={isBusy}
                  onClick={() => runStep("search-volume", "Step 2 – Search Volume")}
                >
                  Step 2 – Search Volume
                </button>
                <button
                  className="border rounded px-3 py-2"
                  disabled={isBusy}
                  onClick={() => runStep("serp-expansion", "Step 3 – SERP Expansion")}
                >
                  Step 3 – SERP Expansion
                </button>
                <button
                  className="border rounded px-3 py-2"
                  disabled={isBusy}
                  onClick={() => runStep("site-keywords", "Step 4 – Keywords for Site")}
                >
                  Step 4 – Keywords for Site
                </button>
                <button
                  className="border rounded px-3 py-2"
                  disabled={isBusy}
                  onClick={() => runStep("combine", "Step 5 – Combine & Dedupe")}
                >
                  Step 5 – Combine & Dedupe
                </button>
                <button
                  className="border rounded px-3 py-2"
                  disabled={isBusy}
                  onClick={() => runStep("keyword-scoring", "Step 6 – Keyword Scoring")}
                >
                  Step 6 – Keyword Scoring
                </button>
                <button
                  className="border rounded px-3 py-2 bg-blue-50"
                  disabled={isBusy}
                  onClick={runAllSteps}
                >
                  Run All (2→6)
                </button>
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
                      <span>Tier {tier}</span>
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
                  disabled={isBusy}
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
                <div className="bg-gray-50 border rounded p-3 text-xs space-y-1">
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
                  disabled={isBusy}
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
                <div className="inline-flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded px-3 py-2">
                  <span>Waiting for OpenAI</span>
                  <span className="font-mono">{formatElapsed(step8Elapsed)}</span>
                </div>
              )}
              {campaignPlanResult && !isStep8Running && (
                <div className="bg-gray-50 border rounded p-3 text-xs whitespace-pre-wrap">
                  <div className="font-medium text-sm mb-1">Latest plan tree</div>
                  {buildCampaignTreeLog(campaignPlanResult.campaigns)}
                </div>
              )}
            </CollapsibleSection>
          </div>

          <div className="flex-1 flex flex-col gap-4 md:h-[80vh]">
            <section className="space-y-3 border rounded-lg p-4 flex-1 md:flex-[2] bg-white">
              <h2 className="text-xl font-medium">Logs</h2>
              {isStep1Running && (
                <div className="space-y-1 bg-blue-50 border border-blue-200 rounded p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Step 1 is running (usually takes up to 3 mins)</span>
                    <span className="font-mono">{formatElapsed(step1Elapsed)}</span>
                  </div>
                </div>
              )}
              {isStep8Running && (
                <div className="space-y-1 bg-blue-50 border border-blue-200 rounded p-2 text-sm">
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
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-64 md:max-h-[60vh] overflow-y-auto text-sm space-y-1">
                {logs.length === 0 && <div>No logs yet.</div>}
                {logs.map((log, idx) => (
                  <div key={idx} className="whitespace-pre-wrap">
                    {log}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3 border rounded-lg p-4 md:flex-1">
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
          </div>
        </div>
      </div>

      {selectedFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={closeFileViewer}
          >
            <div
              className="bg-white w-full max-w-4xl rounded shadow-lg overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="min-w-0">
                  <div className="text-lg font-medium">JSON Viewer</div>
                  <div className="text-sm text-gray-600 truncate">{selectedFile}</div>
                </div>
                <button className="border rounded px-3 py-2" onClick={closeFileViewer}>
                  Close
                </button>
              </div>
              <div className="p-4 bg-gray-50 max-h-[70vh] overflow-y-auto">
                {isLoadingFileContent && <div className="text-sm text-gray-600">Loading...</div>}
                {!isLoadingFileContent && fileViewerError && (
                  <div className="text-sm text-red-600">{fileViewerError}</div>
                )}
                {!isLoadingFileContent && !fileViewerError && (
                  <pre className="text-xs whitespace-pre-wrap">
                    {selectedFileContent === null ? "No content" : JSON.stringify(selectedFileContent, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
