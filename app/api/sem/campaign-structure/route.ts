import { NextResponse } from "next/server";
import { buildCampaignStructure } from "@/lib/sem/campaign-structure";
import { CampaignStructureRow, Tier } from "@/types/sem";

type TierInput = Tier | string;

function parseTierValue(value: TierInput): Tier | null {
  if (value === "A" || value === "B" || value === "C") return value;
  const upper = typeof value === "string" ? value.toUpperCase() : "";
  if (upper === "A" || upper === "B" || upper === "C") return upper as Tier;
  return null;
}

function parseTiers(input: unknown): Tier[] {
  if (Array.isArray(input)) {
    return input
      .map((value) => parseTierValue(value as TierInput))
      .filter((value): value is Tier => value !== null);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((value) => parseTierValue(value.trim()))
      .filter((value): value is Tier => value !== null);
  }
  const single = parseTierValue(input as TierInput);
  return single ? [single] : [];
}

function parseBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return null;
}

function parseBooleanList(input: unknown): boolean[] {
  if (Array.isArray(input)) {
    return input
      .map((value) => parseBooleanValue(value))
      .filter((value): value is boolean => value !== null);
  }
  const single = parseBooleanValue(input);
  return single === null ? [] : [single];
}

export async function POST(req: Request) {
  try {
    const { projectId, tiers, paidFlags, seoFlags } = (await req.json()) as {
      projectId?: string;
      tiers?: Tier[] | string[];
      paidFlags?: Array<boolean | string>;
      seoFlags?: Array<boolean | string>;
    };

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const result = await buildCampaignStructure(projectId, {
      tiers: parseTiers(tiers),
      paidFlags: parseBooleanList(paidFlags),
      seoFlags: parseBooleanList(seoFlags),
    });

    return NextResponse.json({
      totalRows: result.totalRows,
      previewRows: result.previewRows satisfies CampaignStructureRow[],
      fileName: result.fileName,
    });
  } catch (error: unknown) {
    console.error("[Step7] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const tiersParam = url.searchParams.get("tiers");
    const paidParam = url.searchParams.get("paidFlags");
    const seoParam = url.searchParams.get("seoFlags");

    const tiers = parseTiers(tiersParam);
    const paidFlags = parseBooleanList(paidParam ? paidParam.split(",") : []);
    const seoFlags = parseBooleanList(seoParam ? seoParam.split(",") : []);

    const result = await buildCampaignStructure(projectId, { tiers, paidFlags, seoFlags });
    const headers = new Headers({
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="${result.fileName}"`,
    });
    return new NextResponse(result.csv, { status: 200, headers });
  } catch (error: unknown) {
    console.error("[Step7] download failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
