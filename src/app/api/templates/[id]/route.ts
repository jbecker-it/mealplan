import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

type Ctx = { params: Promise<{ id: string }> };

// PATCH → umbenennen {name}
// DELETE → löschen
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await requireAuth();
  if (denied) return denied;
  const id = Number((await ctx.params).id);
  const body = await readJson(req);
  if (body === null) return badJson;
  const name = String((body as { name?: string }).name || "").trim();
  if (!name)
    return NextResponse.json({ error: "Name fehlt" }, { status: 400 });
  if (name.length > 60)
    return NextResponse.json({ error: "Name zu lang (max. 60 Zeichen)" }, { status: 400 });
  const cur = db
    .prepare("SELECT id, name FROM template WHERE id = ?")
    .get(id) as { id: number; name: string } | undefined;
  if (!cur)
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const clash = db
    .prepare("SELECT id FROM template WHERE name = ? AND id != ?")
    .get(name, id) as { id: number } | undefined;
  if (clash)
    return NextResponse.json({ error: "Name existiert bereits" }, { status: 409 });
  db.prepare("UPDATE template SET name = ? WHERE id = ?").run(name, id);
  return NextResponse.json({ ok: true, name });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const denied = await requireAuth();
  if (denied) return denied;
  const id = Number((await ctx.params).id);
  const cur = db.prepare("SELECT id, name FROM template WHERE id = ?").get(id) as
    | { id: number; name: string }
    | undefined;
  if (!cur)
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  db.prepare("DELETE FROM template WHERE id = ?").run(id);
  return NextResponse.json({ ok: true, name: cur.name });
}
