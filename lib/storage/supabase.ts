import { requireSupabase } from "@/lib/supabase/client";

const bucketName = process.env.SUPABASE_STORAGE_BUCKET;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET ?? process.env.SUPABASE_ANON_KEY;

export const isSupabaseStorageEnabled = Boolean(process.env.SUPABASE_URL && supabaseKey && bucketName);

export function getSupabaseStorage() {
  if (!isSupabaseStorageEnabled || !bucketName) {
    throw new Error("Supabase storage is not configured. Missing env vars.");
  }
  return { client: requireSupabase(), bucket: bucketName };
}
