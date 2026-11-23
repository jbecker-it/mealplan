import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { findIngredientId } from "@/lib/ingredients";
import { parseAmount } from "@/lib/units";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.category, i.unit_default, i.per_el, i.rewe_product_id,
              (SELECT COUNT(*) FROM recipe_ingredient ri WHERE ri.ingredient_id = i.id) AS recipe_count
       FROM ingredient i ORDER BY i.category, i.name COLLATE NOCASE`
    )
    .all() as Array<Record<string, unknown>>;
  const aliases = db
    .prepare("SELECT ingredient_id, from_name FROM alias")
    .all() as Array<{ ingredient_id: number; from_name: string }>;
  const byIng = new Map<number, string[]>();
  for (const a of aliases) {
    const list = byIng.get(a.ingredient_id) ?? [];
    list.push(a.from_name);
    byIng.set(a.ingredient_id, list);
  }
  return NextResponse.json(
    rows.map((r) => ({ ...r, aliases: byIng.get(Number(r.id)) ?? [] }))
  );
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson();
  const { name, category, unit, per_el } = raw as {
    name?: string;
    category?: string;
    unit?: string;
    per_el?: number | string | null;
  };
  if (!name?.trim())
    return NextResponse.json({ error: "Name fehlt" }, { status: 400 });
  if (findIngredientId(name) != null)
    return NextResponse.json({ error: "Existiert bereits (als Zutat oder Alias)" }, { status: 409 });
  const pe = parseAmount(per_el ?? null);
  const id = Number(
    db
      .prepare("INSERT INTO ingredient(name, category, unit_default, per_el) VALUES (?,?,?,?)")
      .run(name.trim(), category?.trim() || "Kochen & Backen", unit || "g", pe && pe > 0 ? pe : null)
      .lastInsertRowid
  );
  return NextResponse.json({ id });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson();
  const { id, name, category, unit, per_el } = raw as {
    id?: number;
    name?: string;
    category?: string;
    unit?: string;
    per_el?: number | string | null;
  };
  if (!id)
    return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  const cur = db
    .prepare("SELECT id, name FROM ingredient WHERE id = ?")
    .get(id) as { id: number; name: string } | undefined;
  if (!cur)
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (name?.trim()) {
    const n = name.trim();
    if (n !== cur.name) {
      const clash = findIngredientId(n);
      if (clash != null && clash !== id)
        return NextResponse.json({ error: "Name existiert bereits" }, { status: 409 });
      db.prepare("UPDATE ingredient SET name = ? WHERE id = ?").run(n, id);
    }
  }
  if (category?.trim())
    db.prepare("UPDATE ingredient SET category = ? WHERE id = ?").run(category.trim(), id);
  if (unit?.trim())
    db.prepare("UPDATE ingredient SET unit_default = ? WHERE id = ?").run(unit.trim(), id);
  if (per_el !== undefined) {
    const pe = parseAmount(per_el);
    db.prepare("UPDATE ingredient SET per_el = ? WHERE id = ?").run(pe && pe > 0 ? pe : null, id);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson();
  const { id } = raw as { id?: number };
  if (!id)
    return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  const cur = db
    .prepare("SELECT id, name FROM ingredient WHERE id = ?")
    .get(id) as { name: string } | undefined;
  if (!cur)
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const count = (
    db
      .prepare("SELECT COUNT(*) AS c FROM recipe_ingredient WHERE ingredient_id = ?")
      .get(id) as { c: number }
  ).c;
  if (count > 0)
    return NextResponse.json(
      { error: `In ${count} Rezept(en) verwendet — kann nicht gelöscht werden` },
      { status: 409 }
    );
  db.prepare("DELETE FROM alias WHERE ingredient_id = ?").run(id);
  db.prepare("DELETE FROM ingredient WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
