import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ParsedRecipe } from "@/lib/parser";
import { requireAuth } from "@/lib/auth";

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

// Grobe REWE-Gruppierung für neue Zutaten (kann später in der UI geändert werden)
function guessCategory(name: string): string {
  const n = name.toLowerCase();
  if (/(möhre|karotte|brokkoli|blumenkohl|gurke|tomate|paprika|kartoffel|sellerie|banane|basilikum|spinat|zucchini|zwiebel|lauch|kohl|fenchel|petersilie|ingwer|rucola|salat|apfel|birne|orange|zitrone|ananas|erdbeere|beere|kirsche|pfirsich|aprikose|melone)/.test(n))
    return "Obst & Gemüse";
  if (/(drink|milch|joghurt|quark|tofu|tempeh|soj|seitan|hack|käse|yoghurt|sahne|tahini|paste|soße|sauce|dip|edamame|falafel)/.test(n))
    return "Kühlregal";
  return "Trockenwaren";
}

export async function saveParsed(
  preview: ParsedRecipe[],
  resolutions: Array<{ title: string; ingredients: SaveIngredient[] }>
): Promise<{ saved: string[]; created: string[] }> {
  const created: string[] = [];
  const saved: string[] = [];
  const upsertIng = (name: string, category?: string): number => {
    const n = name.trim();
    const row = db.prepare("SELECT id FROM ingredient WHERE name = ?").get(n) as
      | { id: number }
      | undefined;
    if (row) return Number(row.id);
    const info = db
      .prepare("INSERT INTO ingredient(name, category, unit_default) VALUES (?,?,?)")
      .run(n, category || guessCategory(n), "g");
    created.push(n);
    return Number(info.lastInsertRowid);
  };
  const upsertTag = (name: string): number => {
    const n = name.trim();
    const row = db.prepare("SELECT id FROM tag WHERE name = ?").get(n) as
      | { id: number }
      | undefined;
    if (row) return Number(row.id);
    const info = db.prepare("INSERT INTO tag(name) VALUES (?)").run(n);
    return Number(info.lastInsertRowid);
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
          ingId = upsertIng(finalName, cat);
        }
        db.prepare(
          "INSERT INTO recipe_ingredient(recipe_id, ingredient_id, amount, unit, note, sort) VALUES (?,?,?,?,?,?)"
        ).run(rid, ingId, ing.amount ?? null, ing.unit || null, null, i);
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
