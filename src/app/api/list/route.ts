import { NextRequest, NextResponse } from "next/server";
import { db, getActiveTemplate } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { grammageToGrams, reweProductUrl, reweUrl } from "@/lib/rewe";
import { PLAN_KEY } from "@/lib/plan";
import { roundAmount, toBaseUnit } from "@/lib/units";

// Basis-Kategorien in fester Reihenfolge; weitere benutzerdefinierte
// Kategorien (z. B. „Trockenwaren“ oder eigene) kommen alphabetisch danach.
const BASE_ORDER = ["Obst & Gemüse", "Fleisch, Wurst & Fisch", "Käse, Eier & Molkerei", "Tiefkühlkost", "Backwaren, Cerealien & Aufstriche", "Kochen & Backen", "Öle, Soßen & Gewürze", "Fertiggerichte & Konserven", "Süßes & Salziges", "Kaffee, Tee & Kakao", "Getränke & Genussmittel"];

function orderCategories(cats: Set<string>): string[] {
  const base = BASE_ORDER.filter((c) => cats.has(c));
  const rest = [...cats].filter((c) => !BASE_ORDER.includes(c)).sort((a, b) => a.localeCompare(b, "de"));
  return [...base, ...rest];
}

// Abhak-Status gehört zum Template (A/B), nicht mehr zur Kalenderwoche.
const checkKey = (tpl: string) => `${PLAN_KEY}-${tpl}`;

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  // Nur das ausgewählte Template gehört auf die Einkaufsliste:
  // ?template=A|B überschreibt, sonst gilt settings.active_template.
  const tplParam = req.nextUrl.searchParams.get("template");
  const template = tplParam === "A" || tplParam === "B" ? tplParam : getActiveTemplate();
  // Bedarf für N Tage (Standard 7 = eine Woche)
  const days = Math.min(7, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 7));

  // Eine Zeile je Rezept-Zutat × Plan-Mahlzeit (Mengen im Rezept = 1 Portion)
  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.category, i.unit_default, i.per_el,
              ri.amount, ri.unit, pm.servings, rm.title,
              rp.product_id AS rewe_id, rp.title AS rewe_title,
              rp.image_url AS rewe_image, rp.price_cents AS rewe_price,
              rp.is_vegan AS rewe_vegan, rp.grammage AS rewe_grammage,
              rp.brand AS rewe_brand
       FROM plan_meal pm
       JOIN recipe_ingredient ri ON ri.recipe_id = pm.recipe_id
       JOIN ingredient i ON i.id = ri.ingredient_id
       JOIN recipe rm ON rm.id = pm.recipe_id
       LEFT JOIN rewe_product rp ON rp.product_id = i.rewe_product_id
       WHERE pm.week_key = ? AND pm.template_id = ? AND pm.day < ?`
    )
    .all(PLAN_KEY, template, days) as Array<Record<string, unknown>>;

  type Part = { unit: string; qty: number; usedIn: Set<string>; noAmount: boolean };
  type Entry = {
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
  };
  const byIng = new Map<number, Entry>();
  for (const r of rows) {
    const id = Number(r.id);
    const unitDefault = String(r.unit_default || "g");
    let e = byIng.get(id);
    if (!e) {
      e = {
        id,
        name: String(r.name),
        category: String(r.category || "Sonstige"),
        unitDefault,
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
      byIng.set(id, e);
    }
    const servings = Number(r.servings) || 0;
    const noAmount = r.amount == null;
    const base = noAmount
      ? { amount: 0, unit: String(r.unit || unitDefault) }
      : toBaseUnit(Number(r.amount) * servings, String(r.unit || unitDefault), unitDefault, r.per_el as number | null);
    let part = e.parts.find((p) => p.unit === base.unit);
    if (!part) {
      part = { unit: base.unit, qty: 0, usedIn: new Set(), noAmount: true };
      e.parts.push(part);
    }
    part.qty += base.amount;
    if (!noAmount) part.noAmount = false;
    part.usedIn.add(String(r.title));
  }

  // REWE-Kosten pro Zutat: benötigte g/ml → ganze Packs → Preis × Packs.
  // Nur Mengen in der Basiseinheit der Zutat (g/ml) zählen.
  function reweCost(e: Entry): { packs: number; costCents: number } | null {
    if (!e.rewe || e.rewe.priceCents == null) return null;
    const packG = grammageToGrams(e.rewe.grammage);
    if (!packG) return null;
    let needed = 0;
    for (const p of e.parts) if (p.unit === "g" || p.unit === "ml") needed += p.qty;
    if (needed <= 0) return null;
    const packs = Math.max(1, Math.ceil(needed / packG - 1e-9));
    return { packs, costCents: packs * e.rewe.priceCents };
  }

  const checkedSet = new Set(
    (
      db.prepare("SELECT ingredient_id FROM check_state WHERE week_key = ?").all(checkKey(template)) as Array<{
        ingredient_id: number;
      }>
    ).map((c) => Number(c.ingredient_id))
  );

  const groups: Record<string, Array<Record<string, unknown>>> = {};
  const cats = new Set<string>();
  let reweTotalCents = 0;
  let reweMappedCount = 0;
  let reweUnmappedCount = 0;
  const entries = [...byIng.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  for (const e of entries) {
    const cost = reweCost(e);
    if (e.rewe) {
      reweMappedCount++;
      if (cost) reweTotalCents += cost.costCents;
    } else reweUnmappedCount++;
    // Basiseinheit zuerst, dann übrige Einheiten (z. B. „2 EL“ ohne Umrechnung)
    const parts = [...e.parts].sort((a, b) => Number(b.unit === e.unitDefault) - Number(a.unit === e.unitDefault));
    const cat = e.category || "Sonstige";
    cats.add(cat);
    (groups[cat] ||= []).push({
      id: e.id,
      ingredient_id: e.id,
      name: e.name,
      category: cat,
      amounts: parts.map((p) => ({
        qty: p.noAmount ? null : roundAmount(p.qty, p.unit),
        unit: p.unit,
      })),
      used_in: [...new Set(parts.flatMap((p) => [...p.usedIn]))].join(", "),
      checked: checkedSet.has(e.id),
      // Shop-Link: Produktseite, ohne Zuordnung die Suche nach dem Zutatennamen
      shop_url: e.rewe ? reweProductUrl(e.rewe.title, e.rewe.id) : reweUrl(e.name),
      rewe: e.rewe
        ? {
            productId: e.rewe.id,
            title: e.rewe.title,
            image: e.rewe.image,
            priceCents: e.rewe.priceCents,
            vegan: e.rewe.vegan,
            grammage: e.rewe.grammage,
            brand: e.rewe.brand,
            url: reweProductUrl(e.rewe.title, e.rewe.id),
            packs: cost?.packs ?? null,
            costCents: cost?.costCents ?? null,
          }
        : null,
    });
  }
  const ordered = orderCategories(cats)
    .filter((c) => groups[c])
    .map((c) => ({ category: c, items: groups[c] }));

  return NextResponse.json({
    template,
    days,
    groups: ordered,
    total: entries.length,
    checkedCount: entries.filter((e) => checkedSet.has(e.id)).length,
    rewe: {
      totalCents: reweTotalCents,
      mappedCount: reweMappedCount,
      unmappedCount: reweUnmappedCount,
    },
  });
}

// Abhaken: { ingredientId, checked, template? } · Alle zurücksetzen: { reset: true, template? }
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson();
  const { ingredientId, checked, reset, template } = raw as {
    ingredientId?: number;
    checked?: boolean;
    reset?: boolean;
    template?: string;
  };
  const tpl = template === "A" || template === "B" ? template : getActiveTemplate();
  const key = checkKey(tpl);
  if (reset) {
    db.prepare("DELETE FROM check_state WHERE week_key = ?").run(key);
    return NextResponse.json({ ok: true });
  }
  if (!ingredientId)
    return NextResponse.json({ error: "ingredientId fehlt" }, { status: 400 });
  if (checked)
    db.prepare(
      `INSERT INTO check_state(week_key, ingredient_id, checked_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(week_key, ingredient_id) DO UPDATE SET checked_at = datetime('now')`
    ).run(key, ingredientId);
  else
    db.prepare("DELETE FROM check_state WHERE week_key = ? AND ingredient_id = ?").run(key, ingredientId);
  return NextResponse.json({ ok: true });
}
