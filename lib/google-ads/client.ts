import { GoogleAdsApi } from "google-ads-api";

function normalizeCustomerId(value: string): string {
  return value.replace(/-/g, "").trim();
}

export function getGoogleAdsCustomer(params: {
  customerId: string;
  loginCustomerId?: string | null;
  refreshToken: string;
}) {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!developerToken) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is not configured.");
  }
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET are not configured.");
  }
  const api = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });

  const customerId = normalizeCustomerId(params.customerId);
  const loginCustomerId = params.loginCustomerId ? normalizeCustomerId(params.loginCustomerId) : undefined;

  return api.Customer({
    customer_id: customerId,
    login_customer_id: loginCustomerId,
    refresh_token: params.refreshToken,
  });
}
