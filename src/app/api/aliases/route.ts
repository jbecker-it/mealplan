import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson();
  const { ingredient_id, name } = raw as { ingredient_id?: number; name?: string };
  if (!ingredient_id || !name?.trim())
    return NextResponse.json(
      { error: "ingredient_id und name nötig" },
      { status: 400 }
    );
  const n = name.trim();
  if (
    !db.prepare("SELECT id FROM ingredient WHERE id = ?").get(ingredient_id)
  )
    return NextResponse.json({ error: "Zutat nicht gefunden" }, { status: 404 });
  if (db.prepare("SELECT id FROM ingredient WHERE name = ?").get(n))
    return NextResponse.json({ error: "Name ist bereits eine Zutat" }, { status: 409 });
  const ex = db
    .prepare("SELECT from_name, ingredient_id FROM alias WHERE from_name = ?")
    .get(n) as { from_name: string; ingredient_id: number } | undefined;
  if (ex) {
    if (ex.ingredient_id !== ingredient_id)
      return NextResponse.json(
        { error: "Alias gehört bereits zu einer anderen Zutat" },
        { status: 409 }
      );
    return NextResponse.json({ ok: true, existing: true });
  }
  db.prepare("INSERT INTO alias(from_name, ingredient_id) VALUES (?,?)").run(
    n,
    ingredient_id
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson();
  const { name } = raw as { name?: string };
  if (!name?.trim())
    return NextResponse.json({ error: "name fehlt" }, { status: 400 });
  const info = db.prepare("DELETE FROM alias WHERE from_name = ?").run(name.trim());
  if (info.changes === 0)
    return NextResponse.json({ error: "Alias nicht gefunden" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
