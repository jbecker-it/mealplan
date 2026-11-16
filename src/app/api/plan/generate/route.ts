import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { generatePlan } from "@/lib/engine";
import { currentWeekKey, shiftWeek, weekNum } from "@/lib/week";

// Wochenplan generieren: 2 Templates (A und B), je EIN Tag, der innerhalb
// des Templates an allen 7 Tagen identisch gilt.
// EINE Woche = EINES Template: A → ungerade Woche, B → die Folgewoche.
// {week?} optional — Standard: aktuelle Woche; das Paar richtet sich
// nach ihr (ungerade Woche W → A in W, B in W+1; gerade Woche W → A in W-1, B in W).
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  let week = currentWeekKey();
  try {
    const body = await req.clone().json().catch(() => null);
    if (body && typeof body.week === "string" && /^\d{4}-W\d{1,2}$/.test(body.week))
      week = body.week;
  } catch {
    // Body optional
  }
  const aWeek = weekNum(week) % 2 === 1 ? week : shiftWeek(week, -1);
  const bWeek = aWeek === week ? shiftWeek(aWeek, 1) : week;

  const profiles = db
    .prepare(
      `SELECT id, kcal_target, p_target, c_target, f_target,
              COALESCE(sugar_target, 0) AS sugar_target,
              COALESCE(salt_target, 0) AS salt_target,
              tag_include, tag_exclude
       FROM profile ORDER BY id`
    )
    .all() as Array<Record<string, unknown>>;
  if (profiles.length < 2)
    return NextResponse.json(
      { error: "Mindestens zwei Profile mit Makro-Zielen werden benötigt." },
      { status: 400 }
    );
  const persons = profiles.map((p) => ({
    id: Number(p.id),
    K: Number(p.kcal_target) || 2000,
    P: Number(p.p_target) || 80,
    C: Number(p.c_target) || 180,
    F: Number(p.f_target) || 70,
    SuT: Number(p.sugar_target) || 0,
    SaT: Number(p.salt_target) || 0,
    inc: String(p.tag_include || "").split(",").map((s) => s.trim()).filter(Boolean),
    exc: String(p.tag_exclude || "").split(",").map((s) => s.trim()).filter(Boolean),
  }));

  const recs = db
    .prepare(
      `SELECT r.id, r.title, r.slots, r.kcal, r.protein_g, r.carbs_g, r.fat_g,
              r.sugar_g, r.salt_g,
              (SELECT group_concat(t.name, ',') FROM recipe_tag rt
               JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id) AS tags
       FROM recipe r WHERE r.archived = 0 AND r.kcal IS NOT NULL`
    )
    .all() as Array<Record<string, unknown>>;
  if (recs.length === 0)
    return NextResponse.json(
      { error: "Keine Rezepte vorhanden — zuerst Rezepte importieren oder anlegen." },
      { status: 400 }
    );

  const opts = recs.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    slots: String(r.slots || "B,M,A,S").split(",").map((s) => s.trim()).filter(Boolean),
    kcal: Number(r.kcal) || 0,
    p: Number(r.protein_g) || 0,
    c: Number(r.carbs_g) || 0,
    f: Number(r.fat_g) || 0,
    Su: r.sugar_g == null ? null : Number(r.sugar_g),
    Sa: r.salt_g == null ? null : Number(r.salt_g),
  }));

  let res;
  try {
    res = generatePlan(persons, opts);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Optimierung fehlgeschlagen" },
      { status: 500 }
    );
  }

  // Beide Templates schreiben, je 7 identische Tage — A und B landen in
  // ZWEI aufeinanderfolgenden Wochen (EINE Woche = EINES Template).
  const upsert = db.prepare(
    `INSERT INTO plan_meal(week_key, template_id, day, profile_id, slot, recipe_id, servings, kcal, p, c, f, sugar, salt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(week_key, template_id, day, profile_id, slot) DO UPDATE SET
       recipe_id = excluded.recipe_id, servings = excluded.servings,
       kcal = excluded.kcal, p = excluded.p, c = excluded.c, f = excluded.f,
       sugar = excluded.sugar, salt = excluded.salt`
  );
  // UNIQUE-Index für den ON-CONFLICT-Pfad sicherstellen
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_slot ON
     plan_meal(week_key, template_id, day, profile_id, slot)`
  );
  const writeTemplate = (tid: "A" | "B", wk: string, dayPlan: typeof res.A) => {
    for (let day = 0; day < 7; day++) {
      for (const pd of dayPlan) {
        for (const slot of ["B", "M", "A", "S"] as const) {
          const ch = pd[slot];
          upsert.run(
            wk, tid, day, pd.profileId, slot, ch.recipe.id, ch.servings,
            ch.recipe.kcal * ch.servings,
            ch.recipe.p * ch.servings,
            ch.recipe.c * ch.servings,
            ch.recipe.f * ch.servings,
            (ch.recipe.Su ?? 0) * ch.servings,
            (ch.recipe.Sa ?? 0) * ch.servings
          );
        }
      }
    }
  };
  db.transaction(() => {
    writeTemplate("A", aWeek, res.A);
    writeTemplate("B", bWeek, res.B);
  })();

  return NextResponse.json({
    ok: true,
    week: aWeek,
    weeks: { A: aWeek, B: bWeek },
    ms: res.ms,
    note: `Plan generiert (${res.ms} ms): Template A → Woche ${aWeek}, Template B → Woche ${bWeek}.`,
  });
}
