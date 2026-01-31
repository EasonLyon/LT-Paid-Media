import { NextResponse } from "next/server";
import { buildGoogleAdsAuthUrl, generateOAuthState, generatePkceChallenge, generatePkceVerifier } from "@/lib/google-ads/oauth";
import { encryptToken } from "@/lib/security/token-crypto";

const OAUTH_COOKIE = "google_ads_oauth";
const MAX_AGE_SECONDS = 10 * 60;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const returnTo = url.searchParams.get("returnTo") ?? "/sem/visualizer";
    const redirectUri = `${url.origin}/api/sem/google-ads/auth/callback`;

    const codeVerifier = generatePkceVerifier();
    const codeChallenge = generatePkceChallenge(codeVerifier);
    const state = generateOAuthState();
    const authUrl = buildGoogleAdsAuthUrl({ redirectUri, state, codeChallenge });

    const cookiePayload = encryptToken(JSON.stringify({ codeVerifier, state, returnTo }));
    const response = NextResponse.json({ authUrl });
    response.cookies.set({
      name: OAUTH_COOKIE,
      value: cookiePayload,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: MAX_AGE_SECONDS,
      path: "/",
    });
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to start OAuth flow.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
