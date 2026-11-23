import { NextRequest, NextResponse } from "next/server";
import { db, getActiveTemplate } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { setMeal, snapshot } from "@/lib/plan";

// Vorlage in den Plan einplanen: {template_id, template?}
// Template = ?template oder das aktive (settings) — nicht mehr wochenabhängig.
// Schreibt alle 7 Tage des Ziel-Templates. Jede Vorlage trägt pro Slot und
// Profil ihr eigenes Rezept + Portion — so bleiben persönliche Slots
// (Frühstück/Snack) je Person erhalten.

interface SlotEntry {
  recipe_id: number;
  servings: number;
}
type SlotsJson = Record<string, Record<string, SlotEntry | null>>;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await readJson(req);
  if (body === null) return badJson();
  const { template_id, template } = body as {
    template_id?: number;
    template?: string;
  };
  if (!template_id)
    return NextResponse.json({ error: "template_id fehlt" }, { status: 400 });
  const tgt = template === "A" || template === "B" ? template : getActiveTemplate();

  const tpl = db
    .prepare("SELECT id, name, slots_json FROM template WHERE id = ?")
    .get(template_id) as
    | { id: number; name: string; slots_json: string }
    | undefined;
  if (!tpl)
    return NextResponse.json({ error: "Vorlage nicht gefunden" }, { status: 404 });

  let slots: SlotsJson = {};
  try {
    slots = JSON.parse(tpl.slots_json) as SlotsJson;
  } catch {
    return NextResponse.json({ error: "Vorlage ist beschädigt" }, { status: 400 });
  }

  snapshot(tgt, `Template ${tgt} vor Vorlage „${tpl.name}“`);
  const applied: Array<{ slot: string; title: string }> = [];
  const skipped: string[] = [];
  let written = 0;
  for (const slot of ["B", "M", "A", "S"]) {
    const per = slots[slot];
    if (!per) continue;
    for (const [pid, entry] of Object.entries(per)) {
      if (!entry?.recipe_id) continue;
      const rec = db
        .prepare(
          `SELECT id, title, kcal, protein_g, carbs_g, fat_g, sugar_g, salt_g
           FROM recipe WHERE id = ? AND archived = 0`
        )
        .get(entry.recipe_id) as
        | {
            id: number;
            title: string;
            kcal: number | null;
            protein_g: number | null;
            carbs_g: number | null;
            fat_g: number | null;
            sugar_g: number | null;
            salt_g: number | null;
          }
        | undefined;
      if (!rec) {
        skipped.push(`${slot}: Rezept fehlt oder archiviert (Profil ${pid})`);
        continue;
      }
      const sv = Number(entry.servings) || 1.0;
      if (!db.prepare("SELECT 1 FROM profile WHERE id = ?").get(Number(pid))) {
        skipped.push(`${slot}: Profil ${pid} existiert nicht mehr`);
        continue;
      }
      setMeal(tgt, Number(pid), slot, rec.id, sv);
      written++;
      if (!applied.some((a) => a.slot === slot))
        applied.push({ slot, title: rec.title });
    }
  }

  if (written === 0)
    return NextResponse.json(
      { error: "Keine gültigen Slots in der Vorlage" },
      { status: 400 }
    );

  return NextResponse.json({
    ok: true,
    target: tgt,
    template: tpl.name,
    applied,
    skipped,
    note: `Vorlage „${tpl.name}“ als Template ${tgt} übernommen. Der vorherige Stand liegt im Verlauf.`,
  });
}
