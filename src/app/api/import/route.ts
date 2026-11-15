import { NextRequest, NextResponse } from "next/server";
import { parseImport } from "@/lib/parser";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson;
  const { text } = raw as { text?: string };
  if (!text?.trim())
    return NextResponse.json({ error: "Kein Text" }, { status: 400 });
  const preview = parseImport(text);
  if (preview.length === 0)
    return NextResponse.json(
      { error: "Keine Rezepte erkannt — Blöcke bitte mit --- trennen" },
      { status: 400 }
    );
  return NextResponse.json({ preview });
}
