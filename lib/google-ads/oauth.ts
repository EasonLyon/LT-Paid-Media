import crypto from "crypto";

const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  tokenType?: string;
};

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function generatePkceVerifier(): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

export function generatePkceChallenge(verifier: string): string {
  const digest = crypto.createHash("sha256").update(verifier).digest();
  return base64UrlEncode(digest);
}

export function generateOAuthState(): string {
  return base64UrlEncode(crypto.randomBytes(16));
}

export function buildGoogleAdsAuthUrl(params: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured.");
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_ADS_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeAuthCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<OAuthTokens> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET are not configured.");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: params.code,
    code_verifier: params.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as OAuthTokenResponse;
  if (!res.ok || json.error) {
    const message = json.error_description ?? json.error ?? "OAuth token exchange failed.";
    throw new Error(message);
  }
  if (!json.access_token) {
    throw new Error("OAuth response missing access_token.");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    scope: json.scope,
    tokenType: json.token_type,
  };
}
