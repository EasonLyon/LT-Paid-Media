'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OutputProjectSummary } from "@/lib/storage/project-files";

type FetchState = "idle" | "loading" | "error";

type DeletingTarget =
  | { projectId: string; filename: string; bulk?: false }
  | { projectId: string; filename?: undefined; bulk?: false }
  | { projectId: string; filename?: undefined; bulk: true }
  | null;

type BackupStatus = {
  status: "idle" | "running" | "success" | "error";
  message?: string;
};

export default function OutputManagerPage() {
  const [projects, setProjects] = useState<OutputProjectSummary[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DeletingTarget>(null);
  const [backupStatus, setBackupStatus] = useState<Record<string, BackupStatus>>({});
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{
    projectId: string;
    filename: string;
    loading: boolean;
    error?: string | null;
    content?: string;
    isJson?: boolean;
    parsed?: unknown;
  } | null>(null);

  const refresh = useCallback(async () => {
    setFetchState("loading");
    setError(null);
    try {
      const res = await fetch("/api/output", { cache: "no-store" });
      const json = (await res.json()) as { projects?: OutputProjectSummary[]; error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error ?? res.statusText);
      }
      const nextProjects = json.projects ?? [];
      setProjects(nextProjects);
      setFetchState("idle");
      setSelected((prev) => {
        const validIds = new Set(nextProjects.map((p) => p.id));
        const next: Record<string, string[]> = {};
        for (const [id, files] of Object.entries(prev)) {
          if (validIds.has(id)) next[id] = files;
        }
        return next;
      });
      setExpanded((prev) => {
        const validIds = new Set(nextProjects.map((p) => p.id));
        const next: Record<string, boolean> = {};
        for (const [id, isExpanded] of Object.entries(prev)) {
          if (validIds.has(id)) next[id] = isExpanded;
        }
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load projects";
      setError(message);
      setFetchState("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totalSize = useMemo(() => projects.reduce((sum, project) => sum + project.totalSize, 0), [projects]);
  const totalFiles = useMemo(
    () => projects.reduce((sum, project) => sum + project.files.length, 0),
    [projects],
  );
  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => project.id.toLowerCase().includes(q));
  }, [projects, searchQuery]);

  const handleDeleteProject = async (projectId: string) => {
    const confirm = window.confirm(`Delete project ${projectId} and all files? This cannot be undone.`);
    if (!confirm) return;
    setDeleting({ projectId });
    try {
      const res = await fetch(`/api/output?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error ?? res.statusText);
      }
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to delete project";
      alert(message);
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteFile = async (projectId: string, filename: string) => {
    const confirm = window.confirm(`Delete ${filename} from ${projectId}?`);
    if (!confirm) return;
    setDeleting({ projectId, filename });
    try {
      const res = await fetch(
        `/api/output?projectId=${encodeURIComponent(projectId)}&filename=${encodeURIComponent(filename)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error ?? res.statusText);
      }
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to delete file";
      alert(message);
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteSelected = async (projectId: string) => {
    const filenames = selected[projectId] ?? [];
    if (filenames.length === 0) return;
    const confirm = window.confirm(`Delete ${filenames.length} file${filenames.length === 1 ? "" : "s"} from ${projectId}?`);
    if (!confirm) return;
    setDeleting({ projectId, bulk: true });
    const failures: string[] = [];
    for (const filename of filenames) {
      try {
        const res = await fetch(
          `/api/output?projectId=${encodeURIComponent(projectId)}&filename=${encodeURIComponent(filename)}`,
          { method: "DELETE" },
        );
        const json = (await res.json()) as { error?: string };
        if (!res.ok || json.error) {
          throw new Error(json.error ?? res.statusText);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to delete file";
        failures.push(`${filename}: ${message}`);
      }
    }
    await refresh();
    setDeleting(null);
    if (failures.length > 0) {
      alert(`Some files could not be deleted:\n${failures.join("\n")}`);
    }
  };

  const handleBackupProject = async (projectId: string) => {
    const confirm = window.confirm(`Sync ${projectId} to R2 as a backup?`);
    if (!confirm) return;
    setBackupStatus((prev) => ({ ...prev, [projectId]: { status: "running" } }));
    try {
      const res = await fetch(`/api/storage/backup-to-r2?projectId=${encodeURIComponent(projectId)}`, { method: "POST" });
      const json = (await res.json()) as { copied?: number; skipped?: number; error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error ?? res.statusText);
      }
      const copied = typeof json.copied === "number" ? json.copied : 0;
      const skipped = typeof json.skipped === "number" ? json.skipped : 0;
      setBackupStatus((prev) => ({
        ...prev,
        [projectId]: { status: "success", message: `Backed up ${copied} file${copied === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}.` },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to sync backup";
      setBackupStatus((prev) => ({ ...prev, [projectId]: { status: "error", message } }));
    }
  };

  const toggleFile = (projectId: string, filename: string) => {
    setSelected((prev) => {
      const current = new Set(prev[projectId] ?? []);
      if (current.has(filename)) {
        current.delete(filename);
      } else {
        current.add(filename);
      }
      return { ...prev, [projectId]: Array.from(current) };
    });
  };

  const toggleAll = (projectId: string, filenames: string[]) => {
    setSelected((prev) => {
      const current = new Set(prev[projectId] ?? []);
      const allSelected = filenames.every((name) => current.has(name));
      const next = allSelected ? [] : filenames;
      return { ...prev, [projectId]: next };
    });
  };

  const toggleExpanded = (projectId: string) => {
    setExpanded((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  };

  const openPreview = async (projectId: string, filename: string) => {
    setPreview({ projectId, filename, loading: true, error: null });
    try {
      const res = await fetch(
        `/api/output?projectId=${encodeURIComponent(projectId)}&filename=${encodeURIComponent(filename)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        content?: string;
        isJson?: boolean;
        parsed?: unknown;
        error?: string;
      };
      if (!res.ok || json.error) {
        throw new Error(json.error ?? res.statusText);
      }
      setPreview({ projectId, filename, loading: false, content: json.content ?? "", isJson: json.isJson, parsed: json.parsed });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to preview file";
      setPreview({ projectId, filename, loading: false, error: message });
    }
  };

  const closePreview = () => setPreview(null);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** exponent;
    return `${value.toFixed(value >= 10 || value === Math.floor(value) ? 0 : 1)} ${units[exponent]}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-sky-50 text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-14 md:px-10 lg:px-12">
        <header className="space-y-4">
          <p className="text-sm uppercase tracking-[0.3em] text-sky-600">Storage</p>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <h1 className="text-4xl font-semibold leading-tight text-slate-900 md:text-5xl">Output Manager</h1>
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">
                {projects.length} project{projects.length === 1 ? "" : "s"}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">
                {totalFiles} file{totalFiles === 1 ? "" : "s"}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">
                {formatBytes(totalSize)} total
              </span>
            </div>
          </div>
          <p className="max-w-2xl text-base text-slate-600">
            Browse generated project files stored in Supabase (with optional R2 backup). Delete individual files or remove entire
            projects to keep storage tidy.
          </p>
          <div className="w-full max-w-md">
            <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Search project</label>
            <input
              type="search"
              placeholder="e.g. 20251203"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800 shadow-sm focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
          </div>
        </header>

        <div className="rounded-3xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_6px_rgba(52,211,153,0.15)]" />
              <span className="text-sm font-medium text-slate-700">
                {fetchState === "loading" ? "Refreshing..." : "Live snapshot"}
              </span>
            </div>
            <button
              onClick={() => refresh()}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-600 transition hover:-translate-y-0.5 hover:bg-white"
              disabled={fetchState === "loading"}
            >
              Refresh
            </button>
          </div>
          {error ? (
            <div className="p-6 text-sm text-red-600">{error}</div>
          ) : filteredProjects.length === 0 && fetchState === "idle" ? (
            <div className="p-6 text-sm text-slate-600">No output projects found yet.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredProjects.map((project) => {
                const isExpanded = expanded[project.id] ?? false;
                const visibleFiles = isExpanded ? project.files : project.files.slice(0, 1);
                const allSelected = project.files.length > 0 && project.files.every((file) => (selected[project.id] ?? []).includes(file.name));
                const backup = backupStatus[project.id];

                return (
                <div key={project.id} className="p-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{project.id}</p>
                      <h2 className="text-xl font-semibold text-slate-900">
                        {project.files.length} file{project.files.length === 1 ? "" : "s"} · {formatBytes(project.totalSize)}
                      </h2>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {project.files.length > 1 && (
                        <button
                          onClick={() => toggleExpanded(project.id)}
                          className="self-start rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:bg-slate-50"
                        >
                          {isExpanded ? "Collapse files" : "Expand files"}
                        </button>
                      )}
                      <button
                        onClick={() => void handleBackupProject(project.id)}
                        className="self-start rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 transition hover:-translate-y-0.5 hover:bg-white disabled:opacity-60"
                        disabled={backup?.status === "running" || !!deleting}
                      >
                        {backup?.status === "running" ? "Backing up…" : "Backup to R2"}
                      </button>
                      <button
                        onClick={() => void handleDeleteSelected(project.id)}
                        className="self-start rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:bg-white disabled:opacity-60"
                        disabled={(selected[project.id]?.length ?? 0) === 0 || !!deleting}
                      >
                        {deleting && deleting.projectId === project.id && deleting.bulk
                          ? "Deleting selected…"
                          : `Delete selected (${selected[project.id]?.length ?? 0})`}
                      </button>
                      <button
                        onClick={() => void handleDeleteProject(project.id)}
                        className="self-start rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:-translate-y-0.5 hover:bg-white disabled:opacity-60"
                        disabled={!!deleting}
                      >
                        {deleting && deleting.projectId === project.id && !deleting.filename ? "Deleting…" : "Delete project"}
                      </button>
                    </div>
                  </div>
                  {backup?.message && (
                    <p className={`text-xs ${backup.status === "error" ? "text-red-600" : "text-emerald-600"}`}>
                      {backup.message}
                    </p>
                  )}
                  {project.files.length > 0 ? (
                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-4 py-2 text-left">
                              <input
                                type="checkbox"
                                aria-label="Select all files"
                                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-2 focus:ring-sky-500"
                                checked={allSelected}
                                onChange={() => toggleAll(project.id, project.files.map((file) => file.name))}
                              />
                            </th>
                            <th className="px-4 py-2 text-left font-semibold">File</th>
                            <th className="px-4 py-2 text-left font-semibold">Size</th>
                            <th className="px-4 py-2 text-left font-semibold">Modified</th>
                            <th className="px-4 py-2 text-right font-semibold">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {visibleFiles.map((file) => (
                            <tr key={file.name} className="hover:bg-slate-50/60">
                              <td className="px-4 py-2">
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${file.name}`}
                                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-2 focus:ring-sky-500"
                                  checked={(selected[project.id] ?? []).includes(file.name)}
                                  onChange={() => toggleFile(project.id, file.name)}
                                />
                              </td>
                              <td className="px-4 py-2 font-mono text-xs text-slate-800">
                                <button
                                  onClick={() => void openPreview(project.id, file.name)}
                                  className="text-left text-sky-700 underline decoration-sky-200 decoration-2 underline-offset-4 hover:text-sky-900"
                                >
                                  {file.name}
                                </button>
                              </td>
                              <td className="px-4 py-2 text-slate-700">{formatBytes(file.size)}</td>
                              <td className="px-4 py-2 text-slate-600">
                                {new Date(file.modifiedMs).toLocaleString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <button
                                  onClick={() => void handleDeleteFile(project.id, file.name)}
                                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 transition hover:-translate-y-0.5 hover:bg-white disabled:opacity-60"
                                  disabled={
                                    !!deleting &&
                                    deleting.projectId === project.id &&
                                    (deleting.bulk ? true : !!deleting.filename ? deleting.filename !== file.name : true)
                                  }
                                >
                                  {deleting &&
                                  deleting.projectId === project.id &&
                                  deleting.filename &&
                                  deleting.filename === file.name
                                    ? "Deleting…"
                                    : "Delete"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!isExpanded && project.files.length > 1 && (
                        <div className="bg-slate-50 px-4 py-3 text-xs text-slate-600">
                          {project.files.length - 1} more file{project.files.length - 1 === 1 ? "" : "s"} hidden. Expand to view.
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-600">No files in this project.</p>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
          onClick={closePreview}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{preview.projectId}</p>
                <p className="font-mono text-xs text-slate-800">{preview.filename}</p>
              </div>
              <button
                onClick={closePreview}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700 transition hover:-translate-y-0.5 hover:bg-white"
              >
                Close
              </button>
            </div>
            <div className="max-h-[64vh] overflow-auto px-5 py-4 text-sm text-slate-800">
              {preview.loading ? (
                <p className="text-slate-500">Loading preview…</p>
              ) : preview.error ? (
                <p className="text-red-600">{preview.error}</p>
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-800">
                  {preview.isJson && preview.parsed
                    ? JSON.stringify(preview.parsed, null, 2)
                    : (preview.content ?? "").slice(0, 200000)}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
