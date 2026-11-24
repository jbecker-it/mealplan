import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { upsertIngredient, upsertTag } from "@/lib/ingredients";
import { normalizeAmount, parseAmount } from "@/lib/units";
import { parseSizes, serializeSizes } from "@/lib/servings";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const rec = db
    .prepare("SELECT * FROM recipe WHERE id = ?")
    .get(Number(id)) as Record<string, unknown> | undefined;
  if (!rec) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const ings = db
    .prepare(
      `SELECT ri.id, ri.amount, ri.unit, ri.note, ri.sort, i.id AS ingredient_id, i.name, i.category,
              i.unit_default, i.per_el
       FROM recipe_ingredient ri JOIN ingredient i ON i.id = ri.ingredient_id
       WHERE ri.recipe_id = ? ORDER BY ri.sort`
    )
    .all(Number(id)) as Array<Record<string, unknown>>;
  const steps = db
    .prepare("SELECT text, sort FROM step WHERE recipe_id = ? ORDER BY sort")
    .all(Number(id)) as Array<{ text: string; sort: number }>;
  const tags = db
    .prepare(
      "SELECT t.id, t.name FROM tag t JOIN recipe_tag rt ON rt.tag_id = t.id WHERE rt.recipe_id = ? ORDER BY t.name"
    )
    .all(Number(id)) as Array<{ id: number; name: string }>;

  return NextResponse.json({
    ...rec,
    slots: String(rec.slots ?? "B,M,A,S").split(",").filter(Boolean),
    servings_allowed: parseSizes(rec.servings_allowed),
    ingredients: ings,
    steps: steps.map((s) => s.text),
    tags: tags.map((t) => t.name),
    tagIds: tags.map((t) => t.id),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson(req);
  if (body === null) return badJson();
  const rid = Number(id);
  if (!db.prepare("SELECT 1 FROM recipe WHERE id = ?").get(rid))
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (body.title !== undefined && !String(body.title).trim())
    return NextResponse.json({ error: "Titel fehlt" }, { status: 400 });

  db.transaction(() => {
    if (body.slots !== undefined) {
      const arr = Array.isArray(body.slots) ? (body.slots as string[]) : String(body.slots).split(",");
      const cleaned = arr.map((s) => String(s).trim()).filter((s) => ["B", "M", "A", "S"].includes(s));
      db.prepare("UPDATE recipe SET slots = ? WHERE id = ?").run(
        (cleaned.length ? cleaned : ["B", "M", "A", "S"]).join(","),
        rid
      );
    }
    // Erlaubte Portionen (leer/null = globale Vorgabe 0,5/1/1,5)
    if (body.servings_allowed !== undefined)
      db.prepare("UPDATE recipe SET servings_allowed = ? WHERE id = ?").run(serializeSizes(body.servings_allowed), rid);
    const fields: string[] = [];
    const vals: Array<string | number | null> = [];
    for (const k of ["title", "description"] as const) {
      if (body[k] !== undefined) {
        fields.push(`${k} = ?`);
        vals.push(body[k] == null ? null : String(body[k]).trim());
      }
    }
    for (const k of ["kcal", "protein_g", "carbs_g", "fat_g", "sugar_g", "salt_g"] as const) {
      if (body[k] !== undefined) {
        fields.push(`${k} = ?`);
        vals.push(parseAmount(body[k] as string | number | null));
      }
    }
    for (const k of ["favorite", "archived"] as const) {
      if (body[k] !== undefined) {
        fields.push(`${k} = ?`);
        vals.push(body[k] ? 1 : 0);
      }
    }
    if (fields.length) {
      vals.push(rid);
      db.prepare(`UPDATE recipe SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
    }

    if (Array.isArray(body.ingredients)) {
      db.prepare("DELETE FROM recipe_ingredient WHERE recipe_id = ?").run(rid);
      (body.ingredients as Array<{ name?: string; id?: number; amount?: number | string; unit?: string; note?: string }>)
        .filter((x) => x.name?.trim() || x.id != null)
        .forEach((x, i) => {
          const ingId = x.id ?? upsertIngredient(x.name!).id;
          const na = normalizeAmount(parseAmount(x.amount ?? null), x.unit);
          db.prepare(
            "INSERT INTO recipe_ingredient(recipe_id, ingredient_id, amount, unit, note, sort) VALUES (?,?,?,?,?,?)"
          ).run(rid, ingId, na.amount, na.unit || null, x.note || null, i);
        });
    }
    if (Array.isArray(body.steps)) {
      db.prepare("DELETE FROM step WHERE recipe_id = ?").run(rid);
      (body.steps as string[]).forEach((s, i) => {
        if (String(s).trim())
          db.prepare("INSERT INTO step(recipe_id, text, sort) VALUES (?,?,?)").run(rid, String(s).trim(), i);
      });
    }
    if (Array.isArray(body.tags)) {
      db.prepare("DELETE FROM recipe_tag WHERE recipe_id = ?").run(rid);
      for (const t of body.tags as string[])
        if (String(t).trim())
          db.prepare("INSERT OR IGNORE INTO recipe_tag(recipe_id, tag_id) VALUES (?,?)").run(rid, upsertTag(String(t)));
    }
  })();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  db.prepare("UPDATE recipe SET archived = 1 WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}
