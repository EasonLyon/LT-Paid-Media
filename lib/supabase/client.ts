import { createClient, SupabaseClient } from "@supabase/supabase-js";

function buildClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn("[supabase] missing SUPABASE_URL or key env vars");
    return null;
  }
  return createClient(url, key);
}

export const supabaseAdmin = buildClient();

export function requireSupabase(): SupabaseClient {
  if (!supabaseAdmin) {
    throw new Error("Supabase client not configured");
  }
  return supabaseAdmin;
}
