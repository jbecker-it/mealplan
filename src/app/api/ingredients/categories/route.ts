import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

// POST {updates:[{id, category}]} → mehrere Kategorien auf einmal setzen
// (vom Nutzer bestätigte REWE-Vorschläge).
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson();
  const list = Array.isArray(raw.updates) ? (raw.updates as Array<{ id?: unknown; category?: unknown }>) : [];
  const updates = list
    .map((u) => ({ id: Number(u?.id), category: typeof u?.category === "string" ? u.category.trim() : "" }))
    .filter((u) => Number.isInteger(u.id) && u.id > 0 && u.category);
  if (!updates.length) return NextResponse.json({ error: "Keine Änderungen" }, { status: 400 });
  const up = db.prepare("UPDATE ingredient SET category = ? WHERE id = ?");
  let changed = 0;
  db.transaction(() => {
    for (const u of updates) changed += up.run(u.category, u.id).changes;
  })();
  return NextResponse.json({ ok: true, changed });
}
