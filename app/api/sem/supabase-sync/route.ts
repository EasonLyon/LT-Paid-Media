import { NextResponse } from "next/server";
import { runSupabaseSync } from "@/lib/sem/supabase-sync";

export async function POST(req: Request) {
  try {
    console.log("[Step6] start");
    const { projectId } = await req.json();
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const result = await runSupabaseSync(projectId);
    console.log("[Step6] complete");
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("[Step6] failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
