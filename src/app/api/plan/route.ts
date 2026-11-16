import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { currentWeekKey, weekTemplate } from "@/lib/week";

// Aktuelle Woche + gewähltes Template (A/B) + Tag 0-6.
// Innerhalb eines Templates sind alle 7 Tage identisch; Tag 0 wird
// standardmäßig geladen. Template-Default = 2x2-Rotation (ungrade Woche A).
export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const week = sp.get("week") || currentWeekKey();
  const tplParam = sp.get("template");
  const template = tplParam === "A" || tplParam === "B" ? tplParam : weekTemplate(week);
  const day = Math.min(6, Math.max(0, parseInt(sp.get("day") || "0", 10)));

  const profiles = db
    .prepare(
      `SELECT id, name, kcal_target, p_target, c_target, f_target,
              COALESCE(sugar_target, 0) AS sugar_target,
              COALESCE(salt_target, 0) AS salt_target
       FROM profile ORDER BY id`
    )
    .all() as Array<Record<string, unknown>>;

  const rows = db
    .prepare(
      `SELECT pm.profile_id, p.name AS profile_name, pm.slot, pm.recipe_id,
              r.title, pm.servings, pm.kcal, pm.p, pm.c, pm.f, pm.sugar, pm.salt
       FROM plan_meal pm
       JOIN recipe r ON r.id = pm.recipe_id
       JOIN profile p ON p.id = pm.profile_id
       WHERE pm.week_key = ? AND pm.template_id = ? AND pm.day = ?
       ORDER BY pm.profile_id,
         CASE pm.slot WHEN 'B' THEN 0 WHEN 'M' THEN 1 WHEN 'A' THEN 2 WHEN 'S' THEN 3 END`
    )
    .all(week, template, day) as Array<Record<string, unknown>>;

  const totals: Record<
    string,
    { kcal: number; p: number; c: number; f: number; sugar: number; salt: number; meals: number }
  > = {};
  for (const r of rows) {
    const key = String(r.profile_id);
    const t = (totals[key] ??= { kcal: 0, p: 0, c: 0, f: 0, sugar: 0, salt: 0, meals: 0 });
    t.kcal += Number(r.kcal) || 0;
    t.p += Number(r.p) || 0;
    t.c += Number(r.c) || 0;
    t.f += Number(r.f) || 0;
    t.sugar += Number(r.sugar) || 0;
    t.salt += Number(r.salt) || 0;
    t.meals += 1;
  }

  return NextResponse.json({
    week,
    template,
    day,
    rows,
    totals: Object.fromEntries(
      Object.entries(totals).map(([k, v]) => [
        k,
        {
          kcal: Math.round(v.kcal),
          p: Math.round(v.p * 10) / 10,
          c: Math.round(v.c * 10) / 10,
          f: Math.round(v.f * 10) / 10,
          sugar: Math.round(v.sugar * 10) / 10,
          salt: Math.round(v.salt * 100) / 100,
          meals: v.meals,
        },
      ])
    ),
    profiles,
    hasPlan: rows.length > 0,
  });
}
