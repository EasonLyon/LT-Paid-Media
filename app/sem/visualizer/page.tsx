'use client';

import Link from "next/link";
import { Workbook, type Row } from "exceljs";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CampaignPlan, CampaignPlanAdGroup, CampaignPlanKeyword, NormalizedProjectInitInput, OptimizationPlaybook } from "@/types/sem";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ViewMode = "breakdown" | "tables" | "performance" | "playbook";
type SortDirection = "asc" | "desc";
const CAMPAIGN_DAYS_PER_MONTH = 30;
const VIEW_ORDER: ViewMode[] = ["performance", "breakdown", "tables", "playbook"];
const copyButtonClass =
  "text-xs px-2 py-1 border border-default rounded flex items-center gap-1 transition shadow-sm hover:bg-slate-300 hover:shadow-md hover:-translate-y-0.5 dark:hover:bg-slate-600";

interface CampaignTableRow {
  platform: string;
  funnel: string;
  entity: string;
  campaignName: string;
  campaignType: string;
  objective: string;
  keywordsAudience: string;
  monthlyBudgetMYR: number | null;
  landingPageUrl: string;
}

interface AdGroupTableRow {
  campaignName: string;
  name: string;
  text: string;
  character: number | null;
  type: "Headline" | "Description" | "Keyword";
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

interface AdTextRemoval {
  campaignName: string;
  adGroupName: string;
  adIndex: number;
  textType: "headline" | "description";
  originalText: string;
  originalLength: number;
  limit: number;
  reason: string;
}

interface SortState<T extends string> {
  column: T;
  direction: SortDirection;
}

interface ExistingProjectSummary {
  id: string;
  fileCount: number;
  createdMs: number;
  websiteDomain?: string;
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
        className="w-full rounded border border-default bg-surface px-2 py-1 text-sm text-body"
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
      className="w-full min-h-[32px] rounded px-2 py-1 hover:bg-slate-100/70 dark:hover:bg-slate-800/70 cursor-text"
      onDoubleClick={() => setIsEditing(true)}
      title="Double click to edit"
    >
      {value === null || typeof value === "undefined" || value === "" ? (
        <span className="text-muted">{placeholder ?? "—"}</span>
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
      <span className="text-xs text-muted">{arrow}</span>
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

function computeMonthlyBudget(daily: number | null): number | null {
  if (daily === null || typeof daily === "undefined" || Number.isNaN(daily)) return null;
  return daily * CAMPAIGN_DAYS_PER_MONTH;
}

function formatPercent(value: number | null, fractionDigits = 1): string {
  if (value === null || typeof value === "undefined" || Number.isNaN(value)) return "—";
  return `${value.toFixed(fractionDigits)}%`;
}

function formatProjectTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "Unknown";
  return new Date(ms).toLocaleString();
}

const DEFAULT_AVG_CPC = 2.5;
const DEFAULT_WORST_CONV = 1;
const DEFAULT_BEST_CONV = 10;
const DEFAULT_CONVERSION_VALUE = 100;
const DEFAULT_DAYS_PER_MONTH = 30;

const CAMPAIGN_TABLE_COLUMNS = [
  { key: "platform", label: "Platform" },
  { key: "funnel", label: "Funnel" },
  { key: "entity", label: "Entity" },
  { key: "campaignName", label: "Campaign Name" },
  { key: "campaignType", label: "Campaign Type" },
  { key: "objective", label: "Objective" },
  { key: "keywordsAudience", label: "Keywords / Audience" },
  { key: "monthlyBudgetMYR", label: "Monthly Budget (RM)" },
  { key: "landingPageUrl", label: "Landing Page URL" },
] as const;

const AD_GROUP_TABLE_COLUMNS = [
  { key: "campaignName", label: "Campaign Name" },
  { key: "name", label: "Name" },
  { key: "text", label: "Text" },
  { key: "character", label: "Character" },
  { key: "type", label: "Type" },
] as const;

const EXPORT_ALL_HEADERS = [
  "Table",
  "Platform",
  "Funnel",
  "Entity",
  "Campaign Name",
  "Campaign Type",
  "Objective",
  "Keywords / Audience",
  "Monthly Budget (RM)",
  "Landing Page URL",
  "Name",
  "Text",
  "Character",
  "Type",
] as const;

function extractKeywordsAudience(name: string): string {
  if (!name) return "";
  const parts = name.split("|").map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : name;
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

function downloadCsv(
  rows: Array<Record<string, string | number | boolean | null>>,
  filename: string,
  headersOverride?: string[],
) {
  const headers = headersOverride ?? Object.keys(rows[0] ?? {});
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

function buildExportFilename(prefix: string, base: string) {
  const safePrefix = prefix.trim().replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  const finalPrefix = safePrefix || "project";
  return `${finalPrefix}-${base}`;
}

type ExportRow = Record<string, string | number | boolean | null>;
type ExportSheet = {
  name: string;
  columns: string[];
  rows: ExportRow[];
  rowStyle?: (row: ExportRow, rowIndex: number, excelRow: Row, columns: string[]) => void;
};

const AD_GROUP_ROW_FILLS: Record<AdGroupTableRow["type"], string> = {
  Headline: "FFD9E8FF",
  Description: "FFE6F4EA",
  Keyword: "FFFFF5CC",
};
const AD_GROUP_ALERT_FILL = "FFFFC7CE";

function applyAdGroupRowStyle(row: ExportRow, _rowIndex: number, excelRow: Row, columns: string[]) {
  const type = row.Type;
  if (typeof type !== "string") return;
  const fillColor = AD_GROUP_ROW_FILLS[type as AdGroupTableRow["type"]];
  if (!fillColor) return;
  const typeIndex = columns.indexOf("Type");
  const characterIndex = columns.indexOf("Character");
  if (typeIndex !== -1) {
    const cell = excelRow.getCell(typeIndex + 1);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: fillColor },
    };
  }
  if (characterIndex !== -1) {
    const characterCell = excelRow.getCell(characterIndex + 1);
    const characterValue =
      typeof row.Character === "number" ? row.Character : Number.parseFloat(String(row.Character ?? ""));
    const exceeds =
      (type === "Headline" && characterValue > 30) || (type === "Description" && characterValue > 90);
    characterCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: exceeds ? AD_GROUP_ALERT_FILL : fillColor },
    };
  }
}

async function downloadWorkbook(
  sheets: ExportSheet[],
  filename: string,
) {
  const workbook = new Workbook();
  sheets.forEach((sheetDef) => {
    const sheet = workbook.addWorksheet(sheetDef.name);
    sheet.addRow(sheetDef.columns);
    sheet.getRow(1).font = { bold: true };
    sheetDef.rows.forEach((row, rowIndex) => {
      const excelRow = sheet.addRow(sheetDef.columns.map((column) => row[column] ?? ""));
      sheetDef.rowStyle?.(row, rowIndex, excelRow, sheetDef.columns);
    });
    sheetDef.columns.forEach((column, index) => {
      const maxCellLength = Math.max(
        column.length,
        ...sheetDef.rows.map((row) => String(row[column] ?? "").length),
      );
      const paddedWidth = Math.min(Math.max(maxCellLength + 2, 10), 60);
      sheet.getColumn(index + 1).width = paddedWidth;
    });
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
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
  const [existingProjects, setExistingProjects] = useState<ExistingProjectSummary[]>([]);
  const [isFetchingProjects, setIsFetchingProjects] = useState(false);
  const [projectListError, setProjectListError] = useState<string | null>(null);
  const [entityOverride, setEntityOverride] = useState<string>("");
  const [campaigns, setCampaigns] = useState<CampaignPlan[]>([]);
  const [optimizationPlaybook, setOptimizationPlaybook] = useState<OptimizationPlaybook | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("performance");
  const [viewSwipeDirection, setViewSwipeDirection] = useState<"left" | "right">("right");
  const [fileName, setFileName] = useState<string | null>(null);
  const [backupFileName, setBackupFileName] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [adTextRemovals, setAdTextRemovals] = useState<AdTextRemoval[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedAdGroup, setSelectedAdGroup] = useState<{ campaignIdx: number; adGroupIdx: number } | null>(null);
  const [selectedCampaignSettings, setSelectedCampaignSettings] = useState<{ campaignIdx: number } | null>(null);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<number, boolean>>({});
  const [copiedName, setCopiedName] = useState<string | null>(null);
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
  const playbookFrequencies = useMemo(() => {
    if (!optimizationPlaybook) {
      return [];
    }
    const unique = new Set(
      optimizationPlaybook.Rules_Of_Engagement.map((rule) => rule.Frequency).filter((value) => Boolean(value)),
    );
    return Array.from(unique);
  }, [optimizationPlaybook]);

  const [monthlySpendOverride, setMonthlySpendOverride] = useState<number | null>(null);
  const monthlySpendSliderMin = 1000;
  const [mermaidSvg, setMermaidSvg] = useState<string>("");
  const [mermaidError, setMermaidError] = useState<string | null>(null);
  const mermaidRef = useRef<typeof import("mermaid").default | null>(null);
  const mermaidRenderId = useRef(0);
  const prevViewModeRef = useRef<ViewMode>(viewMode);
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
    void refreshExistingProjects();
  }, [refreshExistingProjects]);

  const entityValue = useMemo(() => {
    const trimmed = entityOverride.trim();
    return trimmed !== "" ? trimmed : projectIdInput;
  }, [entityOverride, projectIdInput]);

  const campaignTableRows = useMemo<CampaignTableRow[]>(() => {
    return campaigns.map((campaign, idx) => {
      const campaignName = campaign.CampaignName ?? `Campaign ${idx + 1}`;
      return {
        platform: "Google",
        funnel: "BOFU",
        entity: entityValue,
        campaignName,
        campaignType: campaign.CampaignType ?? "",
        objective: campaign.Goal ?? "",
        keywordsAudience: extractKeywordsAudience(campaignName),
        monthlyBudgetMYR: campaign.MonthlyBudgetMYR ?? computeMonthlyBudget(campaign.BudgetDailyMYR ?? null),
        landingPageUrl: websiteUrl ?? "",
      };
    });
  }, [campaigns, entityValue, websiteUrl]);

  const adGroupTableRows = useMemo<AdGroupTableRow[]>(() => {
    return campaigns.flatMap((campaign, campaignIdx) =>
      (campaign.AdGroups ?? []).flatMap((adGroup, idx) => {
        const campaignName = campaign.CampaignName ?? `Campaign ${campaignIdx + 1}`;
        const name = adGroup.AdGroupName ?? `Ad Group ${idx + 1}`;
        const ads = Array.isArray(adGroup.ResponsiveSearchAds) ? adGroup.ResponsiveSearchAds : [];
        const headlines = ads.flatMap((ad) => {
          const meta = ad.HeadlinesMeta ?? ad.Headlines?.map((text) => ({ Text: text, CharCount: text.length })) ?? [];
          return meta.map((item) => ({
            campaignName,
            name,
            text: item.Text ?? "",
            character: item.CharCount,
            type: "Headline" as const,
          }));
        });
        const descriptions = ads.flatMap((ad) => {
          const meta =
            ad.DescriptionsMeta ?? ad.Descriptions?.map((text) => ({ Text: text, CharCount: text.length })) ?? [];
          return meta.map((item) => ({
            campaignName,
            name,
            text: item.Text ?? "",
            character: item.CharCount,
            type: "Description" as const,
          }));
        });
        const keywords = keywordList(adGroup.Targeting, false).map((kw) => ({
          campaignName,
          name,
          text: kw.Keyword ?? "",
          character: null,
          type: "Keyword" as const,
        }));
        return [...headlines, ...descriptions, ...keywords];
      }),
    );
  }, [campaigns]);

  const campaignExportRows = useMemo(
    () =>
      campaignTableRows.map((row) => ({
        Platform: row.platform,
        Funnel: row.funnel,
        Entity: row.entity,
        "Campaign Name": row.campaignName,
        "Campaign Type": row.campaignType,
        Objective: row.objective,
        "Keywords / Audience": row.keywordsAudience,
        "Monthly Budget (RM)": row.monthlyBudgetMYR ?? "",
        "Landing Page URL": row.landingPageUrl,
      })),
    [campaignTableRows],
  );

  const adGroupExportRows = useMemo(
    () =>
      adGroupTableRows.map((row) => ({
        "Campaign Name": row.campaignName,
        Name: row.name,
        Text: row.text,
        Character: row.character ?? "",
        Type: row.type,
      })),
    [adGroupTableRows],
  );

  const exportAllRows = useMemo(
    () => [
      ...campaignTableRows.map((row) => ({
        Table: "Campaign",
        Platform: row.platform,
        Funnel: row.funnel,
        Entity: row.entity,
        "Campaign Name": row.campaignName,
        "Campaign Type": row.campaignType,
        Objective: row.objective,
        "Keywords / Audience": row.keywordsAudience,
        "Monthly Budget (RM)": row.monthlyBudgetMYR ?? "",
        "Landing Page URL": row.landingPageUrl,
        Name: "",
        Text: "",
        Character: "",
        Type: "",
      })),
      ...adGroupTableRows.map((row) => ({
        Table: "Ad Group",
        Platform: "",
        Funnel: "",
        Entity: "",
        "Campaign Name": row.campaignName,
        "Campaign Type": "",
        Objective: "",
        "Keywords / Audience": "",
        "Monthly Budget (RM)": "",
        "Landing Page URL": "",
        Name: row.name,
        Text: row.text,
        Character: row.character ?? "",
        Type: row.type,
      })),
    ],
    [campaignTableRows, adGroupTableRows],
  );

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
  }, [baseMonthlySpendTotal, monthlySpendOverride, monthlySpendSliderMax, monthlySpendSliderMin]);

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

  useEffect(() => {
    const prevViewMode = prevViewModeRef.current;
    if (prevViewMode === viewMode) {
      return;
    }
    const prevIndex = VIEW_ORDER.indexOf(prevViewMode);
    const nextIndex = VIEW_ORDER.indexOf(viewMode);
    if (prevIndex !== -1 && nextIndex !== -1) {
      setViewSwipeDirection(nextIndex > prevIndex ? "right" : "left");
    } else {
      setViewSwipeDirection("right");
    }
    prevViewModeRef.current = viewMode;
  }, [viewMode]);

  const loadPlan = async (pid?: string) => {
    const targetProjectId = pid ?? projectIdInput;
    setIsLoading(true);
    setStatusMessage("Loading plan…");
    setAdTextRemovals([]);
    try {
      const params = new URLSearchParams();
      if (targetProjectId) params.set("projectId", targetProjectId);
      const res = await fetch(`/api/sem/campaign-visualizer?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as {
        projectId?: string;
        campaigns?: CampaignPlan[];
        optimizationPlaybook?: OptimizationPlaybook;
        fileName?: string;
        backupFileName?: string;
        error?: string;
        normalizedInput?: NormalizedProjectInitInput | null;
        adTextRemovals?: AdTextRemoval[];
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
      setOptimizationPlaybook(json.optimizationPlaybook ?? null);
      setSelectedAdGroup(null);
      setExpandedCampaigns({});
      setFileName(json.fileName ?? null);
      setBackupFileName(json.backupFileName ?? null);
      setNormalizedInput(json.normalizedInput ?? null);
      setWebsiteUrl(json.normalizedInput?.website ?? null);
      setSalesValueAutoSet(false);
      setMonthlySpendOverride(null);
      setAdTextRemovals(json.adTextRemovals ?? []);
      setStatusMessage(
        `Loaded ${json.campaigns?.length ?? 0} campaign(s) from ${json.fileName ?? "11-*.json"}. Backup: ${
          json.backupFileName ?? "n/a"
        }`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to load plan";
      setStatusMessage(message);
      setCampaigns([]);
      setOptimizationPlaybook(null);
      setNormalizedInput(null);
      setAdTextRemovals([]);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteFile = async (target: string, label: string) => {
    if (!projectIdInput || !target) return;
    const confirmed = window.confirm(`Delete ${label} ${target}? This cannot be undone.`);
    if (!confirmed) return;
    setIsDeleting(true);
    try {
      const params = new URLSearchParams({ projectId: projectIdInput, file: target });
      const res = await fetch(`/api/sem/project-files?${params.toString()}`, { method: "DELETE" });
      const json = (await res.json()) as { deleted?: boolean; error?: string };
      if (!res.ok || !json.deleted) {
        throw new Error(json.error || res.statusText);
      }
      if (target === fileName) setFileName(null);
      if (target === backupFileName) setBackupFileName(null);
      setStatusMessage(`Deleted ${target}.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to delete file";
      setStatusMessage(message);
    } finally {
      setIsDeleting(false);
    }
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
        body: JSON.stringify({ projectId: projectIdInput, campaigns, optimizationPlaybook, fileName }),
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
    setSelectedCampaignSettings(null);
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

  const selectedCampaignSettingsData = selectedCampaignSettings
    ? campaigns[selectedCampaignSettings.campaignIdx]
    : null;
  const detailContent = (
    <>
      {!selectedAdGroupData && !selectedCampaignSettingsData && (
        <div className="text-sm text-muted">
          Select &quot;Campaign Settings&quot; or an &quot;Ad Group&quot; on the left to view details here.
        </div>
      )}
      {selectedCampaignSettingsData && (
        <CampaignSettingsPanel
          campaign={selectedCampaignSettingsData}
          onClose={() => setSelectedCampaignSettings(null)}
        />
      )}
      {selectedAdGroupData ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div>
              <div className="text-xs text-muted">Ad Group detail</div>
              <div className="flex items-center gap-2 font-semibold">
                <span>
                  {selectedAdGroupData.AdGroups?.[selectedAdGroup!.adGroupIdx]?.AdGroupName ?? "Ad Group"}
                </span>
                <button
                  type="button"
                  className={`${copyButtonClass} ${
                    copiedName === `adgroup-${selectedAdGroup!.campaignIdx}-${selectedAdGroup!.adGroupIdx}`
                      ? "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-200 dark:border-green-700"
                      : "dark:text-slate-100"
                  }`}
                  onClick={() =>
                    void copyName(
                      selectedAdGroupData.AdGroups?.[selectedAdGroup!.adGroupIdx]?.AdGroupName ?? "Ad Group",
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
              <div className="text-sm text-muted">
                In campaign: {selectedAdGroupData.CampaignName} • CPC:{" "}
                {formatCpc(selectedAdGroupData.AdGroups?.[selectedAdGroup!.adGroupIdx]?.DefaultMaxCPCMYR ?? null)}
              </div>
            </div>
          </div>
          <AdGroupTabs
            adGroup={selectedAdGroupData.AdGroups?.[selectedAdGroup!.adGroupIdx]}
            targeting={selectedAdGroupData.AdGroups?.[selectedAdGroup!.adGroupIdx]?.Targeting}
          />
        </div>
      ) : null}
    </>
  );

  const copyName = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedName(key);
      window.setTimeout(() => setCopiedName((current) => (current === key ? null : current)), 1200);
    } catch {
      setCopiedName(null);
    }
  };

  const filesTooltip =
    fileName || backupFileName
      ? `File: ${fileName ?? "waiting for load"}${backupFileName ? ` | Backup: ${backupFileName}` : ""}`
      : "No files loaded yet.";
  const existingProjectValue = existingProjects.find((project) => project.id === projectIdInput)?.id;

  return (
    <main className="min-h-screen bg-surface-muted p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Badge variant="secondary">Step 9</Badge>
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Campaign Visualization & QA</h1>
              <p className="text-sm text-muted">
                Reads Step 10 JSON, creates an automatic backup, and lets you review & edit before Google Ads upload.
              </p>
            </div>
          </div>
          <Link className={buttonVariants({ variant: "link", size: "sm" })} href="/sem">
            ← Back to SEM pipeline
          </Link>
        </header>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Project controls</CardTitle>
            <CardDescription>Load, review, and manage campaign plan files.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <label className="text-sm flex flex-col items-start gap-1 sm:flex-row sm:items-center">
                    <span className="text-muted">projectId</span>
                    <Input
                      className="w-full sm:w-60"
                      value={projectIdInput}
                      onChange={(e) => setProjectIdInput(e.target.value)}
                      placeholder="YYYYMMDD-HH-001"
                    />
                  </label>
                  <Button className="w-full sm:w-auto" onClick={() => void loadPlan()} disabled={isLoading}>
                    {isLoading ? "Loading…" : "Load JSON"}
                  </Button>
                  <Button
                    className="w-full sm:w-auto"
                    variant="secondary"
                    onClick={saveChanges}
                    disabled={isSaving || !campaigns.length}
                  >
                    {isSaving ? "Saving…" : "Save changes"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="w-full sm:w-auto" variant="outline">
                        More
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          void loadPlan(projectIdInput);
                        }}
                        disabled={isLoading || !projectIdInput}
                      >
                        Reload from disk
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          if (fileName) void deleteFile(fileName, "file");
                        }}
                        disabled={isDeleting || !fileName}
                      >
                        Delete current file
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          if (backupFileName) void deleteFile(backupFileName, "backup");
                        }}
                        disabled={isDeleting || !backupFileName}
                      >
                        Delete backup
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="grid gap-2">
                  <div className="flex flex-col gap-2 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
                    <span>Or select an existing project</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void refreshExistingProjects()}
                      disabled={isFetchingProjects}
                    >
                      {isFetchingProjects ? "Loading…" : "Refresh list"}
                    </Button>
                  </div>
                  <Select
                    value={existingProjectValue}
                    disabled={existingProjects.length === 0}
                    onValueChange={(value) => {
                      if (value) {
                        setProjectIdInput(value);
                        void loadPlan(value);
                      }
                    }}
                  >
                    <SelectTrigger className="h-10 w-full text-sm">
                      <SelectValue placeholder="Choose existing project" />
                    </SelectTrigger>
                    <SelectContent>
                      {existingProjects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.id} — {project.fileCount} {project.fileCount === 1 ? "file" : "files"} •{" "}
                          {formatProjectTimestamp(project.createdMs)}
                          {project.websiteDomain ? ` • ${project.websiteDomain}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {projectListError && <div className="text-xs text-red-700 dark:text-red-300">{projectListError}</div>}
                  {!projectListError && !isFetchingProjects && existingProjects.length === 0 && (
                    <div className="text-xs text-muted">No existing projects found in output/ yet.</div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary" className="cursor-help" title={filesTooltip}>
                    Files
                  </Badge>
                  <Badge variant="warning">
                    Tip: tables are collapsed by default. Expand to review and export each table.
                  </Badge>
                </div>
              </div>
              <div className="w-full lg:w-80 space-y-4">
                {websiteUrl && (
                  <div className="rounded-lg border border-default bg-surface p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <Badge variant="outline">Website Context</Badge>
                        <div className="break-all text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {websiteUrl}
                        </div>
                      </div>
                      <a
                        href={websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonVariants({ variant: "secondary", size: "sm" })}
                      >
                        Visit ↗
                      </a>
                    </div>
                  </div>
                )}
                <div className="rounded-lg border border-default bg-surface p-3 text-sm shadow-sm">
                  <div className="text-xs font-semibold uppercase text-muted">Initial inputs</div>
                  {normalizedInput ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[
                        { label: "Goal", value: normalizedInput.goal },
                        { label: "Location", value: normalizedInput.location },
                        {
                          label: "States",
                          value: normalizedInput.state_list?.length ? normalizedInput.state_list.join(", ") : "",
                        },
                        { label: "Language", value: normalizedInput.language },
                        {
                          label: "Monthly ad spend",
                          value: formatCurrency(normalizedInput.monthly_adspend_myr),
                        },
                      ]
                        .filter((item) => item.value)
                        .map((item, index) => (
                          <Badge
                            key={item.label}
                            title={`${item.label}: ${item.value}`}
                            className={cn(
                              "border px-2.5 py-1 text-xs font-medium",
                              [
                                "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-700/60 dark:bg-sky-900/30 dark:text-sky-100",
                                "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-100",
                                "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100",
                                "border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-700/60 dark:bg-indigo-900/30 dark:text-indigo-100",
                                "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-700/60 dark:bg-rose-900/30 dark:text-rose-100",
                              ][index % 5],
                            )}
                          >
                            <span className="sr-only">{item.label}: </span>
                            {item.value}
                          </Badge>
                        ))}
                      {[
                        normalizedInput.goal,
                        normalizedInput.location,
                        normalizedInput.state_list?.length ? normalizedInput.state_list.join(", ") : "",
                        normalizedInput.language,
                        formatCurrency(normalizedInput.monthly_adspend_myr),
                      ].every((value) => !value) && <div className="text-muted">No initial inputs set.</div>}
                    </div>
                  ) : (
                    <div className="mt-2 text-muted">Load a project to view initial inputs.</div>
                  )}
                </div>
              </div>
            </div>
            {adTextRemovals.length > 0 && (
              <Alert variant="warning">
                <AlertTitle>
                  Removed {adTextRemovals.length} ad text item(s) because they still exceeded length limits after retries.
                </AlertTitle>
                <AlertDescription>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    {adTextRemovals.slice(0, 6).map((item, idx) => (
                      <li key={`${item.campaignName}-${item.adGroupName}-${item.adIndex}-${item.textType}-${idx}`}>
                        {item.textType} removed from {item.campaignName} → {item.adGroupName} (Ad {item.adIndex + 1},{" "}
                        {item.originalLength}/{item.limit} chars).
                      </li>
                    ))}
                    {adTextRemovals.length > 6 && <li>And {adTextRemovals.length - 6} more…</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Tabs
          value={viewMode}
          onValueChange={(value) => setViewMode(value as ViewMode)}
          className="space-y-4"
        >
          <div className="grid gap-2 md:hidden">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">View</div>
            <Select value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)}>
              <SelectTrigger className="h-10 w-full rounded-full border border-default">
                <SelectValue placeholder="Select view" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="performance">Performance calculator</SelectItem>
                <SelectItem value="breakdown">Campaign breakdown</SelectItem>
                <SelectItem value="tables">QA tables & exports</SelectItem>
                <SelectItem value="playbook">Optimization Playbook</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <TabsList className="hidden flex-wrap justify-start rounded-full border border-default bg-surface-muted p-1 shadow-sm md:flex">
            <TabsTrigger
              value="performance"
              className="rounded-full px-4 py-2 text-sm font-semibold text-muted transition-all duration-200 ease-out data-[state=active]:-translate-y-px data-[state=active]:scale-[1.02] data-[state=active]:bg-[var(--accent)] data-[state=active]:!text-white data-[state=active]:shadow-md"
            >
              Performance calculator
            </TabsTrigger>
            <TabsTrigger
              value="breakdown"
              className="rounded-full px-4 py-2 text-sm font-semibold text-muted transition-all duration-200 ease-out data-[state=active]:-translate-y-px data-[state=active]:scale-[1.02] data-[state=active]:bg-[var(--accent)] data-[state=active]:!text-white data-[state=active]:shadow-md"
            >
              Campaign breakdown
            </TabsTrigger>
            <TabsTrigger
              value="tables"
              className="rounded-full px-4 py-2 text-sm font-semibold text-muted transition-all duration-200 ease-out data-[state=active]:-translate-y-px data-[state=active]:scale-[1.02] data-[state=active]:bg-[var(--accent)] data-[state=active]:!text-white data-[state=active]:shadow-md"
            >
              QA tables & exports
            </TabsTrigger>
            <TabsTrigger
              value="playbook"
              className="rounded-full px-4 py-2 text-sm font-semibold text-muted transition-all duration-200 ease-out data-[state=active]:-translate-y-px data-[state=active]:scale-[1.02] data-[state=active]:bg-[var(--accent)] data-[state=active]:!text-white data-[state=active]:shadow-md"
            >
              Optimization Playbook
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="performance"
            className={viewSwipeDirection === "right" ? "tabs-swipe-right" : "tabs-swipe-left"}
          >
            <Card>
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Performance calculator</CardTitle>
                  <CardDescription>
                    Forecast clicks, leads, revenue, and ROI using 00-user-input and 10/11 campaign plan budgets.
                  </CardDescription>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-2 sm:text-right">
                  <Card className="shadow-none border-dashed">
                    <CardContent className="p-3">
                      <Badge variant="secondary">Step 1 budget</Badge>
                      <div className="text-sm font-semibold mt-1">
                        {normalizedInput ? formatCurrency(normalizedInput.monthly_adspend_myr) : "—"}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="shadow-none border-dashed">
                    <CardContent className="p-3">
                      <Badge variant="info">Campaign spend ×{assumptions.daysPerMonth}d</Badge>
                      <div className="text-sm font-semibold mt-1">
                        {formatCurrency(performanceTotals.totalMonthlySpend)}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {!campaigns.length ? (
                  <div className="rounded-lg border border-dashed bg-muted/40 p-6 text-sm text-muted-foreground">
                    Load a project to pull budgets from 00/11 JSON before using the calculator.
                  </div>
                ) : (
                  <>
                <Card className="shadow-sm">
                  <CardHeader className="flex-row items-center justify-between gap-2">
                    <CardTitle className="text-base" title="Ad spend flowing into clicks, leads, revenue, and ROI">
                      Performance funnel
                    </CardTitle>
                    {mermaidError && <Badge variant="warning">{mermaidError}</Badge>}
                  </CardHeader>
                  <CardContent>
                    {mermaidSvg ? (
                      <div className="overflow-auto min-h-[260px]" dangerouslySetInnerHTML={{ __html: mermaidSvg }} />
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Load budgets or adjust sliders to see the funnel.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-base">Assumptions & inputs</CardTitle>
                      <CardDescription>Adjust the baselines to see how spend, clicks, and ROI react.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground" title="Number of active days the campaigns run this month.">
                      <span>Days/month</span>
                      <Select
                        value={assumptions.daysPerMonth.toString()}
                        onValueChange={(value) => {
                          updateAssumption("daysPerMonth", Number(value));
                          setMonthlySpendOverride(null);
                        }}
                      >
                      <SelectTrigger className="h-8 w-full sm:w-[140px] text-sm bg-surface">
                        <SelectValue />
                      </SelectTrigger>
                        <SelectContent>
                          {[28, 30, 31].map((day) => (
                            <SelectItem key={day} value={day.toString()}>
                              {day} days
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                      <Card className="shadow-none border-dashed bg-muted/30">
                        <CardContent className="p-3">
                          <label className="flex flex-col gap-2">
                            <div className="flex items-center justify-between text-sm font-medium" title="Model different total budgets to see how traffic, leads, and revenue scale. Defaults to your campaign budgets.">
                              <span>Monthly ad spend (MYR)</span>
                              <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-100">
                                {formatCurrency(Math.round(effectiveMonthlySpend))}
                              </span>
                            </div>
                            <Slider
                              min={monthlySpendSliderMin}
                              max={monthlySpendSliderMax}
                              step={monthlySpendSliderStep}
                              value={[effectiveMonthlySpend]}
                              onValueChange={(value) => {
                                const nextValue = clampMonthlySpend(value[0] ?? effectiveMonthlySpend);
                                setMonthlySpendOverride(nextValue);
                                setMonthlySpendInput(Math.round(nextValue).toString());
                              }}
                            />
                            <Input
                              type="number"
                              min={monthlySpendSliderMin}
                              max={monthlySpendSliderMax}
                              step={monthlySpendSliderStep}
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
                            <div className="flex items-center justify-between text-xs text-muted">
                              <span>Min {formatCurrency(monthlySpendSliderMin)}</span>
                              <span>Max {formatCurrency(monthlySpendSliderMax)}</span>
                            </div>
                          </label>
                        </CardContent>
                      </Card>

                      <Card className="shadow-none border-dashed bg-muted/30">
                        <CardContent className="p-3">
                          <label className="flex flex-col gap-2">
                            <div className="flex items-center justify-between text-sm font-medium" title="Global average CPC applied to all campaigns. Slide to test cheaper or more expensive clicks.">
                              <span>Global avg CPC (MYR)</span>
                              <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-100">
                                RM {assumptions.averageCpc.toFixed(2)}
                              </span>
                            </div>
                            <Slider
                              min={0.1}
                              max={10}
                              step={0.1}
                              value={[assumptions.averageCpc]}
                              onValueChange={(value) => updateAssumption("averageCpc", value[0] ?? assumptions.averageCpc)}
                            />
                            <div className="text-xs text-muted">
                              Defaults to ad group avg{averageAdGroupCpc ? ` (RM ${averageAdGroupCpc.toFixed(2)})` : ""}.
                            </div>
                          </label>
                        </CardContent>
                      </Card>

                      <Card className="shadow-none border-dashed bg-muted/30">
                        <CardContent className="p-3">
                          <label className="flex flex-col gap-2">
                            <div className="flex items-center justify-between text-sm font-medium" title="Set worst and best conversion rates to bound expected performance.">
                              <span>Conv. Rate (%)</span>
                              <div className="flex items-center gap-2 text-xs">
                                <span className="px-2 py-1 rounded bg-amber-50 text-amber-800 font-semibold dark:bg-amber-900/30 dark:text-amber-100">
                                  {assumptions.worstConversionRate.toFixed(1)}%
                                </span>
                                <span className="px-2 py-1 rounded bg-green-50 text-green-800 font-semibold dark:bg-green-900/30 dark:text-green-100">
                                  {assumptions.bestConversionRate.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                            <div className="pt-2 pb-3">
                              <Slider
                                min={0.1}
                                max={15}
                                step={0.1}
                                value={[assumptions.worstConversionRate, assumptions.bestConversionRate]}
                                onValueChange={(value) => {
                                  const [first, second] = value;
                                  if (!Number.isFinite(first) || !Number.isFinite(second)) return;
                                  const sorted = [first, second].sort((a, b) => a - b);
                                  updateAssumption("worstConversionRate", sorted[0]);
                                  updateAssumption("bestConversionRate", sorted[1]);
                                }}
                              />
                              <div className="flex justify-between text-xs text-muted mt-2">
                                <span className="px-2 py-1 rounded bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100">Worst</span>
                                <span className="px-2 py-1 rounded bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-100">Best</span>
                              </div>
                            </div>
                          </label>
                        </CardContent>
                      </Card>

                      <Card className="shadow-none border-dashed bg-muted/30">
                        <CardContent className="p-3">
                          <label className="flex flex-col gap-2">
                            <div className="flex items-center justify-between text-sm font-medium" title="Adjust value per lead (Sales Value) and set the number of active days.">
                              <span>Sales Value (MYR)</span>
                              <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-100">
                                RM {assumptions.conversionValue.toFixed(0)}
                              </span>
                            </div>
                            <Slider
                              min={10}
                              max={1000}
                              step={10}
                              value={[assumptions.conversionValue]}
                              onValueChange={(value) =>
                                updateAssumption("conversionValue", value[0] ?? assumptions.conversionValue)
                              }
                            />
                            <div className="text-xs text-muted">
                              Breakeven @ worst-case ROI: {breakevenSalesValue ? formatCurrency(Math.round(breakevenSalesValue)) : "n/a"}
                            </div>
                          </label>
                        </CardContent>
                      </Card>

                    </div>
                  </CardContent>
                </Card>

                <Separator />

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Performance outlook</CardTitle>
                    <CardDescription>Summary of spend, traffic, and revenue impact.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <Card className="shadow-none border-dashed bg-muted/30">
                        <CardContent className="p-3">
                          <div className="text-xs uppercase text-muted" title="Sum of campaign budgets scaled by the monthly spend slider">
                            Total monthly ad spend
                          </div>
                          <div className="text-2xl font-semibold">{formatCurrency(performanceTotals.totalMonthlySpend)}</div>
                        </CardContent>
                      </Card>
                      <Card className="shadow-none border-dashed bg-muted/30">
                        <CardContent className="p-3">
                          <div className="text-xs uppercase text-muted" title="Traffic generated from the monthly spend and global CPC">
                            Estimated clicks / month
                          </div>
                          <div className="text-2xl font-semibold">{formatNumber(Math.round(performanceTotals.totalEstimatedClicks))}</div>
                        </CardContent>
                      </Card>
                      <Card className="shadow-none border-dashed bg-muted/30">
                        <CardContent className="p-3">
                          <div className="text-xs uppercase text-muted" title="Leads using worst to best conversion rate assumptions">
                            Estimated leads / month
                          </div>
                          <div className="text-2xl font-semibold">
                            {formatNumber(Math.round(performanceTotals.totalLeadsWorst))} –{" "}
                            {formatNumber(Math.round(performanceTotals.totalLeadsBest))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="border rounded-lg p-4 bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-800 text-white shadow">
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
                          const bg = positive
                            ? "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100"
                            : mid
                              ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                              : "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100";
                          return (
                            <div
                              key={item.label}
                              className={`rounded-lg p-3 ${bg} bg-opacity-80 flex flex-col gap-2 ${item.align}`}
                            >
                              <div className="text-xs uppercase tracking-wide">{item.label} case</div>
                              <div className="text-3xl font-extrabold">{formatCurrencyCompact(item.revenue)}</div>
                              <div className="text-sm font-semibold text-black/70 dark:text-slate-200">
                                ROI {formatPercent(item.value)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="text-base">Campaign breakdown</CardTitle>
                      <CardDescription>
                        Sort by any column to see which campaigns drive the most traffic or revenue.
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
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
                            <tr key={row.CampaignName} className="odd:bg-gray-50 dark:odd:bg-slate-900/40">
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
                  </CardContent>
                </Card>
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>

        <TabsContent
          value="breakdown"
          className={viewSwipeDirection === "right" ? "tabs-swipe-right" : "tabs-swipe-left"}
        >
          <Card>
            <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Campaign breakdown</CardTitle>
              <Button variant="ghost" size="sm" onClick={resetSelection}>
                Clear selection
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
            {campaigns.length === 0 && (
              <div className="text-sm text-muted">Load a project to view campaign cards.</div>
            )}
            <div className="grid md:grid-cols-[1.3fr_1fr] gap-4">
              <div className="space-y-3">
                {sortedCampaignsByBudget.map(({ campaign, campaignIdx }) => {
                  const isOpen = expandedCampaigns[campaignIdx] ?? true;
                  return (
                    <details
                      key={campaignIdx}
                      open={isOpen}
                      className="border border-default rounded-lg overflow-hidden bg-surface-muted transition-shadow transition-colors hover:border-blue-300 hover:shadow-md dark:hover:border-blue-600/60"
                      onToggle={(e) =>
                        setExpandedCampaigns((prev) => ({
                          ...prev,
                          [campaignIdx]: (e.target as HTMLDetailsElement).open,
                        }))
                      }
                    >
                      <summary className="cursor-pointer px-4 py-3 flex flex-wrap gap-3 items-center">
                        <div className="flex items-center gap-2 font-semibold">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-default bg-surface text-xs">
                            {isOpen ? "−" : "+"}
                          </span>
                          <span>{campaign.CampaignName ?? `Campaign ${campaignIdx + 1}`}</span>
                          <button
                            type="button"
                            className={`ml-1 ${copyButtonClass} ${
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
                        <div className="text-xs text-muted flex gap-2 flex-wrap">
                          <span className="px-2 py-1 rounded bg-surface border border-default">Goal: {campaign.Goal || "—"}</span>
                          <span className="px-2 py-1 rounded bg-surface border border-default">
                            Type: {campaign.CampaignType || "—"}
                          </span>
                          <span className="px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-700/60 dark:bg-blue-900/30 dark:text-blue-100">
                            Daily: {formatCurrency(campaign.BudgetDailyMYR)}
                          </span>
                          <span className="px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-700/60 dark:bg-indigo-900/30 dark:text-indigo-100">
                            Monthly: {formatCurrency(campaign.MonthlyBudgetMYR ?? computeMonthlyBudget(campaign.BudgetDailyMYR))}
                          </span>
                          <span className="px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100">
                            tCPA: {formatCurrency(campaign.BiddingLifecycle?.Phase2_Scale?.TargetCPA_MYR ?? campaign.TargetCPAMYR)}
                          </span>
                          <span className="px-2 py-1 rounded bg-surface border border-default">
                            Lang: {Array.isArray(campaign.Language) ? campaign.Language.join(", ") : campaign.Language || "—"}
                          </span>
                        </div>
                      </summary>
                      <div className="px-4 pb-4 space-y-2">
                        <div className="text-sm text-muted">
                          {campaign.AdGroups?.length ?? 0} ad group(s) • Click to drill into Ads / Keywords / Negatives
                        </div>
                        <button
                          className={`w-full text-left border border-default rounded-lg p-3 font-medium transition hover:border-blue-400 hover:bg-blue-50/40 hover:shadow-sm dark:hover:border-blue-500 dark:hover:bg-blue-900/10 ${
                            selectedCampaignSettings?.campaignIdx === campaignIdx
                              ? "ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/20"
                              : "bg-surface"
                          } dark:hover:border-blue-500`}
                          onClick={() => {
                            setSelectedCampaignSettings({ campaignIdx });
                            setSelectedAdGroup(null);
                          }}
                        >
                          Campaign Settings
                          <div className="text-xs text-muted font-normal mt-1">
                            Location • Bidding Strategy • Ad Schedule • Negative Keywords
                          </div>
                        </button>
                        <div className="grid md:grid-cols-2 gap-2">
                          {(campaign.AdGroups ?? []).map((group, adGroupIdx) => {
                            const targeting = group.Targeting;
                            const keywords = keywordList(targeting, false);
                            return (
                              <button
                                key={adGroupIdx}
                                className={`border border-default rounded-lg bg-surface text-left p-3 transition hover:border-blue-400 hover:bg-blue-50/40 hover:shadow-sm dark:hover:border-blue-500 dark:hover:bg-blue-900/10 ${
                                  selectedAdGroup?.campaignIdx === campaignIdx &&
                                  selectedAdGroup?.adGroupIdx === adGroupIdx
                                    ? "ring-2 ring-blue-400"
                                    : ""
                                } dark:hover:border-blue-500`}
                                onClick={() => {
                                  setSelectedAdGroup({ campaignIdx, adGroupIdx });
                                  setSelectedCampaignSettings(null);
                                }}
                              >
                                <div className="font-medium">{group.AdGroupName ?? `Ad Group ${adGroupIdx + 1}`}</div>
                                <div className="text-xs text-muted flex flex-wrap gap-2 mt-1">
                                  <span className="px-2 py-1 rounded bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-100">
                                    CPC (MYR): {formatCpc(group.DefaultMaxCPCMYR)}
                                  </span>
                                  <span className="px-2 py-1 rounded bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                                    Keywords: {keywords.length}
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
              <div className="hidden md:block">
                <div className="border border-default rounded-lg bg-white dark:bg-slate-900 p-4 h-full">
                  <div className="flex flex-col gap-3 h-full">{detailContent}</div>
                </div>
              </div>
            </div>
            {(selectedAdGroupData || selectedCampaignSettingsData) && (
              <div className="md:hidden">
                <button
                  type="button"
                  aria-label="Close details"
                  className="fixed inset-0 z-40 bg-black/40"
                  onClick={resetSelection}
                />
                <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border border-default bg-surface p-4 shadow-2xl">
                  <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300" />
                  {detailContent}
                </div>
              </div>
            )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="tables"
          className={viewSwipeDirection === "right" ? "tabs-swipe-right" : "tabs-swipe-left"}
        >
          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>QA tables & exports</CardTitle>
                <CardDescription>
                  Tables are collapsed by default. Expand each card to review and export individually.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Button
                  variant="outline"
                  className="shadow-sm hover:bg-slate-200/70 dark:hover:bg-slate-700/60"
                  onClick={() =>
                    downloadCsv(
                      exportAllRows,
                      buildExportFilename(entityValue, "qa-tables.csv"),
                      [...EXPORT_ALL_HEADERS],
                    )
                  }
                  disabled={exportAllRows.length === 0}
                >
                  CSV
                </Button>
                <Button
                  variant="success"
                  onClick={() =>
                    void downloadWorkbook(
                      [
                        {
                          name: "Campaign Type",
                          columns: CAMPAIGN_TABLE_COLUMNS.map((col) => col.label),
                          rows: campaignExportRows,
                        },
                        {
                          name: "Ad Group",
                          columns: AD_GROUP_TABLE_COLUMNS.map((col) => col.label),
                          rows: adGroupExportRows,
                          rowStyle: applyAdGroupRowStyle,
                        },
                      ],
                      buildExportFilename(entityValue, "qa-tables.xlsx"),
                    )
                  }
                  disabled={campaignExportRows.length === 0 && adGroupExportRows.length === 0}
                >
                  Excel
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
            {campaigns.length === 0 && (
              <div className="text-sm text-muted">
                Load a project with a 10/11 JSON first to see tables and exports.
              </div>
            )}

            <TableCard
              title="Media Plan"
              note="Campaign table."
              defaultCollapsed
              onExport={() =>
                downloadCsv(
                  campaignExportRows,
                  buildExportFilename(entityValue, "media-plan.csv"),
                  CAMPAIGN_TABLE_COLUMNS.map((col) => col.label),
                )
              }
              onExportExcel={() =>
                void downloadWorkbook(
                  [
                    {
                      name: "Campaign Type",
                      columns: CAMPAIGN_TABLE_COLUMNS.map((col) => col.label),
                      rows: campaignExportRows,
                    },
                  ],
                  buildExportFilename(entityValue, "media-plan.xlsx"),
                )
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      {CAMPAIGN_TABLE_COLUMNS.map((column) => (
                        <th key={column.label} className="border-b px-2 py-1 text-left font-semibold">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {campaignTableRows.map((row, idx) => (
                      <tr key={`${row.campaignName}-${idx}`} className="odd:bg-gray-50 dark:odd:bg-slate-900/40">
                        <td className="px-2 py-1">{row.platform}</td>
                        <td className="px-2 py-1">{row.funnel}</td>
                        <td className="px-2 py-1">
                          <EditableCell
                            value={row.entity}
                            onChange={(val) => setEntityOverride(String(val ?? ""))}
                            placeholder="Project ID"
                          />
                        </td>
                        <td className="px-2 py-1">{row.campaignName}</td>
                        <td className="px-2 py-1">{row.campaignType}</td>
                        <td className="px-2 py-1">{row.objective}</td>
                        <td className="px-2 py-1">{row.keywordsAudience}</td>
                        <td className="px-2 py-1">{formatCurrency(row.monthlyBudgetMYR)}</td>
                        <td className="px-2 py-1">{row.landingPageUrl}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableCard>

            <TableCard
              title="Ad Group"
              note="Headlines, descriptions, and keywords per ad group."
              defaultCollapsed
              onExport={() =>
                downloadCsv(
                  adGroupExportRows,
                  buildExportFilename(entityValue, "ad-group.csv"),
                  AD_GROUP_TABLE_COLUMNS.map((col) => col.label),
                )
              }
              onExportExcel={() =>
                void downloadWorkbook(
                  [
                    {
                      name: "Ad Group",
                      columns: AD_GROUP_TABLE_COLUMNS.map((col) => col.label),
                      rows: adGroupExportRows,
                      rowStyle: applyAdGroupRowStyle,
                    },
                  ],
                  buildExportFilename(entityValue, "ad-group.xlsx"),
                )
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      {AD_GROUP_TABLE_COLUMNS.map((column) => (
                        <th key={column.label} className="border-b px-2 py-1 text-left font-semibold">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {adGroupTableRows.map((row, idx) => (
                      <tr key={`${row.name}-${row.type}-${idx}`} className="odd:bg-gray-50 dark:odd:bg-slate-900/40">
                        <td className="px-2 py-1">{row.campaignName}</td>
                        <td className="px-2 py-1">{row.name}</td>
                        <td className="px-2 py-1">{row.text}</td>
                        <td className="px-2 py-1">{row.character ?? ""}</td>
                        <td className="px-2 py-1">{row.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableCard>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="playbook"
          className={viewSwipeDirection === "right" ? "tabs-swipe-right" : "tabs-swipe-left"}
        >
          <section className="space-y-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Optimization Playbook</h2>
              <p className="text-sm text-muted">
                Your generated manual for managing these campaigns after launch.
              </p>
            </div>
    
                {!optimizationPlaybook ? (
                  <div className="bg-surface border border-default rounded-lg p-8 text-center text-muted">
                    <p>No optimization playbook found in the project data.</p>
                    <p className="text-sm mt-2">Make sure you have run the latest pipeline step that generates this data.</p>
                  </div>
                ) : (
                  <Tabs defaultValue="scorecard" className="space-y-6">
                    <TabsList className="w-full flex-wrap justify-start rounded-full border border-default bg-surface-muted px-2 py-1 text-muted">
                      <TabsTrigger
                        value="scorecard"
                        className="rounded-full px-4 text-sm font-semibold data-[state=active]:bg-[var(--accent)] data-[state=active]:!text-white data-[state=active]:shadow-md"
                      >
                        Scorecard
                      </TabsTrigger>
                      <TabsTrigger
                        value="rules"
                        className="rounded-full px-4 text-sm font-semibold data-[state=active]:bg-[var(--accent)] data-[state=active]:!text-white data-[state=active]:shadow-md"
                      >
                        Rules
                      </TabsTrigger>
                      <TabsTrigger
                        value="tracking"
                        className="rounded-full px-4 text-sm font-semibold data-[state=active]:bg-[var(--accent)] data-[state=active]:!text-white data-[state=active]:shadow-md"
                      >
                        Tracking
                      </TabsTrigger>
                    </TabsList>

                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                      <div className="space-y-6">
                        <TabsContent value="scorecard" className="mt-0 space-y-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <Card className="border-l-4 border-l-blue-500">
                              <CardHeader className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <CardTitle className="text-sm uppercase tracking-wide text-muted">
                                    Target Cost Per Lead
                                  </CardTitle>
                                  <Badge variant="info">Healthy</Badge>
                                </div>
                                <div className="text-3xl font-bold text-slate-900 dark:text-white">
                                  {formatCurrency(optimizationPlaybook.Metrics_Benchmarks.Target_CPL_MYR)}
                                </div>
                              </CardHeader>
                              <CardContent className="text-sm text-muted">
                                Ideal average cost. Maintain this for profitability.
                              </CardContent>
                            </Card>

                            <Card className="border-l-4 border-l-red-500">
                              <CardHeader className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <CardTitle className="text-sm uppercase tracking-wide text-muted">
                                    Max CPL Ceiling
                                  </CardTitle>
                                  <Badge variant="warning">Danger Zone</Badge>
                                </div>
                                <div className="text-3xl font-bold text-slate-900 dark:text-white">
                                  {formatCurrency(optimizationPlaybook.Metrics_Benchmarks.Max_CPL_Ceiling_MYR)}
                                </div>
                              </CardHeader>
                              <CardContent className="text-sm text-muted">
                                Pause ads or intervene if cost exceeds this ceiling.
                              </CardContent>
                            </Card>
                          </div>

                          <Alert variant="warning" className="flex flex-col gap-2">
                            <AlertTitle>Primary guardrail</AlertTitle>
                            <AlertDescription>
                              Keep CPL between the target and the ceiling. If trends move upward for 2+ checks in a row,
                              pause underperformers and reassess keyword quality.
                            </AlertDescription>
                          </Alert>
                        </TabsContent>

                        <TabsContent value="rules" className="mt-0">
                          <Card className="border-default">
                            <CardHeader className="space-y-1">
                              <CardTitle className="text-lg">Rules of Engagement</CardTitle>
                              <CardDescription>Expand each rule to see the condition, action, and rationale.</CardDescription>
                            </CardHeader>
                            <CardContent>
                              <Accordion type="multiple" className="rounded-lg border border-default">
                                {optimizationPlaybook.Rules_Of_Engagement.map((rule, idx) => (
                                  <AccordionItem key={`${rule.RuleName}-${idx}`} value={`rule-${idx}`} className="px-4">
                                    <AccordionTrigger className="gap-3">
                                      <div className="flex items-center gap-3">
                                        <span className="text-base font-semibold text-slate-900 dark:text-white">
                                          {rule.RuleName}
                                        </span>
                                        <Badge variant="info">{rule.Frequency}</Badge>
                                      </div>
                                    </AccordionTrigger>
                                    <AccordionContent>
                                      <div className="space-y-4">
                                        <div>
                                          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                                            IF (Condition)
                                          </div>
                                          <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm font-medium text-slate-800 dark:border-amber-900/30 dark:bg-amber-900/20 dark:text-slate-200">
                                            {rule.Condition}
                                          </div>
                                        </div>
                                        <div>
                                          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                                            THEN (Action)
                                          </div>
                                          <div className="text-sm text-slate-700 dark:text-slate-200">
                                            {rule.Action}
                                          </div>
                                        </div>
                                        <Alert className="bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                          <AlertTitle>Why it matters</AlertTitle>
                                          <AlertDescription>{rule.Rationale}</AlertDescription>
                                        </Alert>
                                      </div>
                                    </AccordionContent>
                                  </AccordionItem>
                                ))}
                              </Accordion>
                            </CardContent>
                          </Card>
                        </TabsContent>

                        <TabsContent value="tracking" className="mt-0">
                          <Card>
                            <CardHeader className="flex flex-row items-start gap-3">
                              <div className="mt-0.5 rounded-lg bg-blue-100 p-2 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="20"
                                  height="20"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                                </svg>
                              </div>
                              <div className="space-y-1">
                                <CardTitle>Tracking Setup Guide</CardTitle>
                                <CardDescription>
                                  Apply a Final URL Suffix at the account level to standardize attribution.
                                </CardDescription>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-6">
                              <Alert className="bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                <AlertTitle>Tip</AlertTitle>
                                <AlertDescription>
                                  This suffix will automatically append UTM tags to every ad click, so you only set it once.
                                </AlertDescription>
                              </Alert>

                              <div className="grid gap-6 md:grid-cols-2">
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                      1
                                    </span>
                                    Step-by-step configuration
                                  </div>
                                  <ol className="space-y-2 text-sm text-muted">
                                    <li>Log in to your Google Ads account.</li>
                                    <li>Open Admin (gear icon) &gt; Account settings.</li>
                                    <li>Expand the Tracking section.</li>
                                    <li>Paste the Final URL suffix string.</li>
                                    <li>Save changes.</li>
                                  </ol>
                                </div>

                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                      2
                                    </span>
                                    The string to paste
                                  </div>
                                  <div className="relative rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-200 font-mono break-all">
                                    utm_source=google&utm_medium=cpc&utm_campaign={'{campaignid}'}&utm_content={'{adgroupid}'}&utm_term={'{keyword}'}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => void copyName("utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}&utm_term={keyword}", "tracking-string")}
                                      className="absolute right-3 top-3 h-7 w-7 p-0 text-slate-200 hover:bg-slate-800"
                                      title="Copy to clipboard"
                                    >
                                      {copiedName === "tracking-string" ? (
                                        <CheckIcon className="h-4 w-4 text-green-300" />
                                      ) : (
                                        <ClipboardIcon className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </div>
                                  <p className="text-xs text-muted">
                                    This string auto-inserts the campaign ID, ad group ID, and keyword that triggered the ad.
                                  </p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </TabsContent>
                      </div>

                      <aside className="space-y-4 lg:sticky lg:top-24">
                        <Card>
                          <CardHeader className="space-y-1">
                            <CardTitle className="text-base">Quick Reference</CardTitle>
                            <CardDescription>Keep these guardrails visible while you work.</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4 text-sm">
                            <div className="space-y-2">
                              <p className="text-xs uppercase tracking-wide text-muted">Targets</p>
                              <div className="flex items-center justify-between">
                                <span>Target CPL</span>
                                <span className="font-semibold text-slate-900 dark:text-white">
                                  {formatCurrency(optimizationPlaybook.Metrics_Benchmarks.Target_CPL_MYR)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Max CPL</span>
                                <span className="font-semibold text-slate-900 dark:text-white">
                                  {formatCurrency(optimizationPlaybook.Metrics_Benchmarks.Max_CPL_Ceiling_MYR)}
                                </span>
                              </div>
                            </div>
                            <Separator />
                            <div className="space-y-2">
                              <p className="text-xs uppercase tracking-wide text-muted">Review cadence</p>
                              <div className="flex flex-wrap gap-2">
                                {playbookFrequencies.length ? (
                                  playbookFrequencies.map((frequency) => (
                                    <Badge key={frequency} variant="secondary">
                                      {frequency}
                                    </Badge>
                                  ))
                                ) : (
                                  <Badge variant="secondary">Not set</Badge>
                                )}
                              </div>
                            </div>
                            <Separator />
                            <div className="space-y-2">
                              <p className="text-xs uppercase tracking-wide text-muted">Rules count</p>
                              <div className="flex items-center justify-between">
                                <span>Total rules</span>
                                <Badge variant="info">{optimizationPlaybook.Rules_Of_Engagement.length}</Badge>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </aside>
                    </div>
                  </Tabs>
                )}
              </section>
        </TabsContent>
      </Tabs>

          </div>
        </main>
      );
    }
function TableCard({
  title,
  children,
  note,
  onExport,
  onExportExcel,
  defaultCollapsed = false,
}: {
  title: string;
  children: ReactNode;
  note?: string;
  onExport?: () => void;
  onExportExcel?: () => void;
  defaultCollapsed?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(!defaultCollapsed);
  const toggleOpen = () => setIsOpen((prev) => !prev);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleOpen();
    }
  };
  return (
    <Card className="group transition-shadow hover:shadow-md">
      <CardHeader
        className="gap-2 sm:flex-row sm:items-center sm:justify-between cursor-pointer select-none transition-colors group-hover:bg-slate-50 dark:group-hover:bg-slate-900/40"
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
      >
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {note && <CardDescription>{note}</CardDescription>}
        </div>
        <div className="flex items-center gap-2">
          {onExport && (
            <Button
              variant="outline"
              size="sm"
              className="shadow-sm hover:bg-slate-200/70 dark:hover:bg-slate-700/60"
              onClick={(event) => {
                event.stopPropagation();
                onExport();
              }}
            >
              CSV
            </Button>
          )}
          {onExportExcel && (
            <Button
              variant="success"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onExportExcel();
              }}
            >
              Excel
            </Button>
          )}
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full border border-default bg-surface text-muted shadow-sm"
            title={isOpen ? "Click to collapse" : "Click to expand"}
          >
            <svg
              className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </CardHeader>
      {isOpen ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}

function CampaignSettingsPanel({ campaign, onClose }: { campaign: CampaignPlan; onClose: () => void }) {
  const { BiddingLifecycle, AdSchedule, NegativeKeywords } = campaign;
  const [copiedNegatives, setCopiedNegatives] = useState(false);

  const copyNegativeKeywords = async () => {
    if (!NegativeKeywords) return;
    const text = NegativeKeywords.map((kw) => {
      if (kw.MatchType === "Exact") return `[${kw.Keyword}]`;
      if (kw.MatchType === "Phrase") return `"${kw.Keyword}"`;
      return kw.Keyword;
    }).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedNegatives(true);
      setTimeout(() => setCopiedNegatives(false), 2000);
    } catch (err) {
      console.error("Failed to copy negatives", err);
    }
  };

  const dayMap = useMemo<Record<string, number>>(
    () => ({
      Monday: 0,
      Tuesday: 1,
      Wednesday: 2,
      Thursday: 3,
      Friday: 4,
      Saturday: 5,
      Sunday: 6,
    }),
    [],
  );
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Grid data: 7 rows x 24 cols. Store bid adj percent or null if not active.
  const scheduleGrid = useMemo(() => {
    const grid: Array<Array<{ active: boolean; bidAdj: number }>> = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ active: false, bidAdj: 0 })),
    );

    if (!AdSchedule) return grid;

    AdSchedule.forEach((entry) => {
      const dayIdx = dayMap[entry.DayOfWeek];
      if (dayIdx === undefined) return;

      const startHour = parseInt(entry.StartTime.split(":")[0], 10);
      let endHour = parseInt(entry.EndTime.split(":")[0], 10);
      if (endHour === 0 && entry.EndTime !== "00:00") endHour = 24; // Handle 23:00-00:00 as end of day

      for (let h = startHour; h < endHour; h++) {
        if (h >= 0 && h < 24) {
          grid[dayIdx][h] = { active: true, bidAdj: entry.BidAdjustmentPercent };
        }
      }
    });
    return grid;
  }, [AdSchedule, dayMap]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted">Campaign Settings</div>
          <div className="font-semibold text-lg">{campaign.CampaignName}</div>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="space-y-3">
        <div className="font-medium border-b pb-1">Location Targeting</div>
        <div className="text-sm space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-muted">Method:</span>
            <span className="font-medium px-2 py-0.5 rounded bg-purple-50 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200">
              {campaign.Location?.TargetingMethod || "—"}
            </span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border border-default rounded bg-surface-muted p-2">
              <div className="text-xs font-semibold text-muted mb-2">Included ({campaign.Location?.Included?.length ?? 0})</div>
              {campaign.Location?.Included?.length ? (
                <ul className="list-disc list-inside space-y-1 text-muted">
                  {campaign.Location.Included.map((loc, i) => (
                    <li key={i}>
                      {loc.Name}
                      {typeof loc.RadiusKm === "number" && (
                        <span className="text-muted ml-1">({loc.RadiusKm} km)</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-muted italic">None</div>
              )}
            </div>
            
            <div className="border rounded bg-red-50 p-2 dark:bg-red-900/10 dark:border-red-900/30">
              <div className="text-xs font-semibold text-red-700 mb-2 dark:text-red-300">Excluded ({campaign.Location?.Excluded?.length ?? 0})</div>
              {campaign.Location?.Excluded?.length ? (
                <ul className="list-disc list-inside space-y-1 text-red-800 dark:text-red-200">
                  {campaign.Location.Excluded.map((loc, i) => (
                    <li key={i}>{loc}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-red-400 italic">None</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="font-medium border-b pb-1">Bidding Strategy</div>
        {BiddingLifecycle ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            {BiddingLifecycle.Phase1_Launch && (
              <div className="bg-blue-50 p-3 rounded border border-blue-100 dark:bg-blue-900/30 dark:border-blue-800">
                <div className="font-medium text-blue-800 dark:text-blue-200 mb-1">Phase 1: Launch</div>
                <div className="text-gray-700 dark:text-blue-100">
                  {BiddingLifecycle.Phase1_Launch.StrategyType}
                </div>
                {BiddingLifecycle.Phase1_Launch.MaxCPC_Cap_MYR && (
                  <div className="text-xs text-gray-500 dark:text-blue-300">
                    Cap: {formatCurrency(BiddingLifecycle.Phase1_Launch.MaxCPC_Cap_MYR)}
                  </div>
                )}
              </div>
            )}
            {BiddingLifecycle.Switch_Condition && (
              <div className="bg-surface-muted p-3 rounded border border-default flex flex-col justify-center items-center text-center">
                <div className="text-xs text-muted uppercase tracking-wide mb-1">Switch Condition</div>
                <div className="font-medium">
                  {BiddingLifecycle.Switch_Condition.Metric} &ge; {BiddingLifecycle.Switch_Condition.Threshold}
                </div>
              </div>
            )}
            {BiddingLifecycle.Phase2_Scale && (
              <div className="bg-green-50 p-3 rounded border border-green-100 dark:bg-green-900/30 dark:border-green-800">
                <div className="font-medium text-green-800 dark:text-green-200 mb-1">Phase 2: Scale</div>
                <div className="text-gray-700 dark:text-green-100">
                  {BiddingLifecycle.Phase2_Scale.StrategyType}
                </div>
                {BiddingLifecycle.Phase2_Scale.TargetCPA_MYR && (
                  <div className="text-xs text-gray-500 dark:text-green-300">
                    tCPA: {formatCurrency(BiddingLifecycle.Phase2_Scale.TargetCPA_MYR)}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted">No bidding lifecycle data.</div>
        )}
      </div>

      <div className="space-y-3">
        <div className="font-medium border-b pb-1 flex items-center justify-between">
          <span>Ad Schedule (Dayparting)</span>
          <div className="flex items-center gap-2 text-xs font-normal">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-slate-200 border border-default rounded-sm dark:bg-slate-700"></span> 0%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-200 border border-default rounded-sm dark:bg-green-900/60"></span> +Adj</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-200 border border-default rounded-sm dark:bg-red-900/60"></span> -Adj</span>
          </div>
        </div>
        {AdSchedule && AdSchedule.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="flex">
                <div className="w-10"></div>
                {hours.map((h) => (
                  <div key={h} className="flex-1 text-center text-[10px] text-muted border-l border-transparent">
                    {h}
                  </div>
                ))}
              </div>
              {days.map((day, dIdx) => (
                <div key={day} className="flex items-center h-8 text-xs">
                  <div className="w-10 font-medium text-muted">{day}</div>
                  {hours.map((h) => {
                    const cell = scheduleGrid[dIdx][h];
                    let bgClass = "bg-transparent";
                    if (cell.active) {
                      if (cell.bidAdj > 0) bgClass = "bg-green-200 dark:bg-green-900/60 text-green-800 dark:text-green-200";
                      else if (cell.bidAdj < 0) bgClass = "bg-red-200 dark:bg-red-900/60 text-red-800 dark:text-red-200";
                      else bgClass = "bg-blue-100 dark:bg-blue-800";
                    } else {
                      bgClass = "bg-gray-50 dark:bg-slate-800/50";
                    }

                    return (
                      <div
                        key={h}
                        className={`flex-1 h-full border border-white dark:border-slate-900 flex items-center justify-center ${bgClass}`}
                        title={`${day} ${h}:00 - ${cell.active ? (cell.bidAdj !== 0 ? `${cell.bidAdj > 0 ? "+" : ""}${cell.bidAdj}%` : "Active") : "Inactive"}`}
                      >
                        {cell.active && cell.bidAdj !== 0 && (
                          <span className="text-[10px] font-bold leading-none">
                            {cell.bidAdj > 0 ? "+" : ""}
                            {cell.bidAdj}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted">No ad schedule defined.</div>
        )}
      </div>

      <div className="space-y-3">
        <div className="font-medium border-b pb-1 flex items-center justify-between">
          <span>Negative Keywords ({NegativeKeywords?.length ?? 0})</span>
          {NegativeKeywords && NegativeKeywords.length > 0 && (
            <button
              onClick={() => void copyNegativeKeywords()}
              className="text-xs px-2 py-1 border border-default rounded transition hover:bg-slate-200 hover:shadow-sm hover:-translate-y-0.5 dark:hover:bg-slate-700 flex items-center gap-1"
            >
              {copiedNegatives ? <CheckIcon className="w-3 h-3 text-green-600" /> : <ClipboardIcon className="w-3 h-3" />}
              {copiedNegatives ? "Copied!" : "Copy All to Clipboard"}
            </button>
          )}
        </div>
        {NegativeKeywords && NegativeKeywords.length > 0 ? (
          <div className="max-h-60 overflow-y-auto border border-default rounded bg-surface-muted p-2">
            <div className="flex flex-wrap gap-2">
              {NegativeKeywords.map((kw, i) => (
                <span
                  key={i}
                  className="px-2 py-1 bg-surface border border-default rounded text-xs text-muted"
                >
                  {kw.Keyword} <span className="text-muted">({kw.MatchType})</span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted">No negative keywords.</div>
        )}
      </div>
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
  const [tab, setTab] = useState<"ads" | "keywords">("ads");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [keywordText, setKeywordText] = useState("");

  const markCopied = (key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1200);
  };

  const ads = Array.isArray(adGroup?.ResponsiveSearchAds) ? adGroup.ResponsiveSearchAds ?? [] : [];
  const keywords = keywordList(targeting, false);
  const keywordAverages = computeKeywordAverages(keywords);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const formatKw = (kw: CampaignPlanKeyword) => {
      const raw = kw.Keyword.trim();
      const match = kw.MatchType?.toLowerCase() ?? "";
      if (match.includes("exact")) {
        return raw.startsWith("[") && raw.endsWith("]") ? raw : `[${raw}]`;
      }
      if (match.includes("phrase")) {
        return raw.startsWith('"') && raw.endsWith('"') ? raw : `"${raw}"`;
      }
      return raw;
    };
    setKeywordText(keywords.map(formatKw).join("\n"));
  }, [keywords]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!adGroup) {
    return <div className="text-sm text-muted">Select an ad group to view ads and keywords.</div>;
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

  const getCharCount = (
    text: string,
    meta: NonNullable<CampaignPlanAdGroup["ResponsiveSearchAds"]>[number]["HeadlinesMeta"] | undefined,
    index: number,
  ) => {
    const entry = meta?.[index];
    if (entry && entry.Text === text && Number.isFinite(entry.CharCount)) {
      return entry.CharCount;
    }
    return text.length;
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          className={`px-3 py-1 rounded border border-default transition ${
            tab === "ads"
              ? "bg-blue-600 text-white hover:bg-blue-700 hover:border-blue-600 dark:hover:bg-blue-500"
              : "bg-surface text-body hover:border-blue-400 hover:bg-blue-200/70 hover:text-blue-900 dark:hover:border-blue-400 dark:hover:bg-blue-800/40"
          }`}
          onClick={() => setTab("ads")}
        >
          Ads ({ads.length})
        </button>
        <button
          className={`px-3 py-1 rounded border border-default transition ${
            tab === "keywords"
              ? "bg-blue-600 text-white hover:bg-blue-700 hover:border-blue-600 dark:hover:bg-blue-500"
              : "bg-surface text-body hover:border-blue-400 hover:bg-blue-200/70 hover:text-blue-900 dark:hover:border-blue-400 dark:hover:bg-blue-800/40"
          }`}
          onClick={() => setTab("keywords")}
        >
          Keywords ({keywords.length})
        </button>
      </div>

      {tab === "ads" && (
        <div className="space-y-3">
          {ads.map((ad, idx) => (
            <div key={idx} className="border border-default rounded p-4 bg-surface space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-sm">Responsive Search Ad {idx + 1}</div>
                <button
                  type="button"
                  className={`${copyButtonClass} ${
                    copiedKey === `ad-${idx}`
                      ? "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-200 dark:border-green-700"
                      : ""
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
                  <div className="text-xs text-muted mb-2 uppercase tracking-wide">Headlines</div>
                  <ol className="list-decimal list-inside text-sm space-y-2">
                  {ad.Headlines.map((headline, hIdx) => {
                    const charCount = getCharCount(headline, ad.HeadlinesMeta, hIdx);
                    return (
                      <li key={hIdx} className="flex items-start gap-2 py-1">
                        <span className="flex-1">{headline}</span>
                        <span className="text-xs text-muted tabular-nums whitespace-nowrap">{charCount} chars</span>
                        <button
                          type="button"
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100 transition hover:bg-slate-300 dark:hover:bg-slate-700 ${
                            copiedKey === `headline-${idx}-${hIdx}` ? "text-green-700 dark:text-green-300" : ""
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
                    );
                  })}
                </ol>
              </div>
                <div>
                  <div className="text-xs text-muted mb-2 uppercase tracking-wide">Descriptions</div>
                  <ol className="list-decimal list-inside text-sm space-y-2">
                  {ad.Descriptions.map((desc, dIdx) => {
                    const charCount = getCharCount(desc, ad.DescriptionsMeta, dIdx);
                    return (
                      <li key={dIdx} className="flex items-start gap-2 py-1">
                        <span className="flex-1">{desc}</span>
                        <span className="text-xs text-muted tabular-nums whitespace-nowrap">{charCount} chars</span>
                        <button
                          type="button"
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100 transition hover:bg-slate-300 dark:hover:bg-slate-700 ${
                            copiedKey === `desc-${idx}-${dIdx}` ? "text-green-700 dark:text-green-300" : ""
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
                    );
                  })}
                </ol>
              </div>
              </div>
            </div>
          ))}
          {ads.length === 0 && <div className="text-sm text-muted">No ads in this ad group.</div>}
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
                <tr key={idx} className="odd:bg-gray-50 dark:odd:bg-slate-900/40">
                  <td className="px-2 py-1">{kw.Keyword}</td>
                  <td className="px-2 py-1">{kw.MatchType}</td>
                  <td className="px-2 py-1">{formatNumber(kw.AvgMonthlySearches ?? null)}</td>
                  <td className="px-2 py-1">{formatCpc(kw.CPC ?? null)}</td>
                  <td className="px-2 py-1">{kw.CompetitionIndex ?? "—"}</td>
                </tr>
              ))}
              {keywords.length === 0 && (
                <tr>
                  <td className="px-2 py-1 text-sm text-muted" colSpan={5}>
                    No keywords available.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 font-medium dark:bg-blue-900/30 dark:text-blue-100">
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
            <div className="flex items-center justify-between text-xs text-muted">
              <span>All keywords (comma separated, formatted by match type)</span>
              <button
                type="button"
                className={`flex items-center gap-1 px-2 py-1 border border-default rounded transition hover:bg-slate-200 hover:shadow-sm hover:-translate-y-0.5 dark:hover:bg-slate-700 ${
                  copiedKey === "keywords"
                    ? "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-200 dark:border-green-700"
                    : ""
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
            <Textarea
              className="text-sm"
              rows={3}
              value={keywordText}
              onChange={(e) => setKeywordText(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function CampaignVisualizerPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading visualizer...</div>}>
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
