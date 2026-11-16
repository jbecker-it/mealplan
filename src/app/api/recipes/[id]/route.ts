import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

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
      `SELECT ri.id, ri.amount, ri.unit, ri.note, ri.sort, i.id AS ingredient_id, i.name, i.category
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
  if (body === null) return badJson;
  const rid = Number(id);

  if (body.slots !== undefined) {
    const arr = Array.isArray(body.slots) ? (body.slots as string[]) : String(body.slots).split(",");
    const cleaned = arr.map((s) => String(s).trim()).filter((s) => ["B", "M", "A", "S"].includes(s));
    db.prepare("UPDATE recipe SET slots = ? WHERE id = ?").run(
      (cleaned.length ? cleaned : ["B", "M", "A", "S"]).join(","),
      rid
    );
  }
  const fields: string[] = [];
  const vals: Array<string | number | null> = [];
  for (const k of [
    "title",
    "description",
    "kcal",
    "protein_g",
    "carbs_g",
    "fat_g",
    "sugar_g",
    "salt_g",
    "favorite",
    "archived",
  ] as const) {
    if (body[k] !== undefined) {
      fields.push(`${k} = ?`);
      vals.push(
        k === "favorite" || k === "archived"
          ? (body[k] ? 1 : 0)
          : (body[k] as string | number | null)
      );
    }
  }
  if (fields.length) {
    vals.push(rid);
    db.prepare(`UPDATE recipe SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  }

  if (body.ingredients) {
    const upsertIng = (name: string): number => {
      const n = name.trim();
      const row = db.prepare("SELECT id FROM ingredient WHERE name = ?").get(n) as
        | { id: number }
        | undefined;
      if (row) return Number(row.id);
      const info = db
        .prepare("INSERT INTO ingredient(name, category, unit_default) VALUES (?,?,?)")
        .run(n, "Trockenwaren", "g");
      return Number(info.lastInsertRowid);
    };
    db.prepare("DELETE FROM recipe_ingredient WHERE recipe_id = ?").run(rid);
    (body.ingredients as Array<{ name?: string; id?: number; amount?: number; unit?: string; note?: string }>)
      .filter((x) => x.name?.trim() || x.id != null)
      .forEach((x, i) => {
        const ingId = x.id ?? upsertIng(x.name!);
        db.prepare(
          "INSERT INTO recipe_ingredient(recipe_id, ingredient_id, amount, unit, note, sort) VALUES (?,?,?,?,?,?)"
        ).run(rid, ingId, x.amount ?? null, x.unit || null, x.note || null, i);
      });
  }
  if (body.steps) {
    db.prepare("DELETE FROM step WHERE recipe_id = ?").run(rid);
    (body.steps as string[]).forEach((s, i) => {
      if (s.trim())
        db.prepare("INSERT INTO step(recipe_id, text, sort) VALUES (?,?,?)").run(rid, s.trim(), i);
    });
  }
  if (body.tags) {
    const upsertTag = (name: string): number => {
      const n = name.trim();
      const row = db.prepare("SELECT id FROM tag WHERE name = ?").get(n) as
        | { id: number }
        | undefined;
      if (row) return Number(row.id);
      const info = db.prepare("INSERT INTO tag(name) VALUES (?)").run(n);
      return Number(info.lastInsertRowid);
    };
    db.prepare("DELETE FROM recipe_tag WHERE recipe_id = ?").run(rid);
    for (const t of body.tags as string[])
      if (t.trim())
        db.prepare("INSERT OR IGNORE INTO recipe_tag(recipe_id, tag_id) VALUES (?,?)").run(rid, upsertTag(t));
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  db.prepare("UPDATE recipe SET archived = 1 WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}
