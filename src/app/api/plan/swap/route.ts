import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

const SHARED = new Set(["M", "A"]);

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson;
  const body = raw as {
    week: string;
    day: number;
    profileId: number;
    slot: string;
    recipeId: number;
    servings: number;
  };
  if (!body.week || !body.slot || !body.recipeId)
    return NextResponse.json({ error: "Felder fehlen" }, { status: 400 });

  const rec = db
    .prepare("SELECT * FROM recipe WHERE id = ?")
    .get(body.recipeId) as Record<string, unknown> | undefined;
  if (!rec) return NextResponse.json({ error: "Rezept nicht gefunden" }, { status: 404 });

  const upd = db.prepare(
    `UPDATE plan_meal SET recipe_id = ?, servings = ?, kcal = ?, p = ?, c = ?, f = ?
     WHERE week_key = ? AND day = ? AND profile_id = ? AND slot = ?`
  );

  const tx = db.transaction(() => {
    upd.run(
      body.recipeId, body.servings,
      Number(rec.kcal ?? 0) * body.servings,
      Number(rec.protein_g ?? 0) * body.servings,
      Number(rec.carbs_g ?? 0) * body.servings,
      Number(rec.fat_g ?? 0) * body.servings,
      body.week, body.day, body.profileId, body.slot
    );
    // Gemeinsamer Slot (M/A): andere Person bekommt dasselbe Rezept (eigene Größe bleibt)
    if (SHARED.has(body.slot)) {
      const other = db
        .prepare(
          "SELECT profile_id, servings FROM plan_meal WHERE week_key = ? AND day = ? AND slot = ? AND profile_id != ?"
        )
        .all(body.week, body.day, body.slot, body.profileId) as Array<{
        profile_id: number;
        servings: number;
      }>;
      for (const o of other) {
        db.prepare(
          `UPDATE plan_meal SET recipe_id = ?, kcal = ?, p = ?, c = ?, f = ?
           WHERE week_key = ? AND day = ? AND slot = ? AND profile_id = ?`
        ).run(
          body.recipeId,
          Number(rec.kcal ?? 0) * o.servings,
          Number(rec.protein_g ?? 0) * o.servings,
          Number(rec.carbs_g ?? 0) * o.servings,
          Number(rec.fat_g ?? 0) * o.servings,
          body.week, body.day, body.slot, o.profile_id
        );
      }
    }
  });
  tx();
  return NextResponse.json({ ok: true });
}
