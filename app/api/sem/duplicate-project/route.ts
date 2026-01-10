import { NextResponse } from "next/server";
import { normalizeProjectInitInput, persistProjectInitInput } from "@/lib/sem/input";
import { duplicateOutputProject } from "@/lib/storage/project-files";
import { ProjectInitInput } from "@/types/sem";

type DuplicateRequest = {
  sourceProjectId?: string;
  targetProjectId?: string;
  inputOverride?: ProjectInitInput;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as DuplicateRequest;
    const sourceProjectId = typeof body.sourceProjectId === "string" ? body.sourceProjectId.trim() : "";
    const targetProjectId = typeof body.targetProjectId === "string" ? body.targetProjectId.trim() : "";

    if (!sourceProjectId || !targetProjectId) {
      return NextResponse.json({ error: "sourceProjectId and targetProjectId are required" }, { status: 400 });
    }

    const inputOverride =
      body.inputOverride && typeof body.inputOverride === "object" ? (body.inputOverride as ProjectInitInput) : null;
    if (body.inputOverride && !inputOverride) {
      return NextResponse.json({ error: "inputOverride must be an object" }, { status: 400 });
    }
    const normalizedInput = inputOverride ? normalizeProjectInitInput(inputOverride) : null;

    const result = await duplicateOutputProject(sourceProjectId, targetProjectId);

    if (inputOverride && normalizedInput) {
      await persistProjectInitInput(targetProjectId, inputOverride, normalizedInput);
    }

    return NextResponse.json({ projectId: targetProjectId, copied: result.copied });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to duplicate project";
    const lower = message.toLowerCase();
    const isBadRequest =
      lower.includes("required") ||
      lower.includes("invalid") ||
      lower.includes("source project") ||
      lower.includes("target project");
    return NextResponse.json({ error: message }, { status: isBadRequest ? 400 : 500 });
  }
}
