import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const profiles = db.prepare("SELECT * FROM profile ORDER BY id").all() as Array<
    Record<string, unknown>
  >;
  const tags = db.prepare("SELECT id, name FROM tag ORDER BY name").all() as Array<{
    id: number;
    name: string;
  }>;
  const parse = (v: unknown): number[] => {
    if (!v) return [];
    try {
      return JSON.parse(String(v));
    } catch {
      return [];
    }
  };
  return NextResponse.json({
    profiles: profiles.map((p) => ({
      ...p,
      slot_split: p.slot_split ? JSON.parse(String(p.slot_split)) : null,
      tag_include: parse(p.tag_include),
      tag_exclude: parse(p.tag_exclude),
    })),
    tags,
  });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson;
  const body = raw as {
    id: number;
    name?: string;
    kcal_target?: number;
    p_target?: number;
    c_target?: number;
    f_target?: number;
    sugar_target?: number;
    salt_target?: number;
    split?: { B: number; M: number; A: number; S: number };
    tag_include?: number[];
    tag_exclude?: number[];
  };
  if (!body.id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  db.prepare(
    `UPDATE profile SET name = ?, kcal_target = ?, p_target = ?, c_target = ?, f_target = ?,
     sugar_target = ?, salt_target = ?,
     slot_split = ?, tag_include = ?, tag_exclude = ? WHERE id = ?`
  ).run(
    body.name,
    body.kcal_target,
    body.p_target,
    body.c_target,
    body.f_target,
    body.sugar_target ?? 0,
    body.salt_target ?? 0,
    body.split ? JSON.stringify(body.split) : null,
    body.tag_include ? JSON.stringify(body.tag_include) : null,
    body.tag_exclude ? JSON.stringify(body.tag_exclude) : null,
    body.id
  );
  return NextResponse.json({ ok: true });
}
