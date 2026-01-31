import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getGoogleAdsCustomer } from "@/lib/google-ads/client";
import { publishCampaignPlan } from "@/lib/google-ads/publish";
import { readProjectJson } from "@/lib/storage/project-files";
import { decryptToken } from "@/lib/security/token-crypto";
import { CampaignPlan, CampaignPlanPayload } from "@/types/sem";

const REFRESH_COOKIE = "google_ads_refresh";
const DEFAULT_PLAN_FILE = "11-campaign-plan-enriched.json";

function normalizeCampaigns(input: unknown): CampaignPlan[] {
  if (Array.isArray(input)) return input as CampaignPlan[];
  const payload = input as CampaignPlanPayload;
  if (Array.isArray(payload?.Campaigns)) return payload.Campaigns;
  return [];
}

export async function POST(req: Request) {
  try {
    const { projectId, campaigns, customerId, loginCustomerId, finalUrl, fileName, clearTokenOnSuccess } =
      (await req.json()) as {
        projectId?: string;
        campaigns?: CampaignPlan[];
        customerId?: string;
        loginCustomerId?: string;
        finalUrl?: string;
        fileName?: string;
        clearTokenOnSuccess?: boolean;
      };

    if (!customerId) {
      return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    }
    if (!finalUrl) {
      return NextResponse.json({ error: "finalUrl is required" }, { status: 400 });
    }

    let campaignPayload = campaigns;
    if (!Array.isArray(campaignPayload) || campaignPayload.length === 0) {
      if (!projectId) {
        return NextResponse.json({ error: "projectId is required when campaigns are not provided" }, { status: 400 });
      }
      const targetFile = fileName ?? DEFAULT_PLAN_FILE;
      const stored = await readProjectJson<CampaignPlanPayload | CampaignPlan[]>(projectId, targetFile);
      campaignPayload = normalizeCampaigns(stored);
    }

    if (!campaignPayload.length) {
      return NextResponse.json({ error: "No campaigns to publish" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const refreshCookie = cookieStore.get(REFRESH_COOKIE)?.value;
    const refreshToken = refreshCookie ? decryptToken(refreshCookie) : null;
    if (!refreshToken) {
      return NextResponse.json({ error: "No Google Ads refresh token found. Reconnect Google Ads." }, { status: 401 });
    }

    const customer = getGoogleAdsCustomer({
      customerId,
      loginCustomerId,
      refreshToken,
    });

    const result = await publishCampaignPlan({
      customer,
      campaigns: campaignPayload,
      finalUrl,
    });

    const response = NextResponse.json(result);
    if (clearTokenOnSuccess !== false) {
      response.cookies.set({ name: REFRESH_COOKIE, value: "", maxAge: 0, path: "/" });
    }
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Google Ads publish failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
