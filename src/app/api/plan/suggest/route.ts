import { NextRequest, NextResponse } from "next/server";
import { db, getActiveTemplate } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { personObjective, MacroTotals, tagAllowed } from "@/lib/engine";
import { PLAN_KEY } from "@/lib/plan";
import { profileTagNames } from "@/lib/ingredients";

// Vorschläge für den Austausch einer Mahlzeit, sortiert nach „bestem Ersatz"
// für genau diese Position: Jeder Kandidat (Rezept × Portion 0.5/1/1.5) wird
// in den aktuellen Tag eingesetzt und mit derselben Objective-Funktion
// bewertet wie der Optimizer (KH/Fett hart, Protein am Ziel, Zucker/Salz
// best-effort). Bei gemeinsamen Slots zählt zusätzlich die Bewertung des
// Partner-Profils. Beste Portion pro Rezept, Ranking aufsteigend nach Score.
export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const tplParam = sp.get("template");
  const template = tplParam === "A" || tplParam === "B" ? tplParam : getActiveTemplate();
  const slot = sp.get("slot");
  const profileId = Number(sp.get("profileId") || 0);
  if (!slot || !["B", "M", "A", "S"].includes(slot) || !profileId)
    return NextResponse.json({ error: "slot und profileId erforderlich" }, { status: 400 });

  const profiles = db
    .prepare(
      `SELECT id, kcal_target, p_target, c_target, f_target,
              COALESCE(sugar_target, 0) AS sugar_target,
              COALESCE(salt_target, 0) AS salt_target,
              tag_include, tag_exclude
       FROM profile ORDER BY id`
    )
    .all() as Array<Record<string, unknown>>;
  const me = profiles.find((p) => Number(p.id) === profileId);
  if (!me)
    return NextResponse.json({ error: "Profil nicht gefunden" }, { status: 404 });
  const shared = profiles.length === 2 && (slot === "M" || slot === "A");
  const other = profiles.find((p) => Number(p.id) !== profileId);

  const mkTargets = (p: Record<string, unknown>) => ({
    K: Number(p.kcal_target) || 2000,
    P: Number(p.p_target) || 80,
    C: Number(p.c_target) || 180,
    F: Number(p.f_target) || 70,
    SuT: Number(p.sugar_target) || 0,
    SaT: Number(p.salt_target) || 0,
  });
  const tMe = mkTargets(me);
  const tOther = other ? mkTargets(other) : null;

  // Aktueller Tag (Tag 0 — innerhalb des Templates alle Tage identisch).
  const rows = db
    .prepare(
      `SELECT pm.profile_id, pm.slot, pm.recipe_id, pm.servings, pm.kcal, pm.p, pm.c, pm.f, pm.sugar, pm.salt
       FROM plan_meal pm
       WHERE pm.week_key = ? AND pm.template_id = ? AND pm.day = 0`
    )
    .all(PLAN_KEY, template) as Array<Record<string, unknown>>;
  const dayRows = rows.filter((r) => Number(r.profile_id) === profileId);
  if (dayRows.length === 0)
    return NextResponse.json({ error: "Kein Plan vorhanden — zuerst generieren." }, { status: 400 });

  const dayTotals = (pid: number): MacroTotals => {
    const t: MacroTotals = { K: 0, P: 0, C: 0, F: 0, Su: 0, Sa: 0 };
    for (const r of rows.filter((x) => Number(x.profile_id) === pid)) {
      t.K += Number(r.kcal) || 0;
      t.P += Number(r.p) || 0;
      t.C += Number(r.c) || 0;
      t.F += Number(r.f) || 0;
      t.Su += Number(r.sugar) || 0;
      t.Sa += Number(r.salt) || 0;
    }
    return t;
  };
  const curTotalsMe = dayTotals(profileId);
  const curTotalsOther = other ? dayTotals(Number(other.id)) : null;
  const curSlotMe = dayRows.find((r) => r.slot === slot);
  const curSlotOther = curTotalsOther
    ? rows.find((r) => Number(r.profile_id) === Number(other!.id) && r.slot === slot)
    : null;

  // Kandidaten-Rezepte: Slot erlaubt + Tag-Filter des Profils.
  const recs = db
    .prepare(
      `SELECT r.id, r.title, r.slots, r.kcal, r.protein_g, r.carbs_g, r.fat_g, r.sugar_g, r.salt_g,
              (SELECT group_concat(t.name, '|') FROM recipe_tag rt
               JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id) AS tags
       FROM recipe r WHERE r.archived = 0 AND r.kcal IS NOT NULL`
    )
    .all() as Array<Record<string, unknown>>;
  // Tag-Filter: eigenes Profil; bei gemeinsamen Slots auch der Partner.
  // „Nur einschließen“ greift nur, wenn danach noch Kandidaten übrig sind.
  const allowedSlots = (s: string) => s.split(",").map((x) => x.trim());
  const recTags = (r: Record<string, unknown>) => String(r.tags || "").split("|").filter(Boolean);
  const filters = [me, ...(shared && other ? [other] : [])].map((p) => ({
    inc: profileTagNames(p.tag_include),
    exc: profileTagNames(p.tag_exclude),
  }));
  const inSlot = recs.filter((r) => allowedSlots(String(r.slots || "")).includes(slot));
  let cands = inSlot.filter((r) => filters.every((f) => tagAllowed(recTags(r), f.inc, f.exc, true)));
  if (!cands.length) cands = inSlot.filter((r) => filters.every((f) => tagAllowed(recTags(r), f.inc, f.exc, false)));

  const SIZES = [0.5, 1, 1.5];
  interface Suggestion {
    id: number;
    title: string;
    servings: number;
    kcal: number;
    p: number;
    c: number;
    f: number;
    sugar: number;
    salt: number;
    score: number;
    deltaKcal: number;
    current: boolean;
  }
  const out: Suggestion[] = [];
  for (const r of cands) {
    const kcal = Number(r.kcal) || 0;
    const p = Number(r.protein_g) || 0;
    const c = Number(r.carbs_g) || 0;
    const f = Number(r.fat_g) || 0;
    const su = Number(r.sugar_g) || 0;
    const sa = Number(r.salt_g) || 0;
    let bestScore = Infinity;
    let bestServ = 1;
    for (const sv of SIZES) {
      const newMe: MacroTotals = {
        K: curTotalsMe.K - (Number(curSlotMe?.kcal) || 0) + kcal * sv,
        P: curTotalsMe.P - (Number(curSlotMe?.p) || 0) + p * sv,
        C: curTotalsMe.C - (Number(curSlotMe?.c) || 0) + c * sv,
        F: curTotalsMe.F - (Number(curSlotMe?.f) || 0) + f * sv,
        Su: curTotalsMe.Su - (Number(curSlotMe?.sugar) || 0) + su * sv,
        Sa: curTotalsMe.Sa - (Number(curSlotMe?.salt) || 0) + sa * sv,
      };
      let score = personObjective(newMe, tMe);
      if (shared && curTotalsOther && curSlotOther) {
        const newOther: MacroTotals = {
          K: curTotalsOther.K - (Number(curSlotOther.kcal) || 0) + kcal * sv,
          P: curTotalsOther.P - (Number(curSlotOther.p) || 0) + p * sv,
          C: curTotalsOther.C - (Number(curSlotOther.c) || 0) + c * sv,
          F: curTotalsOther.F - (Number(curSlotOther.f) || 0) + f * sv,
          Su: curTotalsOther.Su - (Number(curSlotOther.sugar) || 0) + su * sv,
          Sa: curTotalsOther.Sa - (Number(curSlotOther.salt) || 0) + sa * sv,
        };
        score += personObjective(newOther, tOther!);
      }
      if (score < bestScore) {
        bestScore = score;
        bestServ = sv;
      }
    }
    out.push({
      id: Number(r.id),
      title: String(r.title),
      servings: bestServ,
      kcal: Math.round(kcal * bestServ),
      p: Math.round(p * bestServ * 10) / 10,
      c: Math.round(c * bestServ * 10) / 10,
      f: Math.round(f * bestServ * 10) / 10,
      sugar: Math.round(su * bestServ * 10) / 10,
      salt: Math.round(sa * bestServ * 100) / 100,
      score: Math.round(bestScore * 1000) / 1000,
      deltaKcal: Math.round(kcal * bestServ - (Number(curSlotMe?.kcal) || 0)),
      current: Number(r.id) === Number(curSlotMe?.recipe_id ?? -1),
    });
  }
  out.sort((a, b) => a.score - b.score || a.deltaKcal - b.deltaKcal);
  const top = out.slice(0, 10).map((s, i) => ({ ...s, rank: i + 1 }));

  return NextResponse.json({
    template,
    slot,
    profileId,
    shared,
    current: {
      recipeId: Number(curSlotMe?.recipe_id ?? 0),
      servings: Number(curSlotMe?.servings ?? 0),
    },
    suggestions: top,
  });
}
