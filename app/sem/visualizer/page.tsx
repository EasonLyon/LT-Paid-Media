'use client';

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CampaignPlan, CampaignPlanAdGroup, CampaignPlanKeyword, NormalizedProjectInitInput } from "@/types/sem";

type ViewMode = "hierarchy" | "tables" | "performance";
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

interface PerformanceCampaignRow {
  CampaignName: string;
  BudgetDailyMYR: number | null;
  monthlySpend: number;
  expectedAvgCpc: number;
  estimatedClicks: number;
  leadsWorst: number;
  leadsMid: number;
  leadsBest: number;
  revenueWorst: number;
  revenueMid: number;
  revenueBest: number;
  roiWorst: number;
  roiMid: number;
  roiBest: number;
}

interface PerformanceTotals {
  totalMonthlySpend: number;
  totalEstimatedClicks: number;
  totalLeadsWorst: number;
  totalLeadsMid: number;
  totalLeadsBest: number;
  totalRevenueWorst: number;
  totalRevenueMid: number;
  totalRevenueBest: number;
  roiWorst: number;
  roiMid: number;
  roiBest: number;
}

interface PerformanceAssumptions {
  averageCpc: number;
  worstConversionRate: number;
  bestConversionRate: number;
  conversionValue: number;
  daysPerMonth: number;
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
    // Sync the latest cell value into the local draft when external data changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

function formatCurrencyCompact(value: number | null): string {
  if (value === null || typeof value === "undefined" || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "MYR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
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

function formatPercent(value: number | null, fractionDigits = 1): string {
  if (value === null || typeof value === "undefined" || Number.isNaN(value)) return "—";
  return `${value.toFixed(fractionDigits)}%`;
}

const DEFAULT_AVG_CPC = 2.5;
const DEFAULT_WORST_CONV = 1;
const DEFAULT_BEST_CONV = 10;
const DEFAULT_CONVERSION_VALUE = 100;
const DEFAULT_DAYS_PER_MONTH = 30;

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

function CampaignVisualizerPageContent() {
  const searchParams = useSearchParams();
  const [projectIdInput, setProjectIdInput] = useState<string>("");
  const [campaigns, setCampaigns] = useState<CampaignPlan[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("performance");
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
  const [normalizedInput, setNormalizedInput] = useState<NormalizedProjectInitInput | null>(null);
  const [assumptions, setAssumptions] = useState<PerformanceAssumptions>({
    averageCpc: DEFAULT_AVG_CPC,
    worstConversionRate: DEFAULT_WORST_CONV,
    bestConversionRate: DEFAULT_BEST_CONV,
    conversionValue: DEFAULT_CONVERSION_VALUE,
    daysPerMonth: DEFAULT_DAYS_PER_MONTH,
  });
  const [performanceSort, setPerformanceSort] = useState<SortState<keyof PerformanceCampaignRow>>({
    column: "monthlySpend",
    direction: "desc",
  });
  const [monthlySpendOverride, setMonthlySpendOverride] = useState<number | null>(null);
  const monthlySpendSliderMin = 1000;
  const [mermaidSvg, setMermaidSvg] = useState<string>("");
  const [mermaidError, setMermaidError] = useState<string | null>(null);
  const mermaidRef = useRef<typeof import("mermaid").default | null>(null);
  const mermaidRenderId = useRef(0);
  const [salesValueAutoSet, setSalesValueAutoSet] = useState(false);
  const [monthlySpendInput, setMonthlySpendInput] = useState<string>("");
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);

  const sortedCampaignsByBudget = useMemo(
    () =>
      campaigns
        .map((campaign, idx) => ({ campaign, campaignIdx: idx }))
        .sort((a, b) => {
          const budgetA = a.campaign.BudgetDailyMYR ?? -Infinity;
          const budgetB = b.campaign.BudgetDailyMYR ?? -Infinity;
          if (budgetA === budgetB) {
            const nameA = a.campaign.CampaignName ?? `Campaign ${a.campaignIdx + 1}`;
            const nameB = b.campaign.CampaignName ?? `Campaign ${b.campaignIdx + 1}`;
            return nameA.localeCompare(nameB);
          }
          return budgetB - budgetA;
        }),
    [campaigns],
  );

  const updateAssumption = (key: keyof PerformanceAssumptions, rawValue: number) => {
    setAssumptions((prev) => {
      const value = Number.isFinite(rawValue) ? rawValue : (prev[key] as number);
      if (key === "worstConversionRate") {
        const clamped = Math.min(Math.max(0.1, value), 15);
        const bestAligned = Math.max(prev.bestConversionRate, clamped);
        return { ...prev, worstConversionRate: clamped, bestConversionRate: bestAligned };
      }
      if (key === "bestConversionRate") {
        const clamped = Math.min(Math.max(0.1, value), 15);
        return { ...prev, bestConversionRate: Math.max(clamped, prev.worstConversionRate) };
      }
      if (key === "daysPerMonth") {
        return { ...prev, daysPerMonth: Math.max(0, value) };
      }
      if (key === "averageCpc") {
        return { ...prev, averageCpc: Math.max(0.1, value) };
      }
      if (key === "conversionValue") {
        return { ...prev, conversionValue: Math.max(0, value) };
      }
      return { ...prev, [key]: value } as PerformanceAssumptions;
    });
  };

  useEffect(() => {
    const updateViewport = () => setIsMobileViewport(window.innerWidth < 640);
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

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

  const averageAdGroupCpc = useMemo(() => {
    const cpcs: number[] = [];
    campaigns.forEach((campaign) => {
      (campaign.AdGroups ?? []).forEach((group) => {
        const cpc = group.DefaultMaxCPCMYR;
        if (typeof cpc === "number" && Number.isFinite(cpc) && cpc > 0) {
          cpcs.push(cpc);
        }
      });
    });
    if (!cpcs.length) return null;
    const avg = cpcs.reduce((sum, val) => sum + val, 0) / cpcs.length;
    return Number.isFinite(avg) ? avg : null;
  }, [campaigns]);

  useEffect(() => {
    if (averageAdGroupCpc === null) return;
    setAssumptions((prev) => {
      if (prev.averageCpc !== DEFAULT_AVG_CPC) return prev;
      return { ...prev, averageCpc: averageAdGroupCpc };
    });
  }, [averageAdGroupCpc]);

  const baseMonthlySpendByCampaign = useMemo(() => {
    const days = Math.max(0, assumptions.daysPerMonth);
    return campaigns.map((campaign) => Math.max(0, (campaign.BudgetDailyMYR ?? 0) * days));
  }, [assumptions.daysPerMonth, campaigns]);

  const baseMonthlySpendTotal = useMemo(
    () => baseMonthlySpendByCampaign.reduce((sum, spend) => sum + spend, 0),
    [baseMonthlySpendByCampaign],
  );

  useEffect(() => {
    if (monthlySpendOverride !== null) return;
    const defaultSpend = Math.max(baseMonthlySpendTotal, monthlySpendSliderMin);
    if (defaultSpend > 0) setMonthlySpendOverride(defaultSpend);
  }, [baseMonthlySpendTotal, monthlySpendOverride]);

  const monthlySpendSliderMax = useMemo(() => {
    const base = Math.max(baseMonthlySpendTotal, monthlySpendSliderMin);
    return Math.round(base * 10);
  }, [baseMonthlySpendTotal, monthlySpendSliderMin]);

  useEffect(() => {
    setMonthlySpendOverride((prev) => {
      const next = prev ?? Math.max(baseMonthlySpendTotal, monthlySpendSliderMin);
      return Math.min(Math.max(monthlySpendSliderMin, next), monthlySpendSliderMax);
    });
    setMonthlySpendInput((prev) => {
      if (prev) return prev;
      const next = monthlySpendOverride ?? Math.max(baseMonthlySpendTotal, monthlySpendSliderMin);
      return next ? Math.round(next).toString() : "";
    });
  }, [baseMonthlySpendTotal, monthlySpendSliderMax, monthlySpendSliderMin]);

  const clampMonthlySpend = (value: number) =>
    Math.min(Math.max(monthlySpendSliderMin, value), monthlySpendSliderMax);

  const effectiveMonthlySpend = useMemo(
    () => (monthlySpendOverride === null ? Math.max(baseMonthlySpendTotal, monthlySpendSliderMin) : monthlySpendOverride),
    [baseMonthlySpendTotal, monthlySpendOverride, monthlySpendSliderMin],
  );

  useEffect(() => {
    setMonthlySpendInput(Math.round(effectiveMonthlySpend).toString());
  }, [effectiveMonthlySpend]);

  const monthlySpendSliderStep = 100;

  const performanceRows = useMemo<PerformanceCampaignRow[]>(() => {
    const worstRate = Math.max(0.001, assumptions.worstConversionRate) / 100;
    const bestRate = Math.max(worstRate, Math.max(0.001, assumptions.bestConversionRate) / 100);
    const midRate = (worstRate + bestRate) / 2;
    const expectedCpc = assumptions.averageCpc > 0 ? assumptions.averageCpc : DEFAULT_AVG_CPC;
    const conversionValue = Math.max(0, assumptions.conversionValue);
    const spendScale =
      baseMonthlySpendTotal > 0 && Number.isFinite(baseMonthlySpendTotal)
        ? effectiveMonthlySpend / baseMonthlySpendTotal
        : null;
    const evenSplit = campaigns.length > 0 ? effectiveMonthlySpend / campaigns.length : 0;

    return campaigns.map((campaign, idx) => {
      const baseSpend = baseMonthlySpendByCampaign[idx] ?? 0;
      const monthlySpend =
        spendScale !== null
          ? Math.max(0, Math.round(baseSpend * spendScale))
          : Math.max(0, Math.round(evenSplit));
      const estimatedClicks = expectedCpc > 0 ? Math.round(monthlySpend / expectedCpc) : 0;
      const leadsWorst = Math.round(estimatedClicks * worstRate);
      const leadsMid = Math.round(estimatedClicks * midRate);
      const leadsBest = Math.round(estimatedClicks * bestRate);
      const revenueWorst = Math.round(leadsWorst * conversionValue);
      const revenueMid = Math.round(leadsMid * conversionValue);
      const revenueBest = Math.round(leadsBest * conversionValue);
      const roiWorst = monthlySpend > 0 ? ((revenueWorst - monthlySpend) / monthlySpend) * 100 : 0;
      const roiMid = monthlySpend > 0 ? ((revenueMid - monthlySpend) / monthlySpend) * 100 : 0;
      const roiBest = monthlySpend > 0 ? ((revenueBest - monthlySpend) / monthlySpend) * 100 : 0;

      return {
        CampaignName: campaign.CampaignName ?? "Campaign",
        BudgetDailyMYR: campaign.BudgetDailyMYR ?? null,
        monthlySpend,
        expectedAvgCpc: expectedCpc,
        estimatedClicks,
        leadsWorst,
        leadsMid,
        leadsBest,
        revenueWorst,
        revenueMid,
        revenueBest,
        roiWorst,
        roiMid,
        roiBest,
      };
    });
  }, [assumptions, baseMonthlySpendByCampaign, baseMonthlySpendTotal, campaigns, effectiveMonthlySpend]);

  const performanceTotals = useMemo<PerformanceTotals>(() => {
    if (!performanceRows.length) {
      return {
        totalMonthlySpend: 0,
        totalEstimatedClicks: 0,
        totalLeadsWorst: 0,
        totalLeadsMid: 0,
        totalLeadsBest: 0,
        totalRevenueWorst: 0,
        totalRevenueMid: 0,
        totalRevenueBest: 0,
        roiWorst: 0,
        roiMid: 0,
        roiBest: 0,
      };
    }

    const totalMonthlySpend = performanceRows.reduce((sum, row) => sum + row.monthlySpend, 0);
    const totalEstimatedClicks = performanceRows.reduce((sum, row) => sum + row.estimatedClicks, 0);
    const totalLeadsWorst = performanceRows.reduce((sum, row) => sum + row.leadsWorst, 0);
    const totalLeadsMid = performanceRows.reduce((sum, row) => sum + row.leadsMid, 0);
    const totalLeadsBest = performanceRows.reduce((sum, row) => sum + row.leadsBest, 0);
    const totalRevenueWorst = performanceRows.reduce((sum, row) => sum + row.revenueWorst, 0);
    const totalRevenueMid = performanceRows.reduce((sum, row) => sum + row.revenueMid, 0);
    const totalRevenueBest = performanceRows.reduce((sum, row) => sum + row.revenueBest, 0);
    const roiWorst = totalMonthlySpend > 0 ? ((totalRevenueWorst - totalMonthlySpend) / totalMonthlySpend) * 100 : 0;
    const roiMid = totalMonthlySpend > 0 ? ((totalRevenueMid - totalMonthlySpend) / totalMonthlySpend) * 100 : 0;
    const roiBest = totalMonthlySpend > 0 ? ((totalRevenueBest - totalMonthlySpend) / totalMonthlySpend) * 100 : 0;

    return {
      totalMonthlySpend,
      totalEstimatedClicks,
      totalLeadsWorst,
      totalLeadsMid,
      totalLeadsBest,
      totalRevenueWorst,
      totalRevenueMid,
      totalRevenueBest,
      roiWorst,
      roiMid,
      roiBest,
    };
  }, [performanceRows]);

  const breakevenSalesValue = useMemo(() => {
    if (performanceTotals.totalLeadsWorst <= 0) return null;
    return performanceTotals.totalMonthlySpend / performanceTotals.totalLeadsWorst;
  }, [performanceTotals.totalLeadsWorst, performanceTotals.totalMonthlySpend]);

  useEffect(() => {
    if (salesValueAutoSet || breakevenSalesValue === null) return;
    setAssumptions((prev) => {
      if (prev.conversionValue !== DEFAULT_CONVERSION_VALUE) return prev;
      const suggested = Math.round((breakevenSalesValue * 1.2) / 10) * 10;
      const clamped = Math.min(1000, Math.max(10, suggested));
      return { ...prev, conversionValue: clamped };
    });
    setSalesValueAutoSet(true);
  }, [breakevenSalesValue, salesValueAutoSet]);

  const sortedPerformanceRows = useMemo(() => {
    const sorted = [...performanceRows].sort((a, b) => {
      const dir = performanceSort.direction === "asc" ? 1 : -1;
      const av = a[performanceSort.column];
      const bv = b[performanceSort.column];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return sorted;
  }, [performanceRows, performanceSort]);

  useEffect(() => {
    const renderDiagram = async () => {
      if (!performanceRows.length || performanceTotals.totalMonthlySpend <= 0) {
        setMermaidSvg("");
        return;
      }
      try {
        const node = (id: string, label: string) => `${id}["${label.replace(/"/g, "'")}"]`;
        if (!mermaidRef.current) {
          const { default: lib } = await import("mermaid");
          lib.initialize({ startOnLoad: false, theme: "base" });
          mermaidRef.current = lib;
        }
        const worstRateLabel = Math.abs(assumptions.worstConversionRate).toFixed(1);
        const bestRateLabel = Math.abs(assumptions.bestConversionRate).toFixed(1);
        const midRateLabel = Math.abs((assumptions.worstConversionRate + assumptions.bestConversionRate) / 2).toFixed(1);
        const spendLabel = formatCurrency(performanceTotals.totalMonthlySpend);
        const clicksLabel = formatNumber(Math.round(performanceTotals.totalEstimatedClicks));
        const worstLeadsLabel = formatNumber(Math.round(performanceTotals.totalLeadsWorst));
        const midLeadsLabel = formatNumber(Math.round(performanceTotals.totalLeadsMid));
        const bestLeadsLabel = formatNumber(Math.round(performanceTotals.totalLeadsBest));
        const worstRevenueLabel = formatCurrency(performanceTotals.totalRevenueWorst);
        const midRevenueLabel = formatCurrency(performanceTotals.totalRevenueMid);
        const bestRevenueLabel = formatCurrency(performanceTotals.totalRevenueBest);
        const roiWorstLabel = formatPercent(performanceTotals.roiWorst);
        const roiMidLabel = formatPercent(performanceTotals.roiMid);
        const roiBestLabel = formatPercent(performanceTotals.roiBest);
        const funnelDirection = isMobileViewport ? "TB" : "LR";

        const diagram = [
          `flowchart ${funnelDirection}`,
          node("spend", `Ad Spend: ${spendLabel}`),
          node("clicks", `Clicks: ${clicksLabel}`),
          node("worstLeads", `Worst leads (${worstRateLabel}%): ${worstLeadsLabel}`),
          node("midLeads", `Mid leads (${midRateLabel}%): ${midLeadsLabel}`),
          node("bestLeads", `Best leads (${bestRateLabel}%): ${bestLeadsLabel}`),
          node("worstRevenue", `Revenue worst: ${worstRevenueLabel}`),
          node("midRevenue", `Revenue mid: ${midRevenueLabel}`),
          node("bestRevenue", `Revenue best: ${bestRevenueLabel}`),
          node("worstRoi", `ROI worst: ${roiWorstLabel}`),
          node("midRoi", `ROI mid: ${roiMidLabel}`),
          node("bestRoi", `ROI best: ${roiBestLabel}`),
          "spend --> clicks",
          "clicks --> worstLeads",
          "clicks --> midLeads",
          "clicks --> bestLeads",
          "worstLeads --> worstRevenue",
          "midLeads --> midRevenue",
          "bestLeads --> bestRevenue",
          "worstRevenue --> worstRoi",
          "midRevenue --> midRoi",
          "bestRevenue --> bestRoi",
        ].join("\n");

        const renderId = `perf-${mermaidRenderId.current++}`;
        const { svg } = await mermaidRef.current.render(renderId, diagram);
        setMermaidSvg(svg);
        setMermaidError(null);
      } catch (err) {
        console.error("[PerformanceCalculator] Mermaid render failed", err);
        setMermaidError("Unable to render funnel diagram");
      }
    };

    void renderDiagram();
  }, [assumptions.bestConversionRate, assumptions.worstConversionRate, isMobileViewport, performanceRows, performanceTotals]);

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
        normalizedInput?: NormalizedProjectInitInput | null;
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
      setNormalizedInput(json.normalizedInput ?? null);
      setWebsiteUrl(json.normalizedInput?.website ?? null);
      setSalesValueAutoSet(false);
      setMonthlySpendOverride(null);
      setStatusMessage(
        `Loaded ${json.campaigns?.length ?? 0} campaign(s) from ${json.fileName ?? "10/11-*.json"}. Backup: ${
          json.backupFileName ?? "n/a"
        }`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to load plan";
      setStatusMessage(message);
      setCampaigns([]);
      setNormalizedInput(null);
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
    <main className="min-h-screen bg-gray-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-gray-600">Step 9</p>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Campaign Visualization & QA</h1>
            <p className="text-sm text-gray-600">
              Reads Step 10 JSON, creates an automatic backup, and lets you review & edit before Google Ads upload.
            </p>
          </div>
          <Link className="text-blue-600 underline text-sm dark:text-blue-300" href="/sem">
            ← Back to SEM pipeline
          </Link>
        </header>

        {websiteUrl && (
          <div className="bg-white border rounded-lg p-3 flex items-center justify-between dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500 uppercase font-medium">Website Context</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{websiteUrl}</span>
            </div>
            <a
              href={websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors"
            >
              Visit Website ↗
            </a>
          </div>
        )}

        <section className="bg-white border rounded-lg p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm flex items-center gap-2">
              <span className="text-gray-700 dark:text-slate-200">projectId</span>
              <input
                className="border rounded px-3 py-2 text-sm w-60 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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
              className="border rounded px-4 py-2 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onClick={saveChanges}
              disabled={isSaving || !campaigns.length}
            >
              {isSaving ? "Saving…" : "Save changes"}
            </button>
            <button
              className="border rounded px-4 py-2 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onClick={() => void loadPlan(projectIdInput)}
              disabled={isLoading || !projectIdInput}
            >
              Reload from disk
            </button>
          </div>
          <div className="text-sm text-gray-700 flex flex-wrap gap-3 dark:text-slate-200">
            <span className="px-2 py-1 rounded bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-100">
              File: {fileName ?? "waiting for load"}
            </span>
            {backupFileName && (
              <span className="px-2 py-1 rounded bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-200">
                Backup: {backupFileName}
              </span>
            )}
            <span className="px-2 py-1 rounded bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
              Tip: double click a cell in tables view to edit. Toggle Normal/Negative in Keyword table.
            </span>
          </div>
          {statusMessage && <div className="text-sm text-gray-800 dark:text-slate-200">{statusMessage}</div>}
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Views</span>
            <button
              type="button"
              className={`px-3 py-1 rounded border ${
                viewMode === "performance" ? "bg-blue-600 text-white" : "bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              }`}
              onClick={() => setViewMode("performance")}
            >
              Performance calculator (default)
            </button>
            <button
              type="button"
              className={`px-3 py-1 rounded border ${
                viewMode === "hierarchy" ? "bg-blue-600 text-white" : "bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              }`}
              onClick={() => setViewMode("hierarchy")}
            >
              Hierarchical view
            </button>
            <button
              type="button"
              className={`px-3 py-1 rounded border ${
                viewMode === "tables" ? "bg-blue-600 text-white" : "bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              }`}
              onClick={() => setViewMode("tables")}
            >
              Tables for QA & export
            </button>
          </div>
        </section>

        {viewMode === "performance" && (
          <section className="bg-white border rounded-lg p-4 space-y-5 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Performance calculator</h2>
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  Forecast clicks, leads, revenue, and ROI using 00-user-input and 10/11 campaign plan budgets.
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 text-sm">
                <span className="px-2 py-1 rounded bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-100">
                  Step 1 budget: {normalizedInput ? formatCurrency(normalizedInput.monthly_adspend_myr) : "—"}
                </span>
                <span className="px-2 py-1 rounded bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-100">
                  Campaign spend ×{assumptions.daysPerMonth}d: {formatCurrency(performanceTotals.totalMonthlySpend)}
                </span>
              </div>
            </div>
            {!campaigns.length ? (
              <div className="text-sm text-gray-600 dark:text-slate-300">
                Load a project to pull budgets from 00/11 JSON before using the calculator.
              </div>
            ) : (
              <>
                <div className="border rounded-lg bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="text-sm font-semibold" title="Ad spend flowing into clicks, leads, revenue, and ROI">
                      Performance funnel
                    </div>
                    {mermaidError && (
                      <span className="text-xs text-red-700 bg-red-50 px-2 py-1 rounded border border-red-200">
                        {mermaidError}
                      </span>
                    )}
                  </div>
                  {mermaidSvg ? (
                    <div className="overflow-auto min-h-[260px]" dangerouslySetInnerHTML={{ __html: mermaidSvg }} />
                  ) : (
                    <div className="text-sm text-gray-700">Load budgets or adjust sliders to see the funnel.</div>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <label className="border rounded-lg p-3 bg-gray-50 space-y-2">
                    <div className="flex items-center justify-between text-sm font-medium" title="Model different total budgets to see how traffic, leads, and revenue scale. Defaults to your campaign budgets.">
                      <span>Monthly ad spend (MYR)</span>
                      <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-50 text-blue-800">
                        {formatCurrency(Math.round(effectiveMonthlySpend))}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={monthlySpendSliderMin}
                      max={monthlySpendSliderMax}
                      step={monthlySpendSliderStep}
                      className="w-full accent-blue-600"
                      value={effectiveMonthlySpend}
                      onChange={(e) => {
                        const next = clampMonthlySpend(Number(e.target.value));
                        setMonthlySpendOverride(next);
                        setMonthlySpendInput(Math.round(next).toString());
                      }}
                    />
                    <input
                      type="number"
                      min={monthlySpendSliderMin}
                      max={monthlySpendSliderMax}
                      step={monthlySpendSliderStep}
                      className="border rounded px-2 py-1 text-sm w-full"
                      value={monthlySpendInput}
                      onChange={(e) => setMonthlySpendInput(e.target.value)}
                      onBlur={() => {
                        const parsed = Number(monthlySpendInput);
                        if (!Number.isFinite(parsed)) {
                          setMonthlySpendInput(Math.round(effectiveMonthlySpend).toString());
                          return;
                        }
                        const next = clampMonthlySpend(parsed);
                        setMonthlySpendOverride(next);
                        setMonthlySpendInput(Math.round(next).toString());
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const parsed = Number(monthlySpendInput);
                          if (!Number.isFinite(parsed)) return;
                          const next = clampMonthlySpend(parsed);
                          setMonthlySpendOverride(next);
                          setMonthlySpendInput(Math.round(next).toString());
                        }
                      }}
                      title="Type to set monthly ad spend directly"
                    />
                    <div className="flex items-center justify-between text-xs text-gray-600">
                      <span>Min {formatCurrency(monthlySpendSliderMin)}</span>
                      <span>Max {formatCurrency(monthlySpendSliderMax)}</span>
                    </div>
                  </label>

                  <label className="border rounded-lg p-3 bg-gray-50 space-y-2">
                    <div className="flex items-center justify-between text-sm font-medium" title="Global average CPC applied to all campaigns. Slide to test cheaper or more expensive clicks.">
                      <span>Global avg CPC (MYR)</span>
                      <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-50 text-blue-800">
                        RM {assumptions.averageCpc.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={10}
                      step={0.1}
                      className="w-full accent-blue-600"
                      value={assumptions.averageCpc}
                      onChange={(e) => updateAssumption("averageCpc", Number(e.target.value))}
                    />
                    <div className="text-xs text-gray-600">
                      Defaults to ad group avg{averageAdGroupCpc ? ` (RM ${averageAdGroupCpc.toFixed(2)})` : ""}.
                    </div>
                  </label>

                  <label className="border rounded-lg p-3 bg-gray-50 space-y-2">
                    <div className="flex items-center justify-between text-sm font-medium" title="Set worst and best conversion rates to bound expected performance.">
                      <span>Conv. Rate (%)</span>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-amber-50 text-amber-800 font-semibold">
                          {assumptions.worstConversionRate.toFixed(1)}%
                        </span>
                        <span className="px-2 py-1 rounded bg-green-50 text-green-800 font-semibold">
                          {assumptions.bestConversionRate.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="relative pt-2 pb-3">
                      <div className="h-2 bg-gray-200 rounded-full relative overflow-hidden">
                        <div
                          className="absolute top-0 h-full rounded-full bg-gradient-to-r from-amber-300 via-blue-300 to-green-300"
                          style={{
                            left: `${((assumptions.worstConversionRate - 0.1) / (15 - 0.1)) * 100}%`,
                            right: `${100 - ((assumptions.bestConversionRate - 0.1) / (15 - 0.1)) * 100}%`,
                          }}
                        />
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={15}
                        step={0.1}
                        className="w-full accent-amber-600 relative z-10 dual-range"
                        value={assumptions.worstConversionRate}
                        onChange={(e) => updateAssumption("worstConversionRate", Number(e.target.value))}
                      />
                      <input
                        type="range"
                        min={0.1}
                        max={15}
                        step={0.1}
                        className="w-full accent-green-600 absolute inset-0 dual-range"
                        value={assumptions.bestConversionRate}
                        onChange={(e) => updateAssumption("bestConversionRate", Number(e.target.value))}
                      />
                      <div className="flex justify-between text-xs text-gray-600 mt-2">
                        <span className="px-2 py-1 rounded bg-amber-50 text-amber-800">Worst</span>
                        <span className="px-2 py-1 rounded bg-green-50 text-green-800">Best</span>
                      </div>
                    </div>
                  </label>

                  <label className="border rounded-lg p-3 bg-gray-50 space-y-2">
                    <div className="flex items-center justify-between text-sm font-medium" title="Adjust value per lead (Sales Value) and set the number of active days.">
                      <span>Sales Value (MYR)</span>
                      <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-50 text-blue-800">
                        RM {assumptions.conversionValue.toFixed(0)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={1000}
                      step={10}
                      className="w-full accent-blue-600"
                      value={assumptions.conversionValue}
                      onChange={(e) => updateAssumption("conversionValue", Number(e.target.value))}
                    />
                    <div className="text-xs text-gray-600">
                      Breakeven @ worst-case ROI: {breakevenSalesValue ? formatCurrency(Math.round(breakevenSalesValue)) : "n/a"}
                    </div>
                  </label>

                  <label className="border rounded-lg p-3 bg-gray-50 space-y-2">
                    <div className="flex items-center justify-between text-sm font-medium" title="Number of active days the campaigns run this month.">
                      <span>Days/month</span>
                    </div>
                    <select
                      className="border rounded px-2 py-1 text-sm w-full"
                      value={assumptions.daysPerMonth}
                      onChange={(e) => {
                        updateAssumption("daysPerMonth", Number(e.target.value));
                        setMonthlySpendOverride(null);
                      }}
                    >
                      {[28, 30, 31].map((day) => (
                        <option key={day} value={day}>
                          {day} days
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="border rounded-lg p-3 bg-gray-50">
                    <div className="text-xs uppercase text-gray-600" title="Sum of campaign budgets scaled by the monthly spend slider">
                      Total monthly ad spend
                    </div>
                    <div className="text-2xl font-semibold">{formatCurrency(performanceTotals.totalMonthlySpend)}</div>
                  </div>
                  <div className="border rounded-lg p-3 bg-gray-50">
                    <div className="text-xs uppercase text-gray-600" title="Traffic generated from the monthly spend and global CPC">
                      Estimated clicks / month
                    </div>
                    <div className="text-2xl font-semibold">{formatNumber(Math.round(performanceTotals.totalEstimatedClicks))}</div>
                  </div>
                  <div className="border rounded-lg p-3 bg-gray-50">
                    <div className="text-xs uppercase text-gray-600" title="Leads using worst to best conversion rate assumptions">
                      Estimated leads / month
                    </div>
                    <div className="text-2xl font-semibold">
                      {formatNumber(Math.round(performanceTotals.totalLeadsWorst))} –{" "}
                      {formatNumber(Math.round(performanceTotals.totalLeadsBest))}
                    </div>
                  </div>

                  <div className="md:col-span-3 border rounded-lg p-4 bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-800 text-white shadow">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm uppercase text-indigo-100" title="Revenue from lead volume × Sales Value">
                          Estimated revenue / month
                        </div>
                        <div className="text-4xl font-extrabold tracking-tight">
                          {formatCurrencyCompact(performanceTotals.totalRevenueWorst)} – {formatCurrencyCompact(performanceTotals.totalRevenueBest)}
                        </div>
                        <div className="text-xs text-indigo-100/80 mt-1">
                          Sales value RM {assumptions.conversionValue.toFixed(0)} · Break-even @ worst: {breakevenSalesValue ? formatCurrency(Math.round(breakevenSalesValue)) : "n/a"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs uppercase text-indigo-100">Earnings outlook</div>
                        <div className="text-5xl font-black">ROI</div>
                        <div className="text-sm text-indigo-100/80">Spend → Revenue</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 w-full">
                      {[{
                        label: "Worst",
                        value: performanceTotals.roiWorst,
                        revenue: performanceTotals.totalRevenueWorst,
                        align: "text-left",
                      }, {
                        label: "Mid",
                        value: performanceTotals.roiMid,
                        revenue: performanceTotals.totalRevenueMid,
                        align: "text-center",
                      }, {
                        label: "Best",
                        value: performanceTotals.roiBest,
                        revenue: performanceTotals.totalRevenueBest,
                        align: "text-right",
                      }].map((item) => {
                        const positive = item.value >= 0;
                        const mid = item.label === "Mid";
                        const bg = positive ? "bg-green-100 text-green-900" : mid ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-900";
                        return (
                          <div
                            key={item.label}
                            className={`rounded-lg p-3 ${bg} bg-opacity-80 flex flex-col gap-2 ${item.align}`}
                          >
                            <div className="text-xs uppercase tracking-wide">{item.label} case</div>
                            <div className="text-3xl font-extrabold">{formatCurrencyCompact(item.revenue)}</div>
                            <div className="text-sm font-semibold text-black/70">
                              ROI {formatPercent(item.value)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold">Campaign breakdown</h3>
                    <div className="text-sm text-gray-600">
                      Sort by any column to see which campaigns drive the most traffic or revenue.
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr>
                          {(
                            [
                              { column: "CampaignName", label: "Campaign" },
                              { column: "monthlySpend", label: "Monthly spend (MYR)" },
                              { column: "estimatedClicks", label: "Estimated clicks" },
                              { column: "leadsWorst", label: "Leads (worst)" },
                              { column: "leadsBest", label: "Leads (best)" },
                              { column: "revenueWorst", label: "Revenue (worst)" },
                              { column: "revenueBest", label: "Revenue (best)" },
                              { column: "roiWorst", label: "ROI (worst)" },
                              { column: "roiBest", label: "ROI (best)" },
                            ] satisfies Array<{ column: keyof PerformanceCampaignRow; label: string }>
                          ).map(({ column, label }) => (
                            <th key={column} className="border-b px-2 py-2 text-left whitespace-nowrap">
                              <TableSortHeader
                                label={label}
                                column={column}
                                sort={performanceSort as SortState<string>}
                                onChange={(col) =>
                                  setPerformanceSort(
                                    toggleSort(performanceSort, col) as SortState<keyof PerformanceCampaignRow>,
                                  )
                                }
                              />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedPerformanceRows.map((row) => (
                          <tr key={row.CampaignName} className="odd:bg-gray-50">
                            <td className="px-2 py-2">{row.CampaignName}</td>
                            <td className="px-2 py-2">{formatCurrency(row.monthlySpend)}</td>
                            <td className="px-2 py-2">{formatDecimal(Math.round(row.estimatedClicks), 0)}</td>
                            <td className="px-2 py-2">{formatDecimal(Math.round(row.leadsWorst), 0)}</td>
                            <td className="px-2 py-2">{formatDecimal(Math.round(row.leadsBest), 0)}</td>
                            <td className="px-2 py-2">{formatCurrencyCompact(row.revenueWorst)}</td>
                            <td className="px-2 py-2">{formatCurrencyCompact(row.revenueBest)}</td>
                            <td className="px-2 py-2">{formatPercent(row.roiWorst)}</td>
                            <td className="px-2 py-2">{formatPercent(row.roiBest)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            <style jsx global>{`
              .dual-range {
                pointer-events: none;
              }
              .dual-range::-webkit-slider-thumb {
                pointer-events: auto;
              }
              .dual-range::-moz-range-thumb {
                pointer-events: auto;
              }
            `}</style>
          </section>
        )}

        {viewMode === "hierarchy" && (
          <section className="bg-white border rounded-lg p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Campaign hierarchy</h2>
              <button className="text-sm text-blue-700 underline dark:text-blue-300" onClick={resetSelection}>
                Clear ad group selection
              </button>
            </div>
            {campaigns.length === 0 && (
              <div className="text-sm text-gray-600 dark:text-slate-300">Load a project to view campaign cards.</div>
            )}
            <div className="grid md:grid-cols-[1.3fr_1fr] gap-4">
              <div className="space-y-3">
                {sortedCampaignsByBudget.map(({ campaign, campaignIdx }) => {
                  const isOpen = expandedCampaigns[campaignIdx] ?? true;
                  return (
                    <details
                      key={campaignIdx}
                      open={isOpen}
                      className="border rounded-lg overflow-hidden bg-gray-50 dark:border-slate-700 dark:bg-slate-800"
                      onToggle={(e) =>
                        setExpandedCampaigns((prev) => ({
                          ...prev,
                          [campaignIdx]: (e.target as HTMLDetailsElement).open,
                        }))
                      }
                    >
                      <summary className="cursor-pointer px-4 py-3 flex flex-wrap gap-3 items-center">
                        <div className="flex items-center gap-2 font-semibold">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white border text-xs dark:border-slate-600 dark:bg-slate-800">
                            {isOpen ? "−" : "+"}
                          </span>
                          <span>{campaign.CampaignName ?? `Campaign ${campaignIdx + 1}`}</span>
                          <button
                            type="button"
                            className={`ml-1 text-xs px-2 py-1 border rounded flex items-center gap-1 ${
                              copiedName === `campaign-${campaignIdx}`
                                ? "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-200 dark:border-green-700"
                                : "dark:border-slate-600 dark:text-slate-100"
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
                        <div className="text-xs text-gray-700 flex gap-2 flex-wrap dark:text-slate-200">
                          <span className="px-2 py-1 rounded bg-white border dark:border-slate-600 dark:bg-slate-800">Goal: {campaign.Goal || "—"}</span>
                          <span className="px-2 py-1 rounded bg-white border dark:border-slate-600 dark:bg-slate-800">
                            Type: {campaign.CampaignType || "—"}
                          </span>
                          <span className="px-2 py-1 rounded bg-white border dark:border-slate-600 dark:bg-slate-800">
                            Budget: {formatCurrency(campaign.BudgetDailyMYR)}
                          </span>
                          <span className="px-2 py-1 rounded bg-white border dark:border-slate-600 dark:bg-slate-800">
                            tCPA: {formatCurrency(campaign.TargetCPAMYR)}
                          </span>
                          <span className="px-2 py-1 rounded bg-white border dark:border-slate-600 dark:bg-slate-800">Lang: {campaign.Language || "—"}</span>
                          <span className="px-2 py-1 rounded bg-white border dark:border-slate-600 dark:bg-slate-800">
                            {campaign.Location?.Name || "No location"} • {campaign.Location?.RadiusKm ?? "—"} km
                          </span>
                        </div>
                      </summary>
                      <div className="px-4 pb-4 space-y-2">
                        <div className="text-sm text-gray-700 dark:text-slate-200">
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
                                } dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-blue-500`}
                                onClick={() => setSelectedAdGroup({ campaignIdx, adGroupIdx })}
                              >
                                <div className="font-medium">{group.AdGroupName ?? `Ad Group ${adGroupIdx + 1}`}</div>
                                <div className="text-xs text-gray-600 flex flex-wrap gap-2 mt-1 dark:text-slate-300">
                                  <span className="px-2 py-1 rounded bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-100">
                                    CPC (MYR): {formatCpc(group.DefaultMaxCPCMYR)}
                                  </span>
                                  <span className="px-2 py-1 rounded bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200">
                                    Ads: {ads.length}
                                  </span>
                                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-100">
                                    Keywords: {keywords.length}
                                  </span>
                                  <span className="px-2 py-1 rounded bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
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
          <section className="bg-white border rounded-lg p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">QA tables & exports</h2>
              <div className="flex items-center gap-2 text-sm">
                <label className="flex items-center gap-1">
                  <span className="text-gray-700 dark:text-slate-200">Campaign filter</span>
                  <input
                    className="border rounded px-2 py-1 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    value={filters.campaign}
                    onChange={(e) => setFilters((prev) => ({ ...prev, campaign: e.target.value }))}
                    placeholder="Search campaign"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-gray-700 dark:text-slate-200">Ad group filter</span>
                  <input
                    className="border rounded px-2 py-1 bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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
                  filteredCampaigns.map(({ idx, ...rest }) => {
                    void idx;
                    return rest as Record<string, string | number | boolean | null>;
                  }),
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
                  filteredAdGroups.map(({ campaignIdx, idx, ...rest }) => {
                    void campaignIdx;
                    void idx;
                    return rest as Record<string, string | number | boolean | null>;
                  }),
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
                  filteredKeywords.map(({ campaignIdx, adGroupIdx, index, adGroupCpc, ...rest }) => {
                    void campaignIdx;
                    void adGroupIdx;
                    void index;
                    void adGroupCpc;
                    return rest as Record<string, string | number | boolean | null>;
                  }),
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
  const ads = Array.isArray(adGroup?.ResponsiveSearchAds) ? adGroup.ResponsiveSearchAds ?? [] : [];
  const keywords = keywordList(targeting, false);
  const negatives = keywordList(targeting, true);
  const keywordAverages = computeKeywordAverages(keywords);
  const negativeAverages = computeKeywordAverages(negatives);

  const markCopied = (key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1200);
  };

  /* eslint-disable react-hooks/set-state-in-effect */
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
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!adGroup) {
    return <div className="text-sm text-gray-600">Select an ad group to view ads and keywords.</div>;
  }

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

export default function CampaignVisualizerPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading visualizer...</div>}>
      <CampaignVisualizerPageContent />
    </Suspense>
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
