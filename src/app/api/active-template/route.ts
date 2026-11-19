import { NextRequest, NextResponse } from "next/server";
import { getActiveTemplate, setActiveTemplate } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

// Aktives Template (A/B) — NICHT mehr wochenabhängig (2026-11-19).
// GET  → { template }
// POST → { template: "A" | "B" }
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return NextResponse.json({ template: getActiveTemplate() });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await readJson(req);
  if (body === null) return badJson;
  const t = (body as { template?: string }).template;
  if (t !== "A" && t !== "B")
    return NextResponse.json({ error: "template muss „A“ oder „B“ sein" }, { status: 400 });
  setActiveTemplate(t);
  return NextResponse.json({
    ok: true,
    template: t,
    note: `Template ${t} ist jetzt aktiv — Plan und Einkaufsliste zeigen es.`,
  });
}
