import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ParsedRecipe } from "@/lib/parser";
import { requireAuth } from "@/lib/auth";
import { upsertIngredient, upsertTag } from "@/lib/ingredients";
import { normalizeAmount } from "@/lib/units";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    preview?: ParsedRecipe[];
    resolutions?: Array<{ title: string; ingredients: SaveIngredient[] }>;
  };
  if (!body.preview?.length)
    return NextResponse.json({ error: "Keine Rezepte zur Verfügung" }, { status: 400 });
  const result = await saveParsed(body.preview, body.resolutions ?? []);
  return NextResponse.json({ ok: true, ...result });
}

export interface SaveIngredient {
  name: string;
  amount?: number;
  unit?: string;
  category?: string;
  match: string;
  matchedId?: number;
  suggestion?: { id: number; name: string };
  acceptSuggestion?: boolean;
  newName?: string;
}

// Grobe REWE-Abteilung für neue Zutaten (in „Zutaten“ jederzeit änderbar)
export function guessCategory(name: string): string {
  const n = name.toLowerCase();
  if (/(öl|essig|soße|sauce|paste|senf|ketchup|gewürz|salz|pfeffer|curry|paprikapulver|zimt|kreuzkümmel|tahini|hefeflocken|brühe)/.test(n))
    return "Öle, Soßen & Gewürze";
  if (/(möhre|karotte|brokkoli|blumenkohl|gurke|tomate|paprika|kartoffel|sellerie|banane|basilikum|spinat|zucchini|zwiebel|knoblauch|lauch|kohl|fenchel|petersilie|koriander|ingwer|rucola|salat|apfel|birne|orange|zitrone|limette|ananas|erdbeere|beere|kirsche|pfirsich|aprikose|melone|avocado|pilz|champignon|aubergine|kürbis|süßkartoffel)/.test(n))
    return "Obst & Gemüse";
  if (/(tofu|tempeh|seitan|hack|wurst|fleisch|fisch|lachs|hähnchen|pute)/.test(n)) return "Fleisch, Wurst & Fisch";
  if (/(drink|milch|joghurt|yoghurt|quark|skyr|käse|sahne|butter|margarine|\bei\b|eier)/.test(n)) return "Käse, Eier & Molkerei";
  if (/(tiefkühl|tk-|edamame|erbsen tk)/.test(n)) return "Tiefkühlkost";
  if (/(dose|konserve|kokosmilch|passiert|falafel|bohnen|kichererbsen)/.test(n)) return "Fertiggerichte & Konserven";
  if (/(brot|brötchen|wrap|tortilla|haferflocken|müsli|cornflakes|aufstrich|sirup|marmelade)/.test(n))
    return "Backwaren, Cerealien & Aufstriche";
  return "Kochen & Backen";
}

// Standard-Einheit einer NEUEN Zutat aus ihrer ersten Verwendung ableiten
function defaultUnitFor(unit?: string): string {
  if (!unit || unit === "EL" || unit === "TL" || unit === "Prise") return "g";
  return unit;
}

export async function saveParsed(
  preview: ParsedRecipe[],
  resolutions: Array<{ title: string; ingredients: SaveIngredient[] }>
): Promise<{ saved: string[]; created: string[] }> {
  const created: string[] = [];
  const saved: string[] = [];
  const upsertIng = (name: string, category?: string, unit?: string): number => {
    const r = upsertIngredient(name, category || guessCategory(name), defaultUnitFor(unit));
    if (r.created) created.push(name.trim());
    return r.id;
  };

  for (const rec of preview) {
    if (rec.macros?.kcal == null) continue; // Blocker-Warnung: überspringen
    const res = resolutions.find((r) => r.title === rec.title);
    const tx = db.transaction(() => {
      const rid = Number(
        db
          .prepare(
            "INSERT INTO recipe(title, description, kcal, protein_g, carbs_g, fat_g, sugar_g, salt_g, slots) VALUES (?,?,?,?,?,?,?,?,?)"
          )
          .run(
            rec.title,
            null,
            rec.macros!.kcal,
            rec.macros!.p ?? null,
            rec.macros!.c ?? null,
            rec.macros!.f ?? null,
            rec.macros!.sugar ?? null,
            rec.macros!.salt ?? null,
            (rec.slots?.length ? rec.slots : ["B", "M", "A", "S"]).join(",")
          )
          .lastInsertRowid
      );
      const ings = res?.ingredients ?? rec.ingredients;
      ings.forEach((ing, i) => {
        let ingId: number | undefined;
        if (ing.match === "fuzzy" && ing.acceptSuggestion && ing.suggestion)
          ingId = ing.suggestion.id;
        else if (ing.matchedId != null) ingId = ing.matchedId;
        if (ingId == null) {
          const finalName = ing.newName?.trim() || ing.name.trim();
          if (!finalName) return;
          const cat =
            "category" in ing && (ing as SaveIngredient).category
              ? (ing as SaveIngredient).category
              : undefined;
          ingId = upsertIng(finalName, cat, ing.unit);
        }
        const na = normalizeAmount(ing.amount, ing.unit);
        db.prepare(
          "INSERT INTO recipe_ingredient(recipe_id, ingredient_id, amount, unit, note, sort) VALUES (?,?,?,?,?,?)"
        ).run(rid, ingId, na.amount, na.unit || null, null, i);
      });
      rec.steps.forEach((s, i) =>
        db.prepare("INSERT INTO step(recipe_id, text, sort) VALUES (?,?,?)").run(rid, s, i)
      );
      for (const t of rec.tags)
        db.prepare("INSERT OR IGNORE INTO recipe_tag(recipe_id, tag_id) VALUES (?,?)").run(rid, upsertTag(t));
      return rid;
    });
    tx();
    saved.push(rec.title);
  }
  return { saved, created };
}
