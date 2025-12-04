'use client';

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CampaignPlan, CampaignPlanAdGroup, CampaignPlanKeyword } from "@/types/sem";

type ViewMode = "hierarchy" | "tables";
type SortDirection = "asc" | "desc";

interface CampaignRow {
  idx: number;
  CampaignName: string;
  Goal: string;
  CampaignType: string;
  BudgetDailyMYR: number | null;
  TargetCPAMYR: number | null;
  Language: string;
  LocationName: string;
  LocationRadiusKm: number | null;
  AdGroupsCount: number;
}

interface AdGroupRow {
  campaignIdx: number;
  idx: number;
  CampaignName: string;
  AdGroupName: string;
  DefaultMaxCPCMYR: number | null;
  KeywordsCount: number;
  NegativeKeywordsCount: number;
  ResponsiveSearchAdsCount: number;
}

interface KeywordRow {
  campaignIdx: number;
  adGroupIdx: number;
  index: number;
  CampaignName: string;
  AdGroupName: string;
  Keyword: string;
  MatchType: string;
  IsNegative: boolean;
  adGroupCpc: number | null;
  AdGroupCPC: number | null;
  AvgMonthlySearches: number | null;
  CPC: number | null;
  CompetitionIndex: number | null;
}

interface SortState<T extends string> {
  column: T;
  direction: SortDirection;
}

function EditableCell({
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  value: string | number | null;
  onChange: (next: string | number | null) => void;
  type?: "text" | "number";
  placeholder?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<string>(() => (value ?? "").toString());

  useEffect(() => {
    setDraft(value === null || typeof value === "undefined" ? "" : value.toString());
  }, [value]);

  const commit = () => {
    setIsEditing(false);
    if (type === "number") {
      const parsed = draft.trim() === "" ? null : Number(draft);
      if (Number.isNaN(parsed)) return;
      onChange(parsed);
      return;
    }
    onChange(draft);
  };

  const cancel = () => {
    setDraft(value === null || typeof value === "undefined" ? "" : value.toString());
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        className="w-full border rounded px-2 py-1 text-sm"
        value={draft}
        placeholder={placeholder}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
      />
    );
  }

  return (
    <div
      className="w-full min-h-[32px] px-2 py-1 rounded hover:bg-blue-50 cursor-text"
      onDoubleClick={() => setIsEditing(true)}
      title="Double click to edit"
    >
      {value === null || typeof value === "undefined" || value === "" ? (
        <span className="text-gray-400">{placeholder ?? "—"}</span>
      ) : (
        value
      )}
    </div>
  );
}

function TableSortHeader({
  label,
  column,
  sort,
  onChange,
}: {
  label: string;
  column: string;
  sort: SortState<string>;
  onChange: (column: string) => void;
}) {
  const active = sort.column === column;
  const arrow = !active ? "" : sort.direction === "asc" ? "↑" : "↓";
  return (
    <button className="flex items-center gap-1 text-left font-medium" onClick={() => onChange(column)} type="button">
      <span>{label}</span>
      <span className="text-xs text-gray-500">{arrow}</span>
    </button>
  );
}

function keywordList(targeting: CampaignPlan["AdGroups"][number]["Targeting"], negative: boolean): CampaignPlanKeyword[] {
  if (!targeting) return [];
  const list = negative ? targeting.NegativeKeywords : targeting.Keywords;
  return Array.isArray(list) ? list : [];
}

function formatCurrency(value: number | null): string {
  if (value === null || typeof value === "undefined" || Number.isNaN(value)) return "—";
  return `RM ${value.toLocaleString("en-MY", { maximumFractionDigits: 2 })}`;
}

