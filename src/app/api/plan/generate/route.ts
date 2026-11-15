import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generatePlan, SLOT_KEYS, Recipe as EngRecipe, Person as EngPerson } from "@/lib/engine";
import { currentWeekKey, weekTemplate } from "@/lib/week";
import { requireAuth } from "@/lib/auth";

function loadPersons() {
  const rows = db.prepare("SELECT * FROM profile ORDER BY id").all() as Array<
    Record<string, unknown>
  >;
  return rows.map((p) => {
    const split = p.slot_split
      ? (JSON.parse(String(p.slot_split)) as { B: number; M: number; A: number; S: number })
      : { B: 600, M: 900, A: 800, S: 300 };
    return {
      name: String(p.name),
      id: Number(p.id),
      K: Number(p.kcal_target ?? 2500),
      P: Number(p.p_target ?? 150),
      C: Number(p.c_target ?? 300),
      F: Number(p.f_target ?? 70),
      split,
      tag_include: p.tag_include ? (JSON.parse(String(p.tag_include)) as number[]) : [],
      tag_exclude: p.tag_exclude ? (JSON.parse(String(p.tag_exclude)) as number[]) : [],
    };
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { week?: string };
  const week = body.week && /^\d{4}-W\d{1,2}$/.test(body.week) ? body.week : currentWeekKey();
  const template = weekTemplate(week);

  const persons = loadPersons();
  if (persons.length < 2)
    return NextResponse.json({ error: "Mindestens 2 Profile nötig" }, { status: 400 });

  // Kandidaten: Rezepte mit Makros, Tag-Filter pro Person
  const all = db
    .prepare(
      `SELECT r.id, r.title AS name, r.kcal AS K, r.protein_g AS P, r.carbs_g AS C, r.fat_g AS F,
              r.slots AS slot_list,
              GROUP_CONCAT(rt.tag_id, '|') AS tag_ids
       FROM recipe r
       LEFT JOIN recipe_tag rt ON rt.recipe_id = r.id
       WHERE r.archived = 0 AND r.kcal IS NOT NULL
       GROUP BY r.id`
    )
    .all() as Array<Record<string, unknown>>;

  const persons2 = persons as Array<EngPerson & { id: number; tag_include: number[]; tag_exclude: number[] }>;
  const pool = persons2.map((p) => {
    const list = all.filter((r) => {
      const ids = String(r.tag_ids || "")
        .split("|")
        .map((x) => Number(x))
        .filter((x) => !isNaN(x));
      if (p.tag_exclude.length && ids.some((x) => p.tag_exclude.includes(x))) return false;
      if (p.tag_include.length && !ids.some((x) => p.tag_include.includes(x))) return false;
      return true;
    });
    return list;
  });
  const common = pool[0].filter((r) => pool[1].some((x) => x.id === r.id));
  if (common.length < 5)
    return NextResponse.json(
      { error: `Nur ${common.length} gemeinsame Rezepte mit Makros — zu wenig für die Engine (min. 5)` },
      { status: 400 }
    );

  // Jeder Slot braucht mindestens 1 erlaubtes Rezept
  const SLOT_NAMES: Record<string, string> = { B: "Frühstück", M: "Mittag", A: "Abend", S: "Snack" };
  for (const k of ["B", "M", "A", "S"]) {
    const n = common.filter((r) =>
      !r.slot_list || String(r.slot_list).split(",").map((x) => x.trim()).includes(k)
    ).length;
    if (n === 0)
      return NextResponse.json(
        { error: `Kein Rezept erlaubt für „${SLOT_NAMES[k]}“ — mindestens ein Rezept mit diesem Slot setzen` },
        { status: 400 }
      );
  }
  const recipes: EngRecipe[] = common.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    K: Number(r.K),
    P: Number(r.P ?? 0),
    C: Number(r.C ?? 0),
    F: Number(r.F ?? 0),
    slots: String(r.slot_list ?? "B,M,A,S").split(",").map((s) => s.trim()).filter(Boolean) as EngRecipe["slots"],
  }));

  const engPersons: EngPerson[] = persons2.map(({ name, K, P, C, F, split }) => ({
    name, K, P, C, F, split,
  }));

  const t0 = Date.now();
  const { A, B } = generatePlan(engPersons, recipes);
  const days = template === "A" ? A : B;
  const ms = Date.now() - t0;

  const recById = new Map(recipes.map((r) => [r.id, r]));
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM plan_meal WHERE week_key = ?").run(week);
    const ins = db.prepare(
      `INSERT INTO plan_meal(week_key, template_id, day, profile_id, slot, recipe_id, servings, kcal, p, c, f)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (let d = 0; d < 7; d++) {
      persons2.forEach((p, pi) => {
        const personPlan = days[d][pi];
        personPlan.forEach((cell, si) => {
          if (!cell) return;
          const r = recById.get(cell.recipeId)!;
          const s = cell.servings;
          ins.run(
            week, template, d, p.id, SLOT_KEYS[si], r.id, s,
            r.K * s, r.P * s, r.C * s, r.F * s
          );
        });
      });
    }
  });
  tx();
  return NextResponse.json({ week, template, ms });
}
