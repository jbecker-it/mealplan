import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

// Mahlzeit austauschen: neues Rezept + Portion für einen Slot.
// Innerhalb eines Templates sind alle 7 Tage identisch → der Swap
// schreibt auf ALLE Tage des Templates (nicht nur auf einen Wochentag).
// Gemeinsame Slots (Mittag/Abend): das Partner-Profil bekommt dasselbe
// Rezept mit seiner bisherigen Portion.
// Die Einkaufsliste wird bei jedem Request aus plan_meal neu berechnet
// → sie aktualisiert sich dadurch automatisch.
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await readJson(req);
  if (body === null) return badJson;
  const { week, template, profileId, slot, recipeId, servings } = body as {
    week?: string;
    template?: string;
    profileId?: number;
    slot?: string;
    recipeId?: number;
    servings?: number;
  };
  if (!week || !profileId || !slot || !recipeId || !servings)
    return NextResponse.json(
      { error: "Feld fehlt (week, profileId, slot, recipeId, servings)" },
      { status: 400 }
    );
  const tpl = template === "A" || template === "B" ? template : "A";
  const rec = db
    .prepare(
      `SELECT id, title, kcal, protein_g, carbs_g, fat_g, sugar_g, salt_g
       FROM recipe WHERE id = ? AND archived = 0`
    )
    .get(recipeId) as
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
  if (!rec)
    return NextResponse.json({ error: "Rezept nicht gefunden" }, { status: 404 });

  const upsert = db.prepare(
    `INSERT INTO plan_meal(week_key, template_id, day, profile_id, slot, recipe_id, servings, kcal, p, c, f, sugar, salt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(week_key, template_id, day, profile_id, slot) DO UPDATE SET
       recipe_id = excluded.recipe_id, servings = excluded.servings,
       kcal = excluded.kcal, p = excluded.p, c = excluded.c, f = excluded.f,
       sugar = excluded.sugar, salt = excluded.salt`
  );
  const setMeal = (pid: number, s: number, sv: number) => {
    for (let day = 0; day < 7; day++) {
      upsert.run(
        week,
        tpl,
        day,
        pid,
        slot,
        recipeId,
        sv,
        (rec.kcal || 0) * sv,
        (rec.protein_g || 0) * sv,
        (rec.carbs_g || 0) * sv,
        (rec.fat_g || 0) * sv,
        (rec.sugar_g || 0) * sv,
        (rec.salt_g || 0) * sv
      );
    }
  };

  db.transaction(() => {
    setMeal(profileId, Number(recipeId), Number(servings));
    // Gemeinsame Slots: Partner-Profil bekommt dasselbe Rezept.
    if (slot === "M" || slot === "A") {
      const others = db
        .prepare(
          `SELECT DISTINCT pm.profile_id, pm.servings
           FROM plan_meal pm
           WHERE pm.week_key = ? AND pm.template_id = ? AND pm.day = 0 AND pm.slot = ?`
        )
        .all(week, tpl, slot) as Array<{ profile_id: number; servings: number }>;
      for (const o of others) {
        if (o.profile_id !== profileId) setMeal(o.profile_id, Number(recipeId), o.servings);
      }
    }
  })();

  return NextResponse.json({
    ok: true,
    week,
    template: tpl,
    profileId,
    slot,
    recipeId: rec.id,
    title: rec.title,
    servings,
    days: 7,
  });
}
