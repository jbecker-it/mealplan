import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentWeekKey, weekTemplate } from "@/lib/week";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { grammageToGrams, reweUrl } from "@/lib/rewe";

// Basis-Kategorien in fester Reihenfolge; weitere benutzerdefinierte
// Kategorien (z. B. „Trockenwaren“ oder eigene) kommen alphabetisch danach.
const BASE_ORDER = ["Obst & Gemüse", "Kühlregal", "Trockenwaren"];

function orderCategories(cats: Set<string>): string[] {
  const base = BASE_ORDER.filter((c) => cats.has(c));
  const rest = [...cats].filter((c) => !BASE_ORDER.includes(c)).sort((a, b) => a.localeCompare(b, "de"));
  return [...base, ...rest];
}

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const week = req.nextUrl.searchParams.get("week") || currentWeekKey();

  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.category, i.unit_default, LOWER(rri.unit) AS unit,
              ROUND(SUM(rri.amount * pm.servings), 2) AS qty,
              GROUP_CONCAT(DISTINCT rm.title) AS used_in,
              rp.product_id AS rewe_id, rp.title AS rewe_title,
              rp.image_url AS rewe_image, rp.price_cents AS rewe_price,
              rp.is_vegan AS rewe_vegan, rp.grammage AS rewe_grammage,
              rp.brand AS rewe_brand
       FROM plan_meal pm
       JOIN recipe_ingredient rri ON rri.recipe_id = pm.recipe_id
       JOIN ingredient i ON i.id = rri.ingredient_id
       JOIN recipe rm ON rm.id = pm.recipe_id
       LEFT JOIN rewe_product rp ON rp.product_id = i.rewe_product_id
       WHERE pm.week_key = ? AND pm.template_id = ?
       GROUP BY i.id, LOWER(rri.unit)
       ORDER BY i.category, i.name COLLATE NOCASE`
    )
    // Nur das für die Woche aktive Template (ungerade = A, gerade = B)
    // zählt — sonst würde die Einkaufsliste A + B doppelt befüllen.
    .all(week, weekTemplate(week)) as Array<Record<string, unknown>>;

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
    {
      id: number;
      name: string;
      category: string;
      unitDefault: string;
      rewe: {
        id: string;
        title: string;
        image: string | null;
        priceCents: number | null;
        vegan: boolean;
        grammage: string | null;
        brand: string | null;
      } | null;
      parts: Part[];
    }
  >();
  for (const r of rows) {
    const id = Number(r.id);
    const unit = String(r.unit || "g");
    const qty = Number(r.qty || 0);
    const usedIn = String(r.used_in || "").split("|").map((s) => s.trim()).filter(Boolean);
    const e =
      byIng.get(id) ??
      {
        id,
        name: String(r.name),
        category: String(r.category),
        unitDefault: String(r.unit_default || "g").toLowerCase(),
        rewe: r.rewe_id
          ? {
              id: String(r.rewe_id),
              title: String(r.rewe_title),
              image: (r.rewe_image as string) || null,
              priceCents: r.rewe_price == null ? null : Number(r.rewe_price),
              vegan: Number(r.rewe_vegan) === 1,
              grammage: (r.rewe_grammage as string) || null,
              brand: (r.rewe_brand as string) || null,
            }
          : null,
        parts: [],
      };
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

  // REWE-Kosten pro Zutat: benötigte g/ml → ganze Packs → Preis × Packs.
  // Nur für g/ml-Positionen (EL/TL/„Stück“ ohne Packgröße bleiben ohne Preis).
  function reweCost(
    e: {
      unitDefault: string;
      rewe: { priceCents: number | null; grammage: string | null } | null;
      parts: Part[];
    }
  ): { packs: number; costCents: number } | null {
    if (!e.rewe || e.rewe.priceCents == null) return null;
    const packG = grammageToGrams(e.rewe.grammage);
    if (!packG) return null;
    let neededG = 0;
    for (const p of e.parts) {
      if (p.unit === "g" || p.unit === "ml" || e.unitDefault === "g" || e.unitDefault === "ml")
        neededG += p.qty;
    }
    if (neededG <= 0) return null;
    const packs = Math.max(1, Math.ceil(neededG / packG - 1e-9));
    return { packs, costCents: packs * e.rewe.priceCents };
  }

  const flat = [...byIng.values()].flatMap((e, idx) =>
    e.parts.map((p) => {
      const cost = reweCost(e);
      return {
        id: idx,
        name: e.name,
        category: e.category,
        unit: displayUnit(p.unit),
        qty: Math.round(p.qty * 100) / 100,
        used_in: [...new Set(p.usedIn)].join(", "),
        ingredient_id: e.id,
        rewe: e.rewe
          ? {
              productId: e.rewe.id,
              title: e.rewe.title,
              image: e.rewe.image,
              priceCents: e.rewe.priceCents,
              vegan: e.rewe.vegan,
              grammage: e.rewe.grammage,
              brand: e.rewe.brand,
              url: reweUrl(e.rewe.title),
              packs: cost?.packs ?? null,
              costCents: cost?.costCents ?? null,
            }
          : null,
      };
    })
  );

  const checked = db
    .prepare("SELECT ingredient_id FROM check_state WHERE week_key = ?")
    .all(week) as Array<{ ingredient_id: number }>;
  const checkedSet = new Set(checked.map((c) => c.ingredient_id));

  const groups: Record<string, Array<Record<string, unknown>>> = {};
  const cats = new Set<string>();
  for (const r of flat) {
    const cat = String(r.category) || "Sonstige";
    cats.add(cat);
    (groups[cat] ||= []).push({ ...r, checked: checkedSet.has(Number(r.ingredient_id)) });
  }
  const ordered = orderCategories(cats)
    .filter((c) => groups[c])
    .map((c) => ({ category: c, items: groups[c] }));

  // REWE-Gesamtkosten: pro Zutat einmal (Kosten hängen von der Zutat ab,
  // nicht von der Position) — über ingredient_id dedupliziert.
  const seenIng = new Set<number>();
  let reweTotalCents = 0;
  let reweMappedCount = 0;
  let reweUnmappedCount = 0;
  for (const r of flat) {
    const iid = Number(r.ingredient_id);
    if (seenIng.has(iid)) continue;
    seenIng.add(iid);
    const rw = r.rewe as
      | { costCents: number | null }
      | null;
    if (rw) {
      reweMappedCount++;
      if (rw.costCents != null) reweTotalCents += rw.costCents;
    } else {
      reweUnmappedCount++;
    }
  }

  return NextResponse.json({
    week,
    groups: ordered,
    total: flat.length,
    checkedCount: flat.filter((r) => checkedSet.has(Number(r.ingredient_id))).length,
    rewe: {
      totalCents: reweTotalCents,
      mappedCount: reweMappedCount,
      unmappedCount: reweUnmappedCount,
    },
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
