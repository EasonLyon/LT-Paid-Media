import { NextResponse } from "next/server";
import { previewNextProjectId } from "@/lib/sem/input";

export async function GET() {
  try {
    const suggested = await previewNextProjectId();
    return NextResponse.json({ suggested });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
