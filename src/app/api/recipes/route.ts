import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { upsertIngredient, upsertTag } from "@/lib/ingredients";
import { normalizeAmount, parseAmount } from "@/lib/units";
import { parseSizes, serializeSizes } from "@/lib/servings";

interface NewIngredient {
  name?: string;
  id?: number;
  amount?: number;
  unit?: string;
  note?: string;
}

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get("q") || "";
  // ?tag=1&tag=3 → Rezepte, die ALLE gewählten Tags tragen
  const tagIds = req.nextUrl.searchParams.getAll("tag").map(Number).filter((n) => n > 0);
  const fav = req.nextUrl.searchParams.get("fav");
  const includeArchived = req.nextUrl.searchParams.get("archived") === "1";

  let sql = `
    SELECT r.*, GROUP_CONCAT(t.name, '|') AS tags
    FROM recipe r
    LEFT JOIN recipe_tag rt ON rt.recipe_id = r.id
    LEFT JOIN tag t ON t.id = rt.tag_id
    WHERE r.archived = ?`;
  const params: Array<string | number> = [includeArchived ? 1 : 0];
  if (q) {
    sql += " AND r.title LIKE ?";
    params.push(`%${q}%`);
  }
  if (fav === "1") sql += " AND r.favorite = 1";
  for (const t of tagIds) {
    sql += " AND r.id IN (SELECT recipe_id FROM recipe_tag WHERE tag_id = ?)";
    params.push(t);
  }
  sql += " GROUP BY r.id ORDER BY r.favorite DESC, r.title COLLATE NOCASE";
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      slots: String(r.slots ?? "B,M,A,S").split(",").filter(Boolean),
      servings_allowed: parseSizes(r.servings_allowed),
      tags: ((r.tags as string) || "").split("|").filter(Boolean),
    }))
  );
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson();
  const body = raw as {
    title: string;
    description?: string;
    kcal?: number;
    p?: number;
    c?: number;
    f?: number;
    sugar?: number;
    salt?: number;
    sugar_g?: number;
    salt_g?: number;
    favorite?: boolean;
    ingredients?: NewIngredient[];
    steps?: string[];
    tags?: string[];
    slots?: string[];
    servings_allowed?: number[] | string | null;
  };
  if (!body.title?.trim())
    return NextResponse.json({ error: "Titel fehlt" }, { status: 400 });

  const num = (v: unknown) => parseAmount(v as string | number | null | undefined);
  const tx = db.transaction(() => {
    const id = Number(
      db
        .prepare(
          "INSERT INTO recipe(title, description, kcal, protein_g, carbs_g, fat_g, sugar_g, salt_g, favorite, slots, servings_allowed) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
        )
        .run(
          body.title.trim(),
          body.description || null,
          num(body.kcal),
          num(body.p),
          num(body.c),
          num(body.f),
          num(body.sugar_g ?? body.sugar),
          num(body.salt_g ?? body.salt),
          body.favorite ? 1 : 0,
          (body.slots?.length ? body.slots : ["B", "M", "A", "S"]).join(","),
          serializeSizes(body.servings_allowed)
        )
        .lastInsertRowid
    );
    body.ingredients?.forEach((ing, i) => {
      if (!ing.name?.trim() && ing.id == null) return;
      const ingId = ing.id ?? upsertIngredient(ing.name!).id;
      const na = normalizeAmount(num(ing.amount), ing.unit);
      db.prepare(
        "INSERT INTO recipe_ingredient(recipe_id, ingredient_id, amount, unit, note, sort) VALUES (?,?,?,?,?,?)"
      ).run(id, ingId, na.amount, na.unit || null, ing.note || null, i);
    });
    body.steps?.forEach((s, i) => {
      if (s.trim())
        db.prepare("INSERT INTO step(recipe_id, text, sort) VALUES (?,?,?)").run(id, s.trim(), i);
    });
    for (const t of body.tags ?? []) if (t.trim()) db.prepare("INSERT OR IGNORE INTO recipe_tag(recipe_id, tag_id) VALUES (?,?)").run(id, upsertTag(t));
    return id;
  });
  const id = tx();
  return NextResponse.json({ id });
}
