import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { SnapRow, snapshot, writeTemplate } from "@/lib/plan";

// Verlauf früherer Template-Stände (plan_snapshot).
// GET    → Liste (neueste zuerst) mit Rezept-Titeln je Slot
// POST   → { id, template: "A"|"B" } Stand als Template wiederherstellen
//          (der aktuelle Stand des Ziel-Templates wird vorher gesichert)
// DELETE → { id } Eintrag löschen
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const snaps = db
    .prepare("SELECT id, label, template_id, rows_json, created_at FROM plan_snapshot ORDER BY id DESC")
    .all() as Array<{ id: number; label: string; template_id: string; rows_json: string; created_at: string }>;
  const titles = new Map(
    (db.prepare("SELECT id, title FROM recipe").all() as Array<{ id: number; title: string }>).map((r) => [
      Number(r.id),
      r.title,
    ])
  );
  const profiles = db.prepare("SELECT id, name FROM profile ORDER BY id").all() as Array<{ id: number; name: string }>;
  return NextResponse.json({
    profiles,
    items: snaps.map((s) => {
      let rows: SnapRow[] = [];
      try {
        rows = JSON.parse(s.rows_json) as SnapRow[];
      } catch {
        // kaputt → leer
      }
      return {
        id: s.id,
        label: s.label,
        template: s.template_id,
        created_at: s.created_at,
        meals: rows.map((r) => ({
          profile_id: r.profile_id,
          slot: r.slot,
          servings: r.servings,
          title: titles.get(Number(r.recipe_id)) ?? "(Rezept gelöscht)",
        })),
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await readJson(req);
  if (body === null) return badJson();
  const id = Number(body.id);
  const tpl = body.template === "A" || body.template === "B" ? body.template : null;
  if (!id || !tpl) return NextResponse.json({ error: "id und template (A/B) nötig" }, { status: 400 });
  const snap = db.prepare("SELECT label, rows_json FROM plan_snapshot WHERE id = ?").get(id) as
    | { label: string; rows_json: string }
    | undefined;
  if (!snap) return NextResponse.json({ error: "Eintrag nicht gefunden" }, { status: 404 });
  let rows: SnapRow[];
  try {
    rows = JSON.parse(snap.rows_json) as SnapRow[];
  } catch {
    return NextResponse.json({ error: "Eintrag ist beschädigt" }, { status: 400 });
  }
  let n = 0;
  db.transaction(() => {
    snapshot(tpl, `Template ${tpl} vor Wiederherstellung`);
    n = writeTemplate(tpl, rows);
  })();
  if (n === 0)
    return NextResponse.json({ error: "Keine gültigen Mahlzeiten (Rezepte gelöscht?)" }, { status: 400 });
  return NextResponse.json({
    ok: true,
    note: `„${snap.label}“ als Template ${tpl} wiederhergestellt. Der vorherige Stand liegt im Verlauf.`,
  });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await readJson(req);
  if (body === null) return badJson();
  db.prepare("DELETE FROM plan_snapshot WHERE id = ?").run(Number(body.id));
  return NextResponse.json({ ok: true });
}
