import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeAuthCode } from "@/lib/google-ads/oauth";
import { decryptToken, encryptToken } from "@/lib/security/token-crypto";

const OAUTH_COOKIE = "google_ads_oauth";
const REFRESH_COOKIE = "google_ads_refresh";
const REFRESH_MAX_AGE_SECONDS = 60 * 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieStore = await cookies();
  const oauthCookie = cookieStore.get(OAUTH_COOKIE)?.value;
  const parsed = oauthCookie ? decryptToken(oauthCookie) : null;
  const payload = parsed ? (JSON.parse(parsed) as { codeVerifier?: string; state?: string; returnTo?: string }) : null;

  const returnTo = payload?.returnTo ?? "/sem/visualizer";

  if (!code || !state || !payload?.codeVerifier || state !== payload.state) {
    const failureUrl = new URL(returnTo, url.origin);
    failureUrl.searchParams.set("googleAds", "error");
    const response = NextResponse.redirect(failureUrl);
    response.cookies.set({ name: OAUTH_COOKIE, value: "", maxAge: 0, path: "/" });
    return response;
  }

  try {
    const redirectUri = `${url.origin}/api/sem/google-ads/auth/callback`;
    const tokens = await exchangeAuthCode({ code, codeVerifier: payload.codeVerifier, redirectUri });
    if (!tokens.refreshToken) {
      throw new Error("No refresh token returned. Ensure consent prompt is shown.");
    }

    const refreshPayload = encryptToken(tokens.refreshToken);
    const successUrl = new URL(returnTo, url.origin);
    successUrl.searchParams.set("googleAds", "connected");
    const response = NextResponse.redirect(successUrl);
    response.cookies.set({
      name: REFRESH_COOKIE,
      value: refreshPayload,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: REFRESH_MAX_AGE_SECONDS,
      path: "/",
    });
    response.cookies.set({ name: OAUTH_COOKIE, value: "", maxAge: 0, path: "/" });
    return response;
  } catch {
    const failureUrl = new URL(returnTo, url.origin);
    failureUrl.searchParams.set("googleAds", "error");
    const response = NextResponse.redirect(failureUrl);
    response.cookies.set({ name: OAUTH_COOKIE, value: "", maxAge: 0, path: "/" });
    return response;
  }
}