function formatCpc(value: number | null): string {
  if (value === null || typeof value === "undefined" || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-MY", { maximumFractionDigits: 2 });
}

function formatNumber(value: number | null): string {
  if (value === null || typeof value === "undefined" || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-MY");
}

function formatDecimal(value: number | null, fractionDigits = 2): string {
  if (value === null || typeof value === "undefined" || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-MY", { maximumFractionDigits: fractionDigits, minimumFractionDigits: 0 });
}

function computeKeywordAverages(list: Array<Pick<CampaignPlanKeyword, "AvgMonthlySearches" | "CPC" | "CompetitionIndex">>) {
  const avg = (values: Array<number | null | undefined>) => {
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!nums.length) return null;
    return nums.reduce((sum, val) => sum + val, 0) / nums.length;
  };
  const avgMonthly = avg(list.map((item) => item.AvgMonthlySearches ?? null));
  return {
    avgMonthlySearches: avgMonthly === null ? null : Math.round(avgMonthly),
    avgCpc: avg(list.map((item) => item.CPC ?? null)),
    avgCompetition: avg(list.map((item) => item.CompetitionIndex ?? null)),
  };
}

function downloadCsv(rows: Array<Record<string, string | number | boolean | null>>, filename: string) {
  const headers = Object.keys(rows[0] ?? {});
  const escapeValue = (val: unknown) => {
    if (val === null || typeof val === "undefined") return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [headers.join(",")]
    .concat(rows.map((row) => headers.map((header) => escapeValue(row[header])).join(",")))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function CampaignVisualizerPage() {
  const searchParams = useSearchParams();
  const [projectIdInput, setProjectIdInput] = useState<string>("");
  const [campaigns, setCampaigns] = useState<CampaignPlan[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("hierarchy");
  const [fileName, setFileName] = useState<string | null>(null);
  const [backupFileName, setBackupFileName] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedAdGroup, setSelectedAdGroup] = useState<{ campaignIdx: number; adGroupIdx: number } | null>(null);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<number, boolean>>({});
  const [campaignSort, setCampaignSort] = useState<SortState<keyof CampaignRow>>({
    column: "CampaignName",
    direction: "asc",
  });
  const [adGroupSort, setAdGroupSort] = useState<SortState<keyof AdGroupRow>>({
    column: "CampaignName",
    direction: "asc",
  });
  const [keywordSort, setKeywordSort] = useState<SortState<keyof KeywordRow>>({
    column: "CampaignName",
    direction: "asc",
  });
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [filters, setFilters] = useState<{
    campaign: string;
    adGroup: string;
    matchType: string;
    negative: "all" | "normal" | "negative";
    minCpc: string;
    maxCpc: string;
  }>({
    campaign: "",
    adGroup: "",
    matchType: "",
    negative: "all",
    minCpc: "",
    maxCpc: "",
  });

  const campaignRows = useMemo<CampaignRow[]>(() => {
    return campaigns.map((campaign, idx) => ({
      idx,
      CampaignName: campaign.CampaignName ?? `Campaign ${idx + 1}`,
      Goal: campaign.Goal ?? "",
      CampaignType: campaign.CampaignType ?? "",
      BudgetDailyMYR: campaign.BudgetDailyMYR ?? null,
      TargetCPAMYR: campaign.TargetCPAMYR ?? null,
      Language: campaign.Language ?? "",
      LocationName: campaign.Location?.Name ?? "",
      LocationRadiusKm: campaign.Location?.RadiusKm ?? null,
      AdGroupsCount: Array.isArray(campaign.AdGroups) ? campaign.AdGroups.length : 0,
    }));
  }, [campaigns]);

  const adGroupRows = useMemo<AdGroupRow[]>(() => {
    return campaigns.flatMap((campaign, campaignIdx) =>
      (campaign.AdGroups ?? []).map((adGroup, idx) => {
        const targeting = adGroup.Targeting;
        const keywords = keywordList(targeting, false);
        const negatives = keywordList(targeting, true);
        const ads = Array.isArray(adGroup.ResponsiveSearchAds) ? adGroup.ResponsiveSearchAds : [];
        return {
          campaignIdx,
          idx,
          CampaignName: campaign.CampaignName ?? `Campaign ${campaignIdx + 1}`,
          AdGroupName: adGroup.AdGroupName ?? `Ad Group ${idx + 1}`,
          DefaultMaxCPCMYR: adGroup.DefaultMaxCPCMYR ?? null,
          KeywordsCount: keywords.length,
          NegativeKeywordsCount: negatives.length,
          ResponsiveSearchAdsCount: ads.length,
        };
      }),
    );
  }, [campaigns]);

  const keywordRows = useMemo<KeywordRow[]>(() => {
    return campaigns.flatMap((campaign, campaignIdx) =>
      (campaign.AdGroups ?? []).flatMap((adGroup, adGroupIdx) => {
        const targeting = adGroup.Targeting;
        const normalKeywords = keywordList(targeting, false).map((kw, index) => ({
          campaignIdx,
          adGroupIdx,
          index,
          CampaignName: campaign.CampaignName ?? `Campaign ${campaignIdx + 1}`,
          AdGroupName: adGroup.AdGroupName ?? `Ad Group ${adGroupIdx + 1}`,
          Keyword: kw.Keyword ?? "",
          MatchType: kw.MatchType ?? "",
          IsNegative: false,
          adGroupCpc: adGroup.DefaultMaxCPCMYR ?? null,
          AdGroupCPC: adGroup.DefaultMaxCPCMYR ?? null,
          AvgMonthlySearches: kw.AvgMonthlySearches ?? null,
          CPC: kw.CPC ?? null,
          CompetitionIndex: kw.CompetitionIndex ?? null,
        }));
        const negativeKeywords = keywordList(targeting, true).map((kw, index) => ({
          campaignIdx,
          adGroupIdx,
          index,
          CampaignName: campaign.CampaignName ?? `Campaign ${campaignIdx + 1}`,
          AdGroupName: adGroup.AdGroupName ?? `Ad Group ${adGroupIdx + 1}`,
          Keyword: kw.Keyword ?? "",
          MatchType: kw.MatchType ?? "",
          IsNegative: true,
          adGroupCpc: adGroup.DefaultMaxCPCMYR ?? null,
          AdGroupCPC: adGroup.DefaultMaxCPCMYR ?? null,
          AvgMonthlySearches: kw.AvgMonthlySearches ?? null,
          CPC: kw.CPC ?? null,
          CompetitionIndex: kw.CompetitionIndex ?? null,
        }));
        return [...normalKeywords, ...negativeKeywords];
      }),
    );
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    const sorted = [...campaignRows].sort((a, b) => {
      const dir = campaignSort.direction === "asc" ? 1 : -1;
      const av = a[campaignSort.column];
      const bv = b[campaignSort.column];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return sorted.filter((row) => row.CampaignName.toLowerCase().includes(filters.campaign.toLowerCase()));
  }, [campaignRows, campaignSort, filters.campaign]);

  const filteredAdGroups = useMemo(() => {
    const matches = adGroupRows.filter((row) => {
      const matchesCampaign = row.CampaignName.toLowerCase().includes(filters.campaign.toLowerCase());
      const matchesAdGroup = row.AdGroupName.toLowerCase().includes(filters.adGroup.toLowerCase());
      const minCpc =
        filters.minCpc.trim() === "" || !Number.isFinite(Number(filters.minCpc)) ? null : Number(filters.minCpc);
      const maxCpc =
        filters.maxCpc.trim() === "" || !Number.isFinite(Number(filters.maxCpc)) ? null : Number(filters.maxCpc);
      const withinMin = minCpc === null || (row.DefaultMaxCPCMYR ?? Infinity) >= minCpc;
      const withinMax = maxCpc === null || (row.DefaultMaxCPCMYR ?? 0) <= maxCpc;
      return matchesCampaign && matchesAdGroup && withinMin && withinMax;
    });
    const sorted = matches.sort((a, b) => {
      const dir = adGroupSort.direction === "asc" ? 1 : -1;
      const av = a[adGroupSort.column];
      const bv = b[adGroupSort.column];
      if (typeof av === "number" && typeof bv === "number") return ((av ?? 0) - (bv ?? 0)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return sorted;
  }, [adGroupRows, adGroupSort, filters]);

  const filteredKeywords = useMemo(() => {
    const matches = keywordRows.filter((row) => {
      const matchesCampaign = row.CampaignName.toLowerCase().includes(filters.campaign.toLowerCase());
      const matchesAdGroup = row.AdGroupName.toLowerCase().includes(filters.adGroup.toLowerCase());
      const matchTypeValue = row.MatchType ? row.MatchType.toLowerCase() : "";
      const matchesMatchType = !filters.matchType || matchTypeValue.includes(filters.matchType.toLowerCase());
      const matchesNegative =
        filters.negative === "all" ||
        (filters.negative === "negative" ? row.IsNegative : !row.IsNegative);
      const minCpc =
        filters.minCpc.trim() === "" || !Number.isFinite(Number(filters.minCpc)) ? null : Number(filters.minCpc);
      const maxCpc =
        filters.maxCpc.trim() === "" || !Number.isFinite(Number(filters.maxCpc)) ? null : Number(filters.maxCpc);
      const withinMin = minCpc === null || (row.adGroupCpc ?? Infinity) >= minCpc;
      const withinMax = maxCpc === null || (row.adGroupCpc ?? 0) <= maxCpc;
      return matchesCampaign && matchesAdGroup && matchesMatchType && matchesNegative && withinMin && withinMax;
    });
    const sorted = matches.sort((a, b) => {
      const dir = keywordSort.direction === "asc" ? 1 : -1;
      const av = a[keywordSort.column];
      const bv = b[keywordSort.column];
      if (typeof av === "number" && typeof bv === "number") return ((av ?? 0) - (bv ?? 0)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return sorted;
  }, [keywordRows, keywordSort, filters]);

  const keywordAverages = useMemo(() => computeKeywordAverages(filteredKeywords), [filteredKeywords]);

  useEffect(() => {
    const paramPid = searchParams?.get("projectId");
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("sem_projectId");
    } catch {
      // ignore storage read errors
    }
    if (paramPid && paramPid !== projectIdInput) {
      setProjectIdInput(paramPid);
      void loadPlan(paramPid);
      return;
    }
    if (!paramPid && stored && !projectIdInput) {
      setProjectIdInput(stored);
      void loadPlan(stored);
      return;
    }
    void loadPlan(projectIdInput || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadPlan = async (pid?: string) => {
    const targetProjectId = pid ?? projectIdInput;
    setIsLoading(true);
    setStatusMessage("Loading plan and creating backup…");
    try {
      const params = new URLSearchParams();
      if (targetProjectId) params.set("projectId", targetProjectId);
      const res = await fetch(`/api/sem/campaign-visualizer?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as {
        projectId?: string;
        campaigns?: CampaignPlan[];
        fileName?: string;
        backupFileName?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || res.statusText);
      }
      if (json.projectId) {
        setProjectIdInput(json.projectId);
        try {
          window.localStorage.setItem("sem_projectId", json.projectId);
        } catch {
          // ignore storage write failures
        }
      }
      setCampaigns(json.campaigns ?? []);
      setSelectedAdGroup(null);
      setExpandedCampaigns({});
      setFileName(json.fileName ?? null);
      setBackupFileName(json.backupFileName ?? null);
      setStatusMessage(
        `Loaded ${json.campaigns?.length ?? 0} campaign(s) from ${json.fileName ?? "10/11-*.json"}. Backup: ${
          json.backupFileName ?? "n/a"
        }`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to load plan";
      setStatusMessage(message);
      setCampaigns([]);
    } finally {
      setIsLoading(false);
    }
  };

  const updateCampaign = (campaignIdx: number, updates: Partial<CampaignPlan>) => {
    setCampaigns((prev) =>
      prev.map((campaign, idx) => (idx === campaignIdx ? { ...campaign, ...updates } : campaign)),
    );
  };

  const updateLocationField = (campaignIdx: number, key: "Name" | "RadiusKm", value: string | number | null) => {
    setCampaigns((prev) =>
      prev.map((campaign, idx) =>
        idx === campaignIdx
          ? {
              ...campaign,
              Location: {
                Name: key === "Name" ? String(value ?? "") : campaign.Location?.Name ?? "",
                RadiusKm: key === "RadiusKm" ? (value as number | null) : campaign.Location?.RadiusKm ?? null,
              },
            }
          : campaign,
      ),
    );
  };

  const updateAdGroup = (campaignIdx: number, adGroupIdx: number, updates: Partial<CampaignPlanAdGroup>) => {
    setCampaigns((prev) =>
      prev.map((campaign, idx) => {
        if (idx !== campaignIdx) return campaign;
        const adGroups = campaign.AdGroups ?? [];
        return {
          ...campaign,
          AdGroups: adGroups.map((group, gIdx) => (gIdx === adGroupIdx ? { ...group, ...updates } : group)),
        };
      }),
    );
  };

  const updateKeywordRow = (
    row: KeywordRow,
    updates: { keyword?: string; matchType?: string; negative?: boolean | null },
  ) => {
    setCampaigns((prev) =>
      prev.map((campaign, cIdx) => {
        if (cIdx !== row.campaignIdx) return campaign;
        const adGroups = campaign.AdGroups ?? [];
        return {
          ...campaign,
          AdGroups: adGroups.map((group, gIdx) => {
            if (gIdx !== row.adGroupIdx) return group;
            const targeting = { ...(group.Targeting ?? {}) };
            const keywords = keywordList(targeting, row.IsNegative);
            const otherKeywords = keywordList(targeting, !row.IsNegative);
            const current = keywords[row.index] ?? { Keyword: "", MatchType: "" };
            const keywordChanged =
              typeof updates.keyword === "string" &&
              updates.keyword.trim() !== "" &&
              updates.keyword.trim() !== current.Keyword;
            const updatedCurrent = {
              ...current,
              Keyword: updates.keyword ?? current.Keyword,
              MatchType: updates.matchType ?? current.MatchType,
              AvgMonthlySearches: keywordChanged ? null : current.AvgMonthlySearches ?? null,
              CPC: keywordChanged ? null : current.CPC ?? null,
              CompetitionIndex: keywordChanged ? null : current.CompetitionIndex ?? null,
            };

            if (typeof updates.negative === "boolean" && updates.negative !== row.IsNegative) {
              const remaining = keywords.filter((_, idx) => idx !== row.index);
              const destination = [...otherKeywords, updatedCurrent];
              if (updates.negative) {
                targeting.Keywords = remaining;
                targeting.NegativeKeywords = destination;
              } else {
                targeting.NegativeKeywords = remaining;
                targeting.Keywords = destination;
              }
            } else {
              const updated = keywords.map((kw, idx) => (idx === row.index ? updatedCurrent : kw));
              if (row.IsNegative) targeting.NegativeKeywords = updated;
              else targeting.Keywords = updated;
            }

            return { ...group, Targeting: targeting };
          }),
        };
      }),
    );
  };

  const saveChanges = async () => {
    if (!projectIdInput) {
      setStatusMessage("Provide a projectId to save changes.");
      return;
    }
    setIsSaving(true);
    setStatusMessage("Saving updates to 11-campaign-plan-enriched.json…");
    try {
      const res = await fetch("/api/sem/campaign-visualizer", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: projectIdInput, campaigns, fileName }),
      });
      const json = (await res.json()) as { error?: string; fileName?: string };
      if (!res.ok) {
        throw new Error(json.error || res.statusText);
      }
      setFileName(json.fileName ?? fileName ?? "11-campaign-plan-enriched.json");
      setStatusMessage(`Saved ${campaigns.length} campaign(s) to ${json.fileName ?? "11-campaign-plan-enriched.json"}.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to save";
      setStatusMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  const resetSelection = () => {
    setSelectedAdGroup(null);
  };

  const toggleSort = (current: SortState<string>, column: string): SortState<string> => {
    if (current.column === column) {
      return { column, direction: current.direction === "asc" ? "desc" : "asc" };
    }
    return { column, direction: "asc" };
  };

  const selectedAdGroupData =
    selectedAdGroup &&
    campaigns[selectedAdGroup.campaignIdx]?.AdGroups?.[selectedAdGroup.adGroupIdx] &&
    campaigns[selectedAdGroup.campaignIdx];

  const copyName = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedName(key);
      window.setTimeout(() => setCopiedName((current) => (current === key ? null : current)), 1200);
    } catch {
      setCopiedName(null);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-gray-600">Step 9</p>
            <h1 className="text-2xl font-semibold">Campaign Visualization & QA</h1>
            <p className="text-sm text-gray-600">
              Reads Step 10 JSON, creates an automatic backup, and lets you review & edit before Google Ads upload.
            </p>
          </div>
          <Link className="text-blue-600 underline text-sm" href="/sem">
            ← Back to SEM pipeline
          </Link>
        </header>

        <section className="bg-white border rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm flex items-center gap-2">
              <span className="text-gray-700">projectId</span>
              <input
                className="border rounded px-3 py-2 text-sm w-60"
                value={projectIdInput}
                onChange={(e) => setProjectIdInput(e.target.value)}
                placeholder="YYYYMMDD-HH-001"
              />
            </label>
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
              onClick={() => void loadPlan()}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Load JSON"}
            </button>
            <button
              className="border rounded px-4 py-2 disabled:opacity-50"
              onClick={saveChanges}
              disabled={isSaving || !campaigns.length}
            >
              {isSaving ? "Saving…" : "Save changes"}
            </button>
            <button
              className="border rounded px-4 py-2 disabled:opacity-50"
              onClick={() => void loadPlan(projectIdInput)}
              disabled={isLoading || !projectIdInput}
            >
              Reload from disk
            </button>
          </div>
          <div className="text-sm text-gray-700 flex flex-wrap gap-3">
            <span className="px-2 py-1 rounded bg-blue-50 text-blue-700">
              File: {fileName ?? "waiting for load"}
            </span>
            {backupFileName && (
              <span className="px-2 py-1 rounded bg-green-50 text-green-700">Backup: {backupFileName}</span>
            )}
            <span className="px-2 py-1 rounded bg-amber-50 text-amber-800">
              Tip: double click a cell in tables view to edit. Toggle Normal/Negative in Keyword table.
            </span>
          </div>
          {statusMessage && <div className="text-sm text-gray-800">{statusMessage}</div>}
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Views</span>
            <button
              type="button"
              className={`px-3 py-1 rounded border ${viewMode === "hierarchy" ? "bg-blue-600 text-white" : "bg-white"}`}
              onClick={() => setViewMode("hierarchy")}
            >
              Hierarchical (default)
            </button>
            <button
              type="button"
                      className={`px-3 py-1 rounded border ${viewMode === "tables" ? "bg-blue-600 text-white" : "bg-white"}`}
                      onClick={() => setViewMode("tables")}
                    >
                      Tables for QA & export
                    </button>
                  </div>
                </section>

        {viewMode === "hierarchy" && (
          <section className="bg-white border rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Campaign hierarchy</h2>
              <button className="text-sm text-blue-700 underline" onClick={resetSelection}>
                Clear ad group selection
              </button>
            </div>
            {campaigns.length === 0 && (
              <div className="text-sm text-gray-600">Load a project to view campaign cards.</div>
            )}
            <div className="grid md:grid-cols-[1.3fr_1fr] gap-4">
              <div className="space-y-3">
                {campaigns.map((campaign, campaignIdx) => {
                  const isOpen = expandedCampaigns[campaignIdx] ?? true;
                  return (
                    <details
                      key={campaignIdx}
                      open={isOpen}
                      className="border rounded-lg overflow-hidden bg-gray-50"
                      onToggle={(e) =>
                        setExpandedCampaigns((prev) => ({
                          ...prev,
                          [campaignIdx]: (e.target as HTMLDetailsElement).open,
                        }))
                      }
                    >
                      <summary className="cursor-pointer px-4 py-3 flex flex-wrap gap-3 items-center">
                        <div className="flex items-center gap-2 font-semibold">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white border text-xs">
                            {isOpen ? "−" : "+"}
                          </span>
                          <span>{campaign.CampaignName ?? `Campaign ${campaignIdx + 1}`}</span>
                          <button
                            type="button"
                            className={`ml-1 text-xs px-2 py-1 border rounded flex items-center gap-1 ${
                              copiedName === `campaign-${campaignIdx}` ? "bg-green-100 text-green-800 border-green-300" : ""
                            }`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void copyName(campaign.CampaignName ?? `Campaign ${campaignIdx + 1}`, `campaign-${campaignIdx}`);
                            }}
                            title="Copy campaign name"
                          >
                            {copiedName === `campaign-${campaignIdx}` ? (
                              <CheckIcon className="w-4 h-4" />
                            ) : (
                              <ClipboardIcon className="w-4 h-4" />
                            )}
                            <span>{copiedName === `campaign-${campaignIdx}` ? "Copied" : "Copy"}</span>
                          </button>
                        </div>
                        <div className="text-xs text-gray-700 flex gap-2 flex-wrap">
                          <span className="px-2 py-1 rounded bg-white border">Goal: {campaign.Goal || "—"}</span>
                          <span className="px-2 py-1 rounded bg-white border">
                            Type: {campaign.CampaignType || "—"}
                          </span>
                          <span className="px-2 py-1 rounded bg-white border">
                            Budget: {formatCurrency(campaign.BudgetDailyMYR)}
                          </span>
                          <span className="px-2 py-1 rounded bg-white border">
                            tCPA: {formatCurrency(campaign.TargetCPAMYR)}
                          </span>
                          <span className="px-2 py-1 rounded bg-white border">Lang: {campaign.Language || "—"}</span>
                          <span className="px-2 py-1 rounded bg-white border">
                            {campaign.Location?.Name || "No location"} • {campaign.Location?.RadiusKm ?? "—"} km
                          </span>
                        </div>
                      </summary>
                      <div className="px-4 pb-4 space-y-2">
                        <div className="text-sm text-gray-700">
                          {campaign.AdGroups?.length ?? 0} ad group(s) • Click to drill into Ads / Keywords / Negatives
                        </div>
                        <div className="grid md:grid-cols-2 gap-2">
                          {(campaign.AdGroups ?? []).map((group, adGroupIdx) => {
                            const targeting = group.Targeting;
                            const keywords = keywordList(targeting, false);
                            const negatives = keywordList(targeting, true);
                            const ads = Array.isArray(group.ResponsiveSearchAds) ? group.ResponsiveSearchAds : [];
                            return (
                              <button
                                key={adGroupIdx}
                                className={`border rounded-lg bg-white text-left p-3 hover:border-blue-400 ${
                                  selectedAdGroup?.campaignIdx === campaignIdx &&
                                  selectedAdGroup?.adGroupIdx === adGroupIdx
                                    ? "ring-2 ring-blue-400"
                                    : ""
                                }`}
                                onClick={() => setSelectedAdGroup({ campaignIdx, adGroupIdx })}
                              >
                                <div className="font-medium">{group.AdGroupName ?? `Ad Group ${adGroupIdx + 1}`}</div>
                                <div className="text-xs text-gray-600 flex flex-wrap gap-2 mt-1">
                                  <span className="px-2 py-1 rounded bg-blue-50 text-blue-800">
                                    CPC (MYR): {formatCpc(group.DefaultMaxCPCMYR)}
                                  </span>
                                  <span className="px-2 py-1 rounded bg-green-50 text-green-800">
                                    Ads: {ads.length}
                                  </span>
                                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-800">
                                    Keywords: {keywords.length}
                                  </span>
                                  <span className="px-2 py-1 rounded bg-amber-50 text-amber-800">
                                    Negatives: {negatives.length}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
              <div className="border rounded-lg bg-gray-50 p-4 h-full">
                <div className="flex flex-col gap-3 h-full">
                  {!selectedAdGroupData && (
                    <div className="text-sm text-gray-700">
                      Select an ad group on the left to see ads, keywords, and negatives here.
                    </div>
                  )}
                  {selectedAdGroupData ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3 justify-between">
                      <div>
                        <div className="text-xs text-gray-500">Ad Group detail</div>
                        <div className="flex items-center gap-2 font-semibold">
                          <span>
                            {selectedAdGroupData.AdGroups?.[selectedAdGroup!.adGroupIdx]?.AdGroupName ?? "Ad Group"}
                          </span>
                          <button
                            type="button"
                            className={`text-xs px-2 py-1 border rounded flex items-center gap-1 ${
                              copiedName === `adgroup-${selectedAdGroup!.campaignIdx}-${selectedAdGroup!.adGroupIdx}`
                                ? "bg-green-100 text-green-800 border-green-300"
                                : ""
                            }`}
                            onClick={() =>
                              void copyName(
                                selectedAdGroupData.AdGroups?.[selectedAdGroup!.adGroupIdx]?.AdGroupName ??
                                  "Ad Group",
                                `adgroup-${selectedAdGroup!.campaignIdx}-${selectedAdGroup!.adGroupIdx}`,
                              )
                            }
                            title="Copy ad group name"
                          >
                            {copiedName === `adgroup-${selectedAdGroup!.campaignIdx}-${selectedAdGroup!.adGroupIdx}` ? (
                              <CheckIcon className="w-4 h-4" />
                            ) : (
                              <ClipboardIcon className="w-4 h-4" />
                            )}
                            <span>
                              {copiedName === `adgroup-${selectedAdGroup!.campaignIdx}-${selectedAdGroup!.adGroupIdx}`
                                ? "Copied"
                                : "Copy"}
                            </span>
                          </button>
                        </div>
                        <div className="text-sm text-gray-600">
                          In campaign: {selectedAdGroupData.CampaignName} • CPC:{" "}
                          {formatCpc(
                            selectedAdGroupData.AdGroups?.[selectedAdGroup!.adGroupIdx]?.DefaultMaxCPCMYR ?? null,
                          )}
                        </div>
                      </div>
                      <button className="border rounded px-3 py-1 text-sm" onClick={resetSelection}>
                        Close
                      </button>
                    </div>
                    <AdGroupTabs
                      adGroup={selectedAdGroupData.AdGroups?.[selectedAdGroup!.adGroupIdx]}
                      targeting={selectedAdGroupData.AdGroups?.[selectedAdGroup!.adGroupIdx]?.Targeting}
                    />
                  </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        )}

        {viewMode === "tables" && (
          <section className="bg-white border rounded-lg p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold">QA tables & exports</h2>
              <div className="flex items-center gap-2 text-sm">
                <label className="flex items-center gap-1">
                  <span className="text-gray-700">Campaign filter</span>
                  <input
                    className="border rounded px-2 py-1"
                    value={filters.campaign}
                    onChange={(e) => setFilters((prev) => ({ ...prev, campaign: e.target.value }))}
                    placeholder="Search campaign"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-gray-700">Ad group filter</span>
                  <input
                    className="border rounded px-2 py-1"
                    value={filters.adGroup}
                    onChange={(e) => setFilters((prev) => ({ ...prev, adGroup: e.target.value }))}
                    placeholder="Search ad group"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-gray-700">Match</span>
                  <input
                    className="border rounded px-2 py-1 w-32"
                    value={filters.matchType}
                    onChange={(e) => setFilters((prev) => ({ ...prev, matchType: e.target.value }))}
                    placeholder="Exact/Phrase"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-gray-700">Negatives</span>
                  <select
                    className="border rounded px-2 py-1"
                    value={filters.negative}
                    onChange={(e) => setFilters((prev) => ({ ...prev, negative: e.target.value as typeof prev.negative }))}
                  >
                    <option value="all">All</option>
                    <option value="normal">Normal only</option>
                    <option value="negative">Negatives only</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-gray-700">CPC min</span>
                  <input
                    className="border rounded px-2 py-1 w-24"
                    value={filters.minCpc}
                    onChange={(e) => setFilters((prev) => ({ ...prev, minCpc: e.target.value }))}
                    placeholder="0"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-gray-700">CPC max</span>
                  <input
                    className="border rounded px-2 py-1 w-24"
                    value={filters.maxCpc}
                    onChange={(e) => setFilters((prev) => ({ ...prev, maxCpc: e.target.value }))}
                    placeholder="999"
                  />
                </label>
              </div>
            </div>
            {campaigns.length === 0 && (
              <div className="text-sm text-gray-600">
                Load a project with a 10/11 JSON first to see tables and exports.
              </div>
            )}

            <TableCard
              title="Campaign table"
              note="Edit campaign attributes inline."
              onExport={() =>
                downloadCsv(
                  filteredCampaigns.map(({ idx, ...rest }) => rest as Record<string, string | number | boolean | null>),
                  "campaigns.csv",
                )
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      {(
                        [
                          "CampaignName",
                          "Goal",
                          "CampaignType",
                          "BudgetDailyMYR",
                          "TargetCPAMYR",
                          "Language",
                          "LocationName",
                          "LocationRadiusKm",
                          "AdGroupsCount",
                        ] satisfies Array<keyof CampaignRow>
                      ).map((column) => (
                        <th key={column} className="border-b px-2 py-1 text-left">
                          <TableSortHeader
                            label={column}
                            column={column}
                            sort={campaignSort as SortState<string>}
                            onChange={(col) => setCampaignSort(toggleSort(campaignSort, col) as SortState<keyof CampaignRow>)}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCampaigns.map((row) => (
                      <tr key={row.idx} className="odd:bg-gray-50">
                        <td className="px-2 py-1">
                          <EditableCell
                            value={row.CampaignName}
                            onChange={(val) => updateCampaign(row.idx, { CampaignName: String(val ?? "") })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <EditableCell
                            value={row.Goal}
                            onChange={(val) => updateCampaign(row.idx, { Goal: String(val ?? "") })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <EditableCell
                            value={row.CampaignType}
                            onChange={(val) => updateCampaign(row.idx, { CampaignType: String(val ?? "") })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <EditableCell
                            value={row.BudgetDailyMYR}
                            type="number"
                            onChange={(val) => updateCampaign(row.idx, { BudgetDailyMYR: val as number | null })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <EditableCell
                            value={row.TargetCPAMYR}
                            type="number"
                            onChange={(val) => updateCampaign(row.idx, { TargetCPAMYR: val as number | null })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <EditableCell
                            value={row.Language}
                            onChange={(val) => updateCampaign(row.idx, { Language: String(val ?? "") })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <EditableCell
                            value={row.LocationName}
                            onChange={(val) => updateLocationField(row.idx, "Name", String(val ?? ""))}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <EditableCell
                            value={row.LocationRadiusKm}
                            type="number"
                            onChange={(val) => updateLocationField(row.idx, "RadiusKm", val as number | null)}
                          />
                        </td>
                        <td className="px-2 py-1 text-center">{row.AdGroupsCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableCard>

            <TableCard
              title="Ad Group table"
              note="Check CPCs, ads, and keyword coverage."
              onExport={() =>
                downloadCsv(
                  filteredAdGroups.map(({ campaignIdx, idx, ...rest }) => rest as Record<string, string | number | boolean | null>),
                  "ad-groups.csv",
                )
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      {([
                        { key: "CampaignName", label: "CampaignName" },
                        { key: "AdGroupName", label: "AdGroupName" },
                        { key: "DefaultMaxCPCMYR", label: "CPC (MYR)" },
                        { key: "KeywordsCount", label: "KeywordsCount" },
                        { key: "NegativeKeywordsCount", label: "NegativeKeywordsCount" },
                        { key: "ResponsiveSearchAdsCount", label: "ResponsiveSearchAdsCount" },
                      ] as const).map(({ key, label }) => (
                        <th key={key} className="border-b px-2 py-1 text-left">
                          <TableSortHeader
                            label={label}
                            column={key}
                            sort={adGroupSort as SortState<string>}
                            onChange={(col) => setAdGroupSort(toggleSort(adGroupSort, col) as SortState<keyof AdGroupRow>)}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAdGroups.map((row) => (
                      <tr key={`${row.campaignIdx}-${row.idx}`} className="odd:bg-gray-50">
                        <td className="px-2 py-1">{row.CampaignName}</td>
                        <td className="px-2 py-1">
                          <EditableCell
                            value={row.AdGroupName}
                            onChange={(val) => updateAdGroup(row.campaignIdx, row.idx, { AdGroupName: String(val ?? "") })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <EditableCell
                            value={row.DefaultMaxCPCMYR}
                            type="number"
                            onChange={(val) => updateAdGroup(row.campaignIdx, row.idx, { DefaultMaxCPCMYR: val as number | null })}
                          />
                        </td>
                        <td className="px-2 py-1 text-center">{row.KeywordsCount}</td>
                        <td className="px-2 py-1 text-center">{row.NegativeKeywordsCount}</td>
                        <td className="px-2 py-1 text-center">{row.ResponsiveSearchAdsCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableCard>

            <TableCard
              title="Keyword table"
              note="Toggle Normal/Negative, filter by campaign or match type, and export."
              onExport={() =>
                downloadCsv(
                  filteredKeywords.map(({ campaignIdx, adGroupIdx, index, adGroupCpc, ...rest }) => rest as Record<string, string | number | boolean | null>),
                  "keywords.csv",
                )
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      {([
                        { key: "CampaignName", label: "CampaignName" },
                        { key: "AdGroupName", label: "AdGroupName" },
                        { key: "Keyword", label: "Keyword" },
                        { key: "MatchType", label: "MatchType" },
                        { key: "IsNegative", label: "IsNegative" },
                        { key: "AvgMonthlySearches", label: "AvgMonthlySearches" },
                        { key: "CPC", label: "CPC (MYR)" },
                        { key: "CompetitionIndex", label: "CompetitionIndex" },
                        { key: "AdGroupCPC", label: "AdGroupCPC (MYR)" },
                      ] as const).map(({ key, label }) => (
                        <th key={key} className="border-b px-2 py-1 text-left">
                          <TableSortHeader
                            label={label}
                            column={key}
                            sort={keywordSort as SortState<string>}
                            onChange={(col) => setKeywordSort(toggleSort(keywordSort, col) as SortState<keyof KeywordRow>)}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredKeywords.map((row) => (
                      <tr key={`${row.campaignIdx}-${row.adGroupIdx}-${row.index}-${row.IsNegative}`} className="odd:bg-gray-50">
                <td className="px-2 py-1">{row.CampaignName}</td>
                <td className="px-2 py-1">{row.AdGroupName}</td>
                <td className="px-2 py-1">
                  <EditableCell
                            value={row.Keyword}
                            onChange={(val) => updateKeywordRow(row, { keyword: String(val ?? "") })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <EditableCell
                            value={row.MatchType}
                            onChange={(val) => updateKeywordRow(row, { matchType: String(val ?? "") })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <button
                            className={`px-2 py-1 rounded text-xs ${
                              row.IsNegative ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
                            }`}
                            onClick={() => updateKeywordRow(row, { negative: !row.IsNegative })}
                          >
                            {row.IsNegative ? "Negative" : "Normal"}
                          </button>
                        </td>
                        <td className="px-2 py-1">{formatNumber(row.AvgMonthlySearches)}</td>
                        <td className="px-2 py-1">{formatCpc(row.CPC)}</td>
                        <td className="px-2 py-1">{row.CompetitionIndex ?? "—"}</td>
                        <td className="px-2 py-1">{formatCpc(row.AdGroupCPC)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-blue-50 font-medium">
              <td className="px-2 py-2 text-right" colSpan={5}>
                Averages (visible)
              </td>
              <td className="px-2 py-2">{formatNumber(keywordAverages.avgMonthlySearches ?? null)}</td>
              <td className="px-2 py-2">{formatCurrency(keywordAverages.avgCpc ?? null)}</td>
              <td className="px-2 py-2">{formatDecimal(keywordAverages.avgCompetition ?? null)}</td>
              <td className="px-2 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    </TableCard>
  </section>
)}
      </div>
    </main>
  );
}

function TableCard({ title, children, note, onExport }: { title: string; children: ReactNode; note?: string; onExport?: () => void }) {
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">{title}</div>
          {note && <div className="text-xs text-gray-600">{note}</div>}
        </div>
        {onExport && (
          <button className="border rounded px-3 py-1 text-sm" onClick={onExport}>
            Export CSV
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function AdGroupTabs({
  adGroup,
  targeting,
}: {
  adGroup?: CampaignPlanAdGroup;
  targeting?: CampaignPlanAdGroup["Targeting"];
}) {
  const [tab, setTab] = useState<"ads" | "keywords" | "negatives">("ads");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [keywordText, setKeywordText] = useState<string>("");
  const [negativeText, setNegativeText] = useState<string>("");
  if (!adGroup) return null;
  const ads = Array.isArray(adGroup.ResponsiveSearchAds) ? adGroup.ResponsiveSearchAds : [];
  const keywords = keywordList(targeting, false);
  const negatives = keywordList(targeting, true);
  const keywordAverages = computeKeywordAverages(keywords);
  const negativeAverages = computeKeywordAverages(negatives);

  const markCopied = (key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1200);
  };

  useEffect(() => {
    const formatKw = (kw: CampaignPlanKeyword) => {
      const match = kw.MatchType?.toLowerCase() ?? "";
      if (match.includes("exact")) return `[${kw.Keyword}]`;
      if (match.includes("phrase")) return `"${kw.Keyword}"`;
      return kw.Keyword;
    };
    setKeywordText(keywords.map(formatKw).join(", "));
    setNegativeText(negatives.map(formatKw).join(", "));
  }, [keywords, negatives]);

  const copyAd = async (
    ad: NonNullable<CampaignPlanAdGroup["ResponsiveSearchAds"]>[number],
    index: number,
  ) => {
    const text = [
      `Responsive Search Ad ${index + 1}`,
      "",
      "Headlines:",
      ...ad.Headlines.map((h, idx) => `${idx + 1}. ${h}`),
      "",
      "Descriptions:",
      ...ad.Descriptions.map((d, idx) => `${idx + 1}. ${d}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      markCopied(`ad-${index}`);
    } catch {
      setCopiedKey(null);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore copy errors
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <button
          className={`px-3 py-1 rounded border ${tab === "ads" ? "bg-blue-600 text-white" : "bg-white"}`}
          onClick={() => setTab("ads")}
        >
          Ads ({ads.length})
        </button>
        <button
          className={`px-3 py-1 rounded border ${tab === "keywords" ? "bg-blue-600 text-white" : "bg-white"}`}
          onClick={() => setTab("keywords")}
        >
          Keywords ({keywords.length})
        </button>
        <button
          className={`px-3 py-1 rounded border ${tab === "negatives" ? "bg-blue-600 text-white" : "bg-white"}`}
          onClick={() => setTab("negatives")}
        >
          Negative Keywords ({negatives.length})
        </button>
      </div>

      {tab === "ads" && (
        <div className="space-y-3">
          {ads.map((ad, idx) => (
            <div key={idx} className="border rounded p-4 bg-gray-50 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-sm">Responsive Search Ad {idx + 1}</div>
                <button
                  type="button"
                  className={`flex items-center gap-1 text-xs px-2 py-1 border rounded transition ${
                    copiedKey === `ad-${idx}` ? "bg-green-100 text-green-800 border-green-300" : "hover:bg-white"
                  }`}
                  onClick={() => void copyAd(ad, idx)}
                  title="Copy headlines and descriptions"
                >
                  {copiedKey === `ad-${idx}` ? <CheckIcon className="w-4 h-4" /> : <ClipboardIcon className="w-4 h-4" />}
                  <span>{copiedKey === `ad-${idx}` ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Headlines</div>
                  <ol className="list-decimal list-inside text-sm space-y-2">
                  {ad.Headlines.map((headline, hIdx) => (
                      <li key={hIdx} className="flex items-start gap-2 py-1">
                        <span className="flex-1">{headline}</span>
                        <button
                          type="button"
                          className={`text-blue-700 hover:text-blue-900 px-1 rounded ${
                            copiedKey === `headline-${idx}-${hIdx}` ? "text-green-700" : ""
                          }`}
                          title="Copy headline"
                          onClick={() => {
                            void copyText(headline);
                            markCopied(`headline-${idx}-${hIdx}`);
                          }}
                        >
                          {copiedKey === `headline-${idx}-${hIdx}` ? (
                            <CheckIcon className="w-4 h-4" />
                          ) : (
                            <ClipboardIcon className="w-4 h-4" />
                          )}
                        </button>
                      </li>
                  ))}
                </ol>
              </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Descriptions</div>
                  <ol className="list-decimal list-inside text-sm space-y-2">
                  {ad.Descriptions.map((desc, dIdx) => (
                      <li key={dIdx} className="flex items-start gap-2 py-1">
                        <span className="flex-1">{desc}</span>
                        <button
                          type="button"
                          className={`text-blue-700 hover:text-blue-900 px-1 rounded ${
                            copiedKey === `desc-${idx}-${dIdx}` ? "text-green-700" : ""
                          }`}
                          title="Copy description"
                          onClick={() => {
                            void copyText(desc);
                            markCopied(`desc-${idx}-${dIdx}`);
                          }}
                        >
                          {copiedKey === `desc-${idx}-${dIdx}` ? (
                            <CheckIcon className="w-4 h-4" />
                          ) : (
                            <ClipboardIcon className="w-4 h-4" />
                          )}
                        </button>
                      </li>
                  ))}
                </ol>
              </div>
              </div>
            </div>
          ))}
          {ads.length === 0 && <div className="text-sm text-gray-600">No ads in this ad group.</div>}
        </div>
      )}

      {tab === "keywords" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="border-b px-2 py-1 text-left">Keyword</th>
                <th className="border-b px-2 py-1 text-left">MatchType</th>
                <th className="border-b px-2 py-1 text-left">Avg Monthly Searches</th>
                <th className="border-b px-2 py-1 text-left">CPC (MYR)</th>
                <th className="border-b px-2 py-1 text-left">Competition</th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((kw, idx) => (
                <tr key={idx} className="odd:bg-gray-50">
                  <td className="px-2 py-1">{kw.Keyword}</td>
                  <td className="px-2 py-1">{kw.MatchType}</td>
                  <td className="px-2 py-1">{formatNumber(kw.AvgMonthlySearches ?? null)}</td>
                  <td className="px-2 py-1">{formatCpc(kw.CPC ?? null)}</td>
                  <td className="px-2 py-1">{kw.CompetitionIndex ?? "—"}</td>
                </tr>
              ))}
              {keywords.length === 0 && (
                <tr>
                  <td className="px-2 py-1 text-sm text-gray-600" colSpan={5}>
                    No keywords available.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 font-medium">
              <td className="px-2 py-2 text-right" colSpan={2}>
                Averages
              </td>
              <td className="px-2 py-2">{formatNumber(keywordAverages.avgMonthlySearches ?? null)}</td>
              <td className="px-2 py-2">{formatCpc(keywordAverages.avgCpc ?? null)}</td>
              <td className="px-2 py-2">{formatDecimal(keywordAverages.avgCompetition ?? null)}</td>
            </tr>
          </tfoot>
          </table>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>All keywords (comma separated, formatted by match type)</span>
              <button
                type="button"
                className={`flex items-center gap-1 px-2 py-1 border rounded transition ${
                  copiedKey === "keywords" ? "bg-green-100 text-green-800 border-green-300" : ""
                }`}
                onClick={() => {
                  void copyText(keywordText);
                  markCopied("keywords");
                }}
              >
                {copiedKey === "keywords" ? <CheckIcon className="w-4 h-4" /> : <ClipboardIcon className="w-4 h-4" />}
                <span>{copiedKey === "keywords" ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={3}
              value={keywordText}
              onChange={(e) => setKeywordText(e.target.value)}
            />
          </div>
        </div>
      )}

      {tab === "negatives" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="border-b px-2 py-1 text-left">Keyword</th>
                <th className="border-b px-2 py-1 text-left">MatchType</th>
                <th className="border-b px-2 py-1 text-left">Avg Monthly Searches</th>
                <th className="border-b px-2 py-1 text-left">CPC (MYR)</th>
                <th className="border-b px-2 py-1 text-left">Competition</th>
              </tr>
            </thead>
            <tbody>
              {negatives.map((kw, idx) => (
                <tr key={idx} className="odd:bg-gray-50">
                  <td className="px-2 py-1">{kw.Keyword}</td>
                  <td className="px-2 py-1">{kw.MatchType}</td>
                  <td className="px-2 py-1">{formatNumber(kw.AvgMonthlySearches ?? null)}</td>
                  <td className="px-2 py-1">{formatCpc(kw.CPC ?? null)}</td>
                  <td className="px-2 py-1">{kw.CompetitionIndex ?? "—"}</td>
                </tr>
              ))}
              {negatives.length === 0 && (
                <tr>
                  <td className="px-2 py-1 text-sm text-gray-600" colSpan={5}>
                    No negatives available.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-blue-50 font-medium">
              <td className="px-2 py-2 text-right" colSpan={2}>
                Averages
              </td>
              <td className="px-2 py-2">{formatNumber(negativeAverages.avgMonthlySearches ?? null)}</td>
              <td className="px-2 py-2">{formatCpc(negativeAverages.avgCpc ?? null)}</td>
              <td className="px-2 py-2">{formatDecimal(negativeAverages.avgCompetition ?? null)}</td>
            </tr>
          </tfoot>
          </table>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>All negative keywords (comma separated, formatted by match type)</span>
              <button
                type="button"
                className={`flex items-center gap-1 px-2 py-1 border rounded transition ${
                  copiedKey === "negatives" ? "bg-green-100 text-green-800 border-green-300" : ""
                }`}
                onClick={() => {
                  void copyText(negativeText);
                  markCopied("negatives");
                }}
              >
                {copiedKey === "negatives" ? <CheckIcon className="w-4 h-4" /> : <ClipboardIcon className="w-4 h-4" />}
                <span>{copiedKey === "negatives" ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={3}
              value={negativeText}
              onChange={(e) => setNegativeText(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <rect x="6" y="6" width="12" height="14" rx="2" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
