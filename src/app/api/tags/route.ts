import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { upsertTag } from "@/lib/ingredients";

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
  if (raw === null) return badJson();
  const { name } = raw as { name?: string };
  if (!name?.trim())
    return NextResponse.json({ error: "Name fehlt" }, { status: 400 });
  return NextResponse.json({ id: upsertTag(name) });
}

// Umbenennen: { id, name }
export async function PATCH(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson();
  const id = Number(raw.id);
  const name = String(raw.name ?? "").trim();
  if (!id || !name) return NextResponse.json({ error: "id und name nötig" }, { status: 400 });
  const clash = db.prepare("SELECT id FROM tag WHERE name = ? AND id != ?").get(name, id);
  if (clash) return NextResponse.json({ error: "Tag existiert bereits" }, { status: 409 });
  db.prepare("UPDATE tag SET name = ? WHERE id = ?").run(name, id);
  return NextResponse.json({ ok: true });
}

// Löschen: { id } — entfernt das Tag auch aus Rezepten und Profil-Filtern
export async function DELETE(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson();
  const id = Number(raw.id);
  if (!id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  db.transaction(() => {
    db.prepare("DELETE FROM recipe_tag WHERE tag_id = ?").run(id);
    db.prepare("DELETE FROM tag WHERE id = ?").run(id);
    const profiles = db.prepare("SELECT id, tag_include, tag_exclude FROM profile").all() as Array<{
      id: number;
      tag_include: string | null;
      tag_exclude: string | null;
    }>;
    const strip = (raw: string | null) => {
      try {
        const arr = JSON.parse(raw || "[]");
        return Array.isArray(arr) ? JSON.stringify(arr.filter((x) => Number(x) !== id)) : raw;
      } catch {
        return raw;
      }
    };
    for (const p of profiles)
      db.prepare("UPDATE profile SET tag_include = ?, tag_exclude = ? WHERE id = ?").run(
        strip(p.tag_include),
        strip(p.tag_exclude),
        p.id
      );
  })();
  return NextResponse.json({ ok: true });
}
