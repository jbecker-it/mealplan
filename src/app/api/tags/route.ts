import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const rows = db
    .prepare(
      `SELECT t.id, t.name,
              (SELECT COUNT(*) FROM recipe_tag rt WHERE rt.tag_id = t.id) AS recipe_count
       FROM tag t ORDER BY t.name COLLATE NOCASE`
    )
    .all() as Array<Record<string, unknown>>;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson;
  const { name } = raw as { name?: string };
  if (!name?.trim())
    return NextResponse.json({ error: "Name fehlt" }, { status: 400 });
  const exists = db
    .prepare("SELECT id FROM tag WHERE name = ?")
    .get(name.trim()) as { id: number } | undefined;
  if (exists) return NextResponse.json({ id: exists.id });
  const id = Number(db.prepare("INSERT INTO tag(name) VALUES (?)").run(name.trim()).lastInsertRowid);
  return NextResponse.json({ id });
}
