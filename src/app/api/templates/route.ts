import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { currentWeekKey } from "@/lib/week";

// Vorlagen (eigene Template-Vorlagen):
// GET  → Liste mit Rezept-Titeln je Slot
// POST → neue Vorlage aus dem aktuellen Plan speichern
//        {name, week?, template: "A"|"B"}

// slots_json: Slot → Profil-ID → {recipe_id, servings}
// Persönliche Slots dürfen je Profil unterschiedliche Rezepte haben;
// gemeinsame Slots (Mittag/Abend) tragen dasselbe Rezept mit je eigener Portion.
interface SlotEntry {
  recipe_id: number;
  servings: number;
}
type SlotsJson = Record<string, Record<string, SlotEntry | null>>;

interface SlotView {
  recipe_id: number;
  title?: string;
  servings: number;
}
type SlotsView = Record<string, Record<string, SlotView> | null>;

function buildSlotsJson(week: string, template: string): SlotsJson | null {
  const rows = db
    .prepare(
      `SELECT pm.profile_id, pm.slot, pm.recipe_id, pm.servings
       FROM plan_meal pm
       WHERE pm.week_key = ? AND pm.template_id = ? AND pm.day = 0`
    )
    .all(week, template) as Array<Record<string, unknown>>;
  if (rows.length === 0) return null;
  const slots: SlotsJson = { B: {}, M: {}, A: {}, S: {} };
  for (const r of rows) {
    const s = String(r.slot);
    if (!(s in slots)) continue;
    slots[s][String(r.profile_id)] = {
      recipe_id: Number(r.recipe_id),
      servings: Number(r.servings),
    };
  }
  return slots;
}

function toView(slots: SlotsJson): SlotsView {
  const out: SlotsView = { B: null, M: null, A: null, S: null };
  for (const s of ["B", "M", "A", "S"]) {
    const per = slots[s];
    if (!per) continue;
    const view: Record<string, SlotView> = {};
    for (const [pid, e] of Object.entries(per)) {
      if (!e?.recipe_id) continue;
      const rec = db
        .prepare("SELECT title FROM recipe WHERE id = ?")
        .get(e.recipe_id) as { title: string } | undefined;
      view[pid] = {
        recipe_id: e.recipe_id,
        title: rec?.title ?? "(Rezept gelöscht)",
        servings: e.servings,
      };
    }
    if (Object.keys(view).length) out[s] = view;
  }
  return out;
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const rows = db
    .prepare(
      `SELECT id, name, slots_json, created_at FROM template ORDER BY name COLLATE NOCASE`
    )
    .all() as Array<{ id: number; name: string; slots_json: string; created_at: string }>;
  const out = rows.map((r) => {
    let slots: SlotsView = { B: null, M: null, A: null, S: null };
    try {
      slots = toView(JSON.parse(r.slots_json) as SlotsJson);
    } catch {
      // kaputtes JSON → Slots bleiben leer
    }
    return { id: r.id, name: r.name, created_at: r.created_at, slots };
  });
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await readJson(req);
  if (body === null) return badJson;
  const { name, week, template } = body as {
    name?: string;
    week?: string;
    template?: string;
  };
  const nm = (name || "").trim();
  if (!nm)
    return NextResponse.json({ error: "Name fehlt" }, { status: 400 });
  if (nm.length > 60)
    return NextResponse.json({ error: "Name zu lang (max. 60 Zeichen)" }, { status: 400 });
  const tpl = template === "A" || template === "B" ? template : "A";
  const wk = week || currentWeekKey();

  const slots = buildSlotsJson(wk, tpl);
  if (!slots)
    return NextResponse.json(
      { error: `Kein Plan für ${wk} / Template ${tpl} vorhanden — zuerst generieren.` },
      { status: 400 }
    );
  const clash = db
    .prepare("SELECT id FROM template WHERE name = ?")
    .get(nm) as { id: number } | undefined;
  if (clash)
    return NextResponse.json({ error: "Name existiert bereits" }, { status: 409 });

  const id = Number(
    db
      .prepare("INSERT INTO template(name, slots_json) VALUES (?, ?)")
      .run(nm, JSON.stringify(slots))
      .lastInsertRowid
  );
  return NextResponse.json({
    ok: true,
    id,
    name: nm,
    note: `Vorlage aus ${wk} / Template ${tpl} gespeichert — unter „Vorlagen“ in den Plan einplanbar.`,
  });
}
