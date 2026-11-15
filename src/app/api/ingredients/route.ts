import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.category, i.unit_default,
              (SELECT COUNT(*) FROM recipe_ingredient ri WHERE ri.ingredient_id = i.id) AS recipe_count
       FROM ingredient i ORDER BY i.category, i.name COLLATE NOCASE`
    )
    .all() as Array<Record<string, unknown>>;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson;
  const { name, category, unit } = raw as {
    name?: string;
    category?: string;
    unit?: string;
  };
  if (!name?.trim())
    return NextResponse.json({ error: "Name fehlt" }, { status: 400 });
  const exists = db
    .prepare("SELECT id FROM ingredient WHERE name = ?")
    .get(name.trim()) as { id: number } | undefined;
  if (exists)
    return NextResponse.json({ error: "Existiert bereits" }, { status: 409 });
  const id = Number(
    db
      .prepare("INSERT INTO ingredient(name, category, unit_default) VALUES (?,?,?)")
      .run(name.trim(), category || "Trockenwaren", unit || "g")
      .lastInsertRowid
  );
  return NextResponse.json({ id });
}
