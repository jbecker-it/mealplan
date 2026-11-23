import { NextRequest, NextResponse } from "next/server";
import { db, getActiveTemplate } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { generateTemplate } from "@/lib/engine";
import { PLAN_KEY, Tpl, currentRows, loadPersons, loadRecipeOpts, setMeal, snapshot } from "@/lib/plan";

// EIN Template (Standard: das aktive) neu generieren — das andere bleibt
// unangetastet. Der bisherige Stand wird vorher als Snapshot gesichert
// (Verlauf im Plan, wiederherstellbar).
// Body: { template?: "A" | "B" }
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await readJson(req);
  if (body === null) return badJson();
  const tpl: Tpl = body.template === "A" || body.template === "B" ? body.template : getActiveTemplate();
  const other: Tpl = tpl === "A" ? "B" : "A";

  const persons = loadPersons();
  if (persons.length < 2)
    return NextResponse.json(
      { error: "Mindestens zwei Profile mit Makro-Zielen werden benötigt." },
      { status: 400 }
    );
  const opts = loadRecipeOpts();
  if (opts.length === 0)
    return NextResponse.json(
      { error: "Keine Rezepte vorhanden — zuerst Rezepte importieren oder anlegen." },
      { status: 400 }
    );

  // Rezepte des anderen Templates leicht meiden (Abwechslung)
  const avoid = new Set(
    (
      db
        .prepare("SELECT DISTINCT recipe_id FROM plan_meal WHERE week_key = ? AND template_id = ?")
        .all(PLAN_KEY, other) as Array<{ recipe_id: number }>
    ).map((r) => Number(r.recipe_id))
  );

  let res;
  try {
    // Signatur des bisherigen Stands → möglichst eine andere Variante liefern
    const prev = currentRows(tpl)
      .map((r) => `${r.profile_id}${r.slot}${r.recipe_id}x${Number(r.servings)}`)
      .sort()
      .join(",");
    res = generateTemplate(persons, opts, avoid, Date.now(), prev);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Optimierung fehlgeschlagen" },
      { status: 500 }
    );
  }

  db.transaction(() => {
    snapshot(tpl, `Template ${tpl} vor Neu-Generierung`);
    db.prepare("DELETE FROM plan_meal WHERE week_key = ? AND template_id = ?").run(PLAN_KEY, tpl);
    for (const pd of res.days)
      for (const slot of ["B", "M", "A", "S"] as const)
        setMeal(tpl, pd.profileId, slot, pd[slot].recipe.id, pd[slot].servings);
  })();

  return NextResponse.json({
    ok: true,
    template: tpl,
    ms: res.ms,
    note: `Template ${tpl} neu generiert (${res.ms} ms). Der vorherige Stand liegt im Verlauf.`,
  });
}
