import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentWeekKey } from "@/lib/week";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

const CATEGORY_ORDER = ["Obst & Gemüse", "Kühlregal", "Trockenwaren", "Sonstige"];

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const week = req.nextUrl.searchParams.get("week") || currentWeekKey();

  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.category, i.unit_default, LOWER(rri.unit) AS unit,
              ROUND(SUM(rri.amount * pm.servings), 2) AS qty,
              GROUP_CONCAT(DISTINCT rm.title) AS used_in
       FROM plan_meal pm
       JOIN recipe_ingredient rri ON rri.recipe_id = pm.recipe_id
       JOIN ingredient i ON i.id = rri.ingredient_id
       JOIN recipe rm ON rm.id = pm.recipe_id
       WHERE pm.week_key = ?
       GROUP BY i.id, LOWER(rri.unit)
       ORDER BY i.category, i.name COLLATE NOCASE`
    )
    .all(week) as Array<Record<string, unknown>>;

  // Küchen-Einheiten auf die Einheiten der Zutat-Entität normieren
  // (z. B. "1 EL Sojasoße" + "150 ml Sojasoße" → eine Zeile in ml)
  const LADLE_TO_ML: Record<string, number> = {
    el: 15, essenlöffel: 15, löffel: 15, tl: 5, teelöffel: 5,
  };
  const displayUnit = (u: string) => {
    if (u === "el" || u === "essenlöffel" || u === "löffel") return "EL";
    if (u === "tl" || u === "teelöffel") return "TL";
    return u === "g" || u === "ml" ? u : u.charAt(0).toUpperCase() + u.slice(1);
  };

  type Part = { unit: string; qty: number; usedIn: string[] };
  const byIng = new Map<
    number,
    { id: number; name: string; category: string; unitDefault: string; parts: Part[] }
  >();
  for (const r of rows) {
    const id = Number(r.id);
    const unit = String(r.unit || "g");
    const qty = Number(r.qty || 0);
    const usedIn = String(r.used_in || "").split("|").map((s) => s.trim()).filter(Boolean);
    const e = byIng.get(id) ?? { id, name: String(r.name), category: String(r.category), unitDefault: String(r.unit_default || "g").toLowerCase(), parts: [] };
    let outUnit = unit;
    let outQty = qty;
    const factor = LADLE_TO_ML[unit];
    if (factor && e.unitDefault === "ml") {
      outUnit = "ml";
      outQty = qty * factor;
    }
    const part = e.parts.find((p) => p.unit === outUnit);
    if (part) {
      part.qty += outQty;
      part.usedIn.push(...usedIn);
    } else {
      e.parts.push({ unit: outUnit, qty: outQty, usedIn });
    }
    byIng.set(id, e);
  }

  const flat = [...byIng.values()].flatMap((e, idx) =>
    e.parts.map((p) => ({
      id: idx,
      name: e.name,
      category: e.category,
      unit: displayUnit(p.unit),
      qty: Math.round(p.qty * 100) / 100,
      used_in: [...new Set(p.usedIn)].join(", "),
      ingredient_id: e.id,
    }))
  );

  const checked = db
    .prepare("SELECT ingredient_id FROM check_state WHERE week_key = ?")
    .all(week) as Array<{ ingredient_id: number }>;
  const checkedSet = new Set(checked.map((c) => c.ingredient_id));

  const groups: Record<string, Array<Record<string, unknown>>> = {};
  for (const r of flat) {
    const cat = CATEGORY_ORDER.includes(String(r.category))
      ? String(r.category)
      : "Sonstige";
    (groups[cat] ||= []).push({ ...r, checked: checkedSet.has(Number(r.ingredient_id)) });
  }
  const ordered = CATEGORY_ORDER.filter((c) => groups[c]).map((c) => ({
    category: c,
    items: groups[c],
  }));

  return NextResponse.json({
    week,
    groups: ordered,
    total: flat.length,
    checkedCount: flat.filter((r) => checkedSet.has(Number(r.ingredient_id))).length,
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson;
  const { week, ingredientId, checked } = raw as {
    week: string;
    ingredientId: number;
    checked: boolean;
  };
  if (!week || !ingredientId)
    return NextResponse.json({ error: "Felder fehlen" }, { status: 400 });
  if (checked)
    db.prepare(
      `INSERT INTO check_state(week_key, ingredient_id, checked_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(week_key, ingredient_id) DO UPDATE SET checked_at = datetime('now')`
    ).run(week, ingredientId);
  else
    db.prepare("DELETE FROM check_state WHERE week_key = ? AND ingredient_id = ?").run(
      week, ingredientId
    );
  return NextResponse.json({ ok: true });
}
