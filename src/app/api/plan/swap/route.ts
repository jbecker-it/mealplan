import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { PLAN_KEY, setMeal } from "@/lib/plan";
import { clampServings, parseSizes, sizesFor } from "@/lib/servings";

// Mahlzeit austauschen / Portion ändern: neues Rezept + Portion für einen
// Slot, gilt für alle 7 Tage des Templates.
// Gemeinsame Slots (Mittag/Abend): das Partner-Profil bekommt dasselbe
// Rezept mit seiner bisherigen Portion (auf die nächste für das Rezept
// erlaubte Größe gezogen).
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await readJson(req);
  if (body === null) return badJson();
  const { template, profileId, slot, recipeId, servings } = body as {
    template?: string;
    profileId?: number;
    slot?: string;
    recipeId?: number;
    servings?: number;
  };
  if (!profileId || !slot || !recipeId || !servings || !["B", "M", "A", "S"].includes(slot))
    return NextResponse.json(
      { error: "Feld fehlt (profileId, slot, recipeId, servings)" },
      { status: 400 }
    );
  const sv = Number(servings);
  if (!(sv > 0 && sv <= 10))
    return NextResponse.json({ error: "Ungültige Portion" }, { status: 400 });
  const tpl = template === "A" || template === "B" ? template : "A";
  const rec = db
    .prepare("SELECT id, title, servings_allowed FROM recipe WHERE id = ? AND archived = 0")
    .get(recipeId) as { id: number; title: string; servings_allowed: string | null } | undefined;
  if (!rec)
    return NextResponse.json({ error: "Rezept nicht gefunden" }, { status: 404 });

  const sizes = sizesFor(parseSizes(rec.servings_allowed));
  db.transaction(() => {
    setMeal(tpl, Number(profileId), slot, rec.id, sv);
    if (slot === "M" || slot === "A") {
      const others = db
        .prepare(
          `SELECT p.id AS profile_id, pm.servings FROM profile p
           LEFT JOIN plan_meal pm ON pm.profile_id = p.id AND pm.week_key = ?
             AND pm.template_id = ? AND pm.day = 0 AND pm.slot = ?
           WHERE p.id != ?`
        )
        .all(PLAN_KEY, tpl, slot, Number(profileId)) as Array<{ profile_id: number; servings: number | null }>;
      for (const o of others) setMeal(tpl, o.profile_id, slot, rec.id, clampServings(Number(o.servings) || 1, sizes));
    }
  })();

  return NextResponse.json({ ok: true, template: tpl, profileId, slot, recipeId: rec.id, title: rec.title, servings: sv });
}
