import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentWeekKey, weekTemplate } from "@/lib/week";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const week =
    req.nextUrl.searchParams.get("week") || currentWeekKey();
  const day = Math.min(6, Math.max(0, Number(req.nextUrl.searchParams.get("day") ?? 0)));

  const rows = db
    .prepare(
      `SELECT pm.profile_id, p.name AS profile_name, pm.slot, pm.recipe_id, rm.title,
              pm.servings, pm.kcal, pm.p, pm.c, pm.f
       FROM plan_meal pm
       JOIN profile p ON p.id = pm.profile_id
       JOIN recipe rm ON rm.id = pm.recipe_id
       WHERE pm.week_key = ? AND pm.day = ?
       ORDER BY pm.slot, pm.profile_id`
    )
    .all(week, day) as Array<Record<string, unknown>>;

  const totals = db
    .prepare(
      `SELECT profile_id, ROUND(SUM(kcal),0) kcal, ROUND(SUM(p),0) p, ROUND(SUM(c),0) c, ROUND(SUM(f),0) f, COUNT(*) meals
       FROM plan_meal WHERE week_key = ? AND day = ? GROUP BY profile_id`
    )
    .all(week, day) as Array<Record<string, unknown>>;

  const profiles = db.prepare("SELECT * FROM profile ORDER BY id").all() as Array<
    Record<string, unknown>
  >;
  const hasPlan = db
    .prepare("SELECT COUNT(*) AS c FROM plan_meal WHERE week_key = ?")
    .get(week) as { c: number };

  return NextResponse.json({
    week,
    template: weekTemplate(week),
    day,
    rows,
    totals: Object.fromEntries(totals.map((t) => [String(t.profile_id), t])),
    profiles,
    hasPlan: hasPlan.c > 0,
  });
}
