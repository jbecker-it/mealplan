import { NextRequest, NextResponse } from "next/server";
import { db, getActiveTemplate } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { PLAN_KEY } from "@/lib/plan";
import { parseSizes } from "@/lib/servings";

// Template A/B sind dauerhaft (keine Kalenderwochen, s. lib/plan.ts);
// das aktive bestimmt die UI (settings).
// ?template=A|B überschreibt die Auswahl, sonst gilt settings.active_template.
// Das Template ist pro Tag identisch; der Client ruft standardmäßig Tag 0 ab.
export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const tplParam = req.nextUrl.searchParams.get("template");
  const template =
    tplParam === "A" || tplParam === "B" ? tplParam : getActiveTemplate();
  const day = Math.min(
    6,
    Math.max(0, Number(req.nextUrl.searchParams.get("day") || 0))
  );

  const rows = db
    .prepare(
      `SELECT pm.profile_id, pr.name AS profile_name, pm.slot, pm.recipe_id,
              rm.title, rm.archived, rm.servings_allowed, pm.servings, pm.kcal, pm.p, pm.c, pm.f,
              COALESCE(pm.sugar, 0) AS sugar, COALESCE(pm.salt, 0) AS salt
       FROM plan_meal pm
       JOIN recipe rm ON rm.id = pm.recipe_id
       JOIN profile pr ON pr.id = pm.profile_id
       WHERE pm.week_key = ? AND pm.template_id = ? AND pm.day = ?
       ORDER BY pm.profile_id, pm.slot`
    )
    .all(PLAN_KEY, template, day) as Array<Record<string, unknown>>;

  const profiles = db
    .prepare(
      `SELECT id, name, kcal_target, p_target, c_target, f_target,
              COALESCE(sugar_target, 0) AS sugar_target,
              COALESCE(salt_target, 0) AS salt_target
       FROM profile ORDER BY id`
    )
    .all() as Array<Record<string, unknown>>;

  const totals: Record<string, { kcal: number; p: number; c: number; f: number; sugar: number; salt: number; meals: number }> = {};
  for (const p of profiles) totals[String(p.id)] = { kcal: 0, p: 0, c: 0, f: 0, sugar: 0, salt: 0, meals: 0 };
  for (const r of rows) {
    const t = totals[String(r.profile_id)];
    if (!t) continue;
    t.kcal += Number(r.kcal || 0);
    t.p += Number(r.p || 0);
    t.c += Number(r.c || 0);
    t.f += Number(r.f || 0);
    t.sugar += Number(r.sugar || 0);
    t.salt += Number(r.salt || 0);
    t.meals += 1;
  }

  return NextResponse.json({
    template,
    day,
    rows: rows.map((r) => ({ ...r, servings_allowed: parseSizes(r.servings_allowed) })),
    totals,
    profiles,
    hasPlan: rows.length > 0,
  });
}
