'use client';

import { FormEvent, useEffect, useState, useRef } from "react";

type StepResponse = Record<string, unknown>;

interface StartFormState {
  website: string;
  goal: string;
  location: string;
  state_list: string;
  language: string;
}

type StepKey = "start" | "search" | "serp" | "site" | "combine" | "sync";

interface StepStatus {
  status: "idle" | "running" | "success" | "error";
  message?: string;
}

function useLogs() {
  const [logs, setLogs] = useState<string[]>([]);
  const push = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${timestamp}] ${message}`, ...prev]);
  };
  return { logs, push };
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
  const [projectId, setProjectId] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const { logs, push } = useLogs();
  const [stepStatuses, setStepStatuses] = useState<Record<StepKey, StepStatus>>({
    start: { status: "idle" },
    search: { status: "idle" },
    serp: { status: "idle" },
    site: { status: "idle" },
    combine: { status: "idle" },
    sync: { status: "idle" },
  });

  const [startForm, setStartForm] = useState<StartFormState>({
    website: "",
    goal: "Lead",
    location: "Malaysia",
    state_list: "",
    language: "English",
  });

  const handleStart = async (e: FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    startProgress();
    updateStepStatus("start", { status: "running", message: "Running Step 1" });
    push("Starting Step 1 – OpenAI init");
    try {
      const payload = {
        website: startForm.website,
        goal: startForm.goal,
        location: startForm.location,
        state_list: startForm.state_list || undefined,
        language: startForm.language,
      };
      const res = await callApi("start", payload);
      setProjectId(res.projectId);
      persistProjectId(res.projectId);
      push(`Step 1 done. projectId=${res.projectId}`);
      updateStepStatus("start", { status: "success", message: "Step 1 complete" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      push(`Step 1 failed: ${message}`);
      updateStepStatus("start", { status: "error", message });
    } finally {
      stopProgress(true);
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
          return;
        }
        const res = await fetch("/api/sem/next-project-id");
        if (!res.ok) return;
        const json = (await res.json()) as { suggested?: string };
        if (json.suggested) {
          setProjectId(json.suggested);
          push(`Suggested projectId: ${json.suggested}`);
        }
      } catch {
        // ignore suggestion fetch errors
      }
    };
    fetchSuggested();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistProjectId = (value: string) => {
    try {
      window.localStorage.setItem("sem_projectId", value);
    } catch {
      // ignore storage errors
    }
  };

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
    const isStep4 = endpoint === "site-keywords";
    const isStep6 = endpoint === "supabase-sync";
    if (isSerp) {
      startStep3Polling(projectId);
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
    startProgress();
    const sequence: Array<{ endpoint: string; label: string }> = [
      { endpoint: "search-volume", label: "Step 2 – Search Volume" },
      { endpoint: "serp-expansion", label: "Step 3 – SERP Expansion" },
      { endpoint: "site-keywords", label: "Step 4 – Keywords for Site" },
      { endpoint: "combine", label: "Step 5 – Combine & Dedupe" },
      { endpoint: "supabase-sync", label: "Step 6 – Supabase Sync" },
    ];

    try {
      for (const step of sequence) {
        updateStepStatus(mapEndpointToKey(step.endpoint), { status: "running", message: step.label });
        push(`Running ${step.label}`);
        const isSerp = step.endpoint === "serp-expansion";
        const isStep4 = step.endpoint === "site-keywords";
        const isStep6 = step.endpoint === "supabase-sync";
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
        } else if (isStep6) {
          startStep6Polling(projectId);
        }
        try {
          const res = await callApi(step.endpoint, { projectId, force });
          push(`${step.label} success: ${JSON.stringify(res)}`);
          updateStepStatus(mapEndpointToKey(step.endpoint), { status: "success", message: "Done" });
          if (isSerp) stopStep3Polling(true);
          if (isStep4) stopStep4Polling(true);
          if (isStep6) stopStep6Polling(true);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          push(`${step.label} failed: ${message}`);
          updateStepStatus(mapEndpointToKey(step.endpoint), { status: "error", message });
          if (isSerp) stopStep3Polling(false);
          else if (isStep4) stopStep4Polling(false);
          else if (isStep6) stopStep6Polling(false);
          else stopProgress(false);
          throw err;
        }
      }
      stopProgress(true);
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
      case "supabase-sync":
        return "sync";
      default:
        return "start";
    }
  };

  const updateStepStatus = (key: StepKey, status: StepStatus) => {
    setStepStatuses((prev) => ({ ...prev, [key]: status }));
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

  // Step 3 polling with adaptive interval
  const startStep3Polling = (pid: string) => {
    stopProgress(false);
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

  const scheduleStepProgressPoll = (step: "step3" | "step4" | "step6", pid: string, nextDelay: number) => {
    const pollFn = step === "step3" ? fetchStep3Progress : step === "step4" ? fetchStep4Progress : fetchStep6Progress;
    pollTimer.current = window.setTimeout(async () => {
      const elapsed = Date.now() - pollStartRef.current;
      const isEarly = elapsed < 10000;
      const fallback = isEarly ? 1000 : 4000;
      const nextMs = await pollFn(pid, nextDelay || fallback);
      scheduleStepProgressPoll(step, pid, nextMs || fallback);
    }, nextDelay);
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
      const json = (await res.json()) as { percent?: number; nextPollMs?: number };
      if (typeof json.percent === "number") {
        setProgress(Math.min(Math.max(json.percent, 0), 100));
      }
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

  return (
    <main className="min-h-screen p-6 flex flex-col items-center">
      <div className="w-full max-w-4xl space-y-6">
        <h1 className="text-2xl font-semibold text-center">SEM Keyword Pipeline</h1>

        <section className="space-y-3 border rounded-lg p-4">
        <h2 className="text-xl font-medium">Step 1 – Start Project</h2>
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
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
            disabled={isBusy}
          >
            {isBusy ? "Working..." : "Start Project"}
          </button>
        </form>
      </section>

        <section className="space-y-3 border rounded-lg p-4">
        <h2 className="text-xl font-medium">Run Steps by projectId</h2>
        <label className="grid gap-1">
          <span>projectId</span>
          <input
            className="border rounded px-3 py-2"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              persistProjectId(e.target.value);
            }}
            placeholder="YYYYMMDD-HH-001"
            autoComplete="off"
          />
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <button
            className="border rounded px-3 py-2"
            disabled={isBusy}
            onClick={() => runStep("search-volume", "Step 2 – Search Volume")}
          >
            Step 2 – Search Volume
          </button>
          <button className="border rounded px-3 py-2" disabled={isBusy} onClick={() => runStep("serp-expansion", "Step 3 – SERP Expansion")}>
            Step 3 – SERP Expansion
          </button>
          <button className="border rounded px-3 py-2" disabled={isBusy} onClick={() => runStep("site-keywords", "Step 4 – Keywords for Site")}>
            Step 4 – Keywords for Site
          </button>
          <button className="border rounded px-3 py-2" disabled={isBusy} onClick={() => runStep("combine", "Step 5 – Combine & Dedupe")}>
            Step 5 – Combine & Dedupe
          </button>
          <button className="border rounded px-3 py-2" disabled={isBusy} onClick={() => runStep("supabase-sync", "Step 6 – Supabase Sync")}>
            Step 6 – Supabase Sync
          </button>
          <button
            className="border rounded px-3 py-2 bg-blue-50"
            disabled={isBusy}
            onClick={runAllSteps}
          >
            Run All (2→6)
          </button>
        </div>
      </section>

        <section className="space-y-3 border rounded-lg p-4">
        <h2 className="text-xl font-medium">Step Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          {([
            { key: "start", label: "Step 1 – Start" },
            { key: "search", label: "Step 2 – Search Volume" },
            { key: "serp", label: "Step 3 – SERP Expansion" },
            { key: "site", label: "Step 4 – Keywords for Site" },
            { key: "combine", label: "Step 5 – Combine & Dedupe" },
            { key: "sync", label: "Step 6 – Supabase Sync" },
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

        <section className="space-y-3 border rounded-lg p-4 mb-6">
        <h2 className="text-xl font-medium">Logs</h2>
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
        <div className="bg-gray-50 border rounded p-3 h-64 overflow-y-auto text-sm space-y-1">
          {logs.length === 0 && <div>No logs yet.</div>}
          {logs.map((log, idx) => (
            <div key={idx} className="whitespace-pre-wrap">
              {log}
            </div>
          ))}
        </div>
      </section>
      </div>
    </main>
  );
}
