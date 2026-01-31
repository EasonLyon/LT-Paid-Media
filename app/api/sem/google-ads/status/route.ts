import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { decryptToken } from "@/lib/security/token-crypto";

const REFRESH_COOKIE = "google_ads_refresh";

export async function GET() {
  const cookieStore = await cookies();
  const encrypted = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!encrypted) {
    return NextResponse.json({ connected: false });
  }
  const decoded = decryptToken(encrypted);
  if (!decoded) {
    return NextResponse.json({ connected: false });
  }
  return NextResponse.json({ connected: true });
}
