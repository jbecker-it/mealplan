import { clampServings, sizesFor } from "./servings";
// Mealplan-Optimizer — 2x2-Template-Modell (Stand 2026-11-16)
//
// Ein Template = EINE Tag-Planung (4 Slots × 2 Profile), die innerhalb des
// Templates an allen 7 Tagen der Woche identisch gilt (Meal-Prep-Logik).
// Jedes Template wird einzeln generiert (nur das aktive); Rezepte des
// anderen Templates werden leicht bestraft (Abwechslung zwischen A und B).
// Profil-Tags: „ausschließen“ hart, „nur einschließen“ wenn möglich.
//
// Constraint-Hierarchie (Vorgabe Johannes, 2026-11-17):
//  1. Protein: möglichst mindestens voll — Defizit hart bestraft,
//     Überschuss erlaubt (nur leicht bestraft).
//  2. Kalorien: möglichst nah voll (Defizit bestraft), dürfen aber nicht
//     mehr als +50 kcal über dem Ziel liegen.
//  3. Kohlenhydrate und Fett: Überschreitung vermeiden (hart gewichtet).
//  4. SOFT: Zucker und Salz best-effort unter dem Tagesziel (nur Überschuss
//     bestraft; Ziel 0 = unbeachtlich).
//  5. SLOT-AUFWERTUNG (2026-11-21, User: „Nicht 200 kcal Mittag + 1000 kcal
//     Abend“): Die kcal-Ziele der Slots (profile.slot_split; Fallback feste
//     Anteile) werden eingehalten — innerhalb ±25 % des Slot-Ziels sanft
//     (SLOT_FIT), darüber hart (SLOT_HARD).
//
// Diskrete Portionen: global 0.5, 1, 1.5 — pro Rezept überschreibbar
// (recipe.servings_allowed, z. B. Waffeln nur 1/1.5/2). Bei gemeinsamen Slots
// wird die Partner-Portion auf die nächstgelegene erlaubte Größe gezogen.
// Deterministisch: feste Iterationsreihenfolge.

export interface RecipeOpt {
  id: number;
  title: string;
  slots: string[]; // erlaubte Slots, z. B. ["B","M","A"]
  kcal: number; // pro Portion (1.0)
  p: number;
  c: number;
  f: number;
  Su?: number | null; // Zucker g/Portion (best-effort-Makro)
  Sa?: number | null; // Salz g/Portion (best-effort-Makro)
  tags?: string[]; // Rezept-Tags (für Profil-Filter)
  sizes?: number[]; // erlaubte Portionen (leer/fehlt = globale Vorgabe)
}

export interface Person {
  id: number;
  K: number; // kcal-Ziel (nah voll, Band +50 kcal)
  P: number; // Protein-Ziel (möglichst mindestens voll, Überschuss ok)
  C: number; // Kohlenhydrat-Ziel (hart)
  F: number; // Fett-Ziel (hart)
  SuT?: number; // Zucker-Ziel (best-effort, 0 = unbeachtlich)
  SaT?: number; // Salz-Ziel (best-effort, 0 = unbeachtlich)
  slotK?: { B: number; M: number; A: number; S: number } | null; // kcal-Ziel je Slot (profile.slot_split; 0/leer = Fallback-Anteile)
  inc: string[]; // Tag-Namen: nur Rezepte mit mind. einem dieser Tags (leer = alle)
  exc: string[]; // Tag-Namen: Rezepte mit einem dieser Tags nie
}

export interface SlotChoice {
  recipe: RecipeOpt;
  servings: number;
}

// Ein Tag für eine Person — innerhalb eines Templates an 7 Tagen identisch.
export interface PersonDay {
  profileId: number;
  B: SlotChoice;
  M: SlotChoice;
  A: SlotChoice;
  S: SlotChoice;
}

const sz = (r: RecipeOpt) => sizesFor(r.sizes);
const SLOTS = ["B", "M", "A", "S"] as const;
type Slot = (typeof SLOTS)[number];

const SLOT_KCAL: Record<Slot, number> = { B: 0.22, M: 0.35, A: 0.32, S: 0.11 };
const SLOT_P: Record<Slot, number> = { B: 0.14, M: 0.33, A: 0.33, S: 0.2 };

// ---- Gewichte der Objective-Funktion (siehe Header-Hierarchie) ----
const HARD = 5.0; // C/F-Überschreitung / kcal-Überschreitung über der Band
const K_BAND = 50; // kcal-Toleranzband: +50 kcal dürfen drüber
const P_SHORT = 4.0; // Protein unter Ziel ("müssen mindestens voll")
const K_SHORT = 3.0; // kcal unter Ziel ("möglichst nah voll")
const P_OVER = 0.3; // Protein über Ziel (erlaubt, leicht)
const SOFT = 0.4; // Zucker/Salz-Überschuss (best-effort)
const SLOT_FIT = 0.3; // Slot-Anteile (kcal + Protein) — sanft innerhalb der Band
const SLOT_BAND = 0.25; // Slot-kcal-Band: ±25 % des Slot-Ziels bleibt soft
const SLOT_HARD = 1.5; // Slot-kcal-Ausreißer außerhalb der Band (extreme Schieflage verhindern)
const DUP = 1.0; // gleiche Rezepte innerhalb einer Person
const CROSS = 0.6; // Rezepte, die Template A schon nutzt (nur für B)

export interface MacroTotals {
  K: number;
  P: number;
  C: number;
  F: number;
  Su: number;
  Sa: number;
}

export interface PersonTargets {
  K: number;
  P: number;
  C: number;
  F: number;
  SuT?: number;
  SaT?: number;
}

function safeDiv(x: number, d: number): number {
  return d > 0 ? x / d : 0;
}

// kcal-Ziel eines Slots für eine Person: profile.slot_split (wenn gesetzt),
// sonst feste Anteile des Tagesziels (SLOT_KCAL).
function slotTargetK(per: Person, s: Slot): number {
  const v = per.slotK?.[s];
  return v && v > 0 ? v : SLOT_KCAL[s] * per.K;
}

// Reine Makro-Bewertung eines Tages (ohne Slot-Fit/Abwechslung).
// Wird auch von der Swap-Vorschlags-API verwendet.
export function personObjective(t: MacroTotals, per: PersonTargets): number {
  if (t.K === 0) return 1e9;
  let obj = 0;
  // kcal: Defizit bestrafen (nah voll), Überschuss erst über dem 50-kcal-Band
  obj += K_SHORT * safeDiv(Math.max(0, per.K - t.K), per.K);
  obj += HARD * safeDiv(Math.max(0, t.K - per.K - K_BAND), per.K);
  // Kohlenhydrate + Fett: Überschreitung vermeiden
  obj += HARD * safeDiv(Math.max(0, t.C - per.C), per.C);
  obj += HARD * safeDiv(Math.max(0, t.F - per.F), per.F);
  // Protein: Defizit hart, Überschuss erlaubt
  obj += P_SHORT * safeDiv(Math.max(0, per.P - t.P), per.P);
  obj += P_OVER * safeDiv(Math.max(0, t.P - per.P), per.P);
  obj += per.SuT ? SOFT * safeDiv(Math.max(0, t.Su - per.SuT), per.SuT) : 0;
  obj += per.SaT ? SOFT * safeDiv(Math.max(0, t.Sa - per.SaT), per.SaT) : 0;
  return obj;
}

function totalsOf(day: PersonDay): MacroTotals {
  const t: MacroTotals = { K: 0, P: 0, C: 0, F: 0, Su: 0, Sa: 0 };
  for (const s of SLOTS) {
    const { recipe, servings } = day[s];
    t.K += recipe.kcal * servings;
    t.P += recipe.p * servings;
    t.C += recipe.c * servings;
    t.F += recipe.f * servings;
    t.Su += (recipe.Su ?? 0) * servings;
    t.Sa += (recipe.Sa ?? 0) * servings;
  }
  return t;
}

// Gesamtbewertung eines Tages für eine Person (Makros + Slot-Fit + Abwechslung).
function personDayObjective(day: PersonDay, per: Person): number {
  const t = totalsOf(day);
  if (t.K === 0) return 1e9;
  let obj = personObjective(t, per);
  for (const s of SLOTS) {
    const { recipe, servings } = day[s];
    // Slot-kcal: innerhalb ±SLOT_BAND des Slot-Ziels sanft zentrieren,
    // außerhalb hart bestrafen (verhindert z. B. 200-kcal-Mittag/1000-kcal-Abend).
    const target = slotTargetK(per, s);
    const dev = Math.abs(recipe.kcal * servings - target);
    const band = SLOT_BAND * target;
    obj += SLOT_FIT * (Math.min(dev, band) / per.K);
    obj += SLOT_HARD * (Math.max(0, dev - band) / per.K);
    obj += SLOT_FIT * (Math.abs(recipe.p * servings - SLOT_P[s] * per.P) / per.P) * 0.7;
  }
  const seen = new Map<number, number>();
  for (const s of SLOTS) {
    const id = day[s].recipe.id;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const n of seen.values()) obj += DUP * (n * (n - 1)) / 2;
  return obj;
}

function totalObjective(
  days: PersonDay[],
  persons: Person[],
  recs: RecipeOpt[],
  recsA?: Set<number>
): number {
  let total = 0;
  for (let i = 0; i < days.length; i++) {
    total += personDayObjective(days[i], persons[i] ?? persons[0]);
    if (recsA) {
      for (const s of SLOTS) {
        if (recsA.has(days[i][s].recipe.id)) total += CROSS;
      }
    }
  }
  return total;
}

// Tag-Filter des Profils (case-insensitiv). Ausschluss ist hart; der
// Einschluss („nur diese Tags“) greift nur, wenn er für den Slot überhaupt
// Rezepte übrig lässt — sonst bliebe der Slot leer.
export function tagAllowed(tags: string[] | undefined, inc: string[], exc: string[], strictInc = true): boolean {
  const t = new Set((tags ?? []).map((x) => x.toLocaleLowerCase("de-DE")));
  for (const w of exc) if (t.has(w.toLocaleLowerCase("de-DE"))) return false;
  if (strictInc && inc.length && !inc.some((w) => t.has(w.toLocaleLowerCase("de-DE")))) return false;
  return true;
}

function allowed(rec: RecipeOpt, slot: Slot, per: Person, strictInc = true): boolean {
  if (!rec.slots.includes(slot)) return false;
  return tagAllowed(rec.tags, per.inc, per.exc, strictInc);
}

// Gemeinsame Slots: das Rezept muss für BEIDE Personen erlaubt sein.
let PERSONS: Person[] = [];
const incUsable = new Map<string, boolean>();
function allowedFor(rec: RecipeOpt, slot: Slot, per: Person, recs: RecipeOpt[]): boolean {
  const key = `${per.id}:${slot}`;
  if (!incUsable.has(key))
    incUsable.set(key, per.inc.length > 0 && recs.some((r) => allowed(r, slot, per, true)));
  return allowed(rec, slot, per, incUsable.get(key)!);
}
function allowedShared(rec: RecipeOpt, slot: Slot, per: Person, recs: RecipeOpt[]): boolean {
  if (!allowedFor(rec, slot, per, recs)) return false;
  if (PERSONS.length === 2 && (slot === "M" || slot === "A")) {
    const other = PERSONS.find((p) => p !== per);
    if (other && !allowedFor(rec, slot, other, recs)) return false;
  }
  return true;
}

function candidates(
  recs: RecipeOpt[],
  slot: Slot,
  per: Person,
  avoid?: Set<number>,
  limit = 18
): RecipeOpt[] {
  let out = recs.filter((r) => allowedShared(r, slot, per, recs) && !(avoid?.has(r.id)));
  // Partner-Filter lässt nichts übrig → wenigstens eigene Filter einhalten
  if (!out.length) out = recs.filter((r) => allowedFor(r, slot, per, recs) && !(avoid?.has(r.id)));
  // Portions-bewusste Sortierung: Rang nach der besten erreichbaren Nähe zum
  // Slot-Ziel (über alle Portionen). Sonst fallen z. B. Pancakes (450 kcal Basis,
  // mit 1,5 Portion exakt 675 ≈ Ziel 670) aus dem Kandidaten-Pool.
  const tgt = slotTargetK(per, slot);
  const fit = (r: RecipeOpt) => Math.min(...sz(r).map((s) => Math.abs(r.kcal * s - tgt)));
  out.sort((a, b) => fit(a) - fit(b));
  return out.slice(0, limit);
}

function initial(persons: Person[], recs: RecipeOpt[], rnd: () => number = () => 0): PersonDay[] {
  const days: PersonDay[] = [];
  persons.forEach((per, i) => {
    const day: PersonDay = {
      profileId: per.id,
      B: { recipe: recs[0], servings: 1 },
      M: { recipe: recs[0], servings: 1 },
      A: { recipe: recs[0], servings: 1 },
      S: { recipe: recs[0], servings: 1 },
    };
    for (const slot of SLOTS) {
      const c = candidates(recs, slot, per, undefined, 6);
      if (c.length) {
        // Gemeinsame Slots (Mittag/Abend): beide starten mit demselben Rezept
        const shared = persons.length === 2 && (slot === "M" || slot === "A");
        const r = Math.floor(rnd() * c.length);
        const recipe = shared ? (i === 0 ? c[r] : days[0][slot].recipe) : c[(i + r) % c.length];
        const sizes = sz(recipe);
        day[slot] = {
          recipe,
          servings: sizes[(i + SLOTS.indexOf(slot) + Math.floor(rnd() * 3)) % sizes.length],
        };
      }
    }
    days.push(day);
  });
  return days;
}

// Ein Tag optimieren: beste (Rezept, Portion) je Slot pro Person.
// Gemeinsame Slots (Mittag/Abend) werden für beide Personen mit demselben
// Rezept besetzt, aber mit jeweils eigener Portion.
// Move-Typen: (1) Einzel-Slot-Wechsel, (2) Paar-Move — zwei Slots gleichzeitig
// (z. B. Frühstück rauf + Abendessen runter). Einzel-Moves können kompensierende
// Änderungen nie finden, weil jede Einzelveränderung die Makros verschlechtert;
// nur der Paar-Move löst die Slot-Aufteilung auf.
function optimize(
  persons: Person[],
  recs: RecipeOpt[],
  start: PersonDay[],
  recsA?: Set<number>,
  iterations = 40
): PersonDay[] {
  const days = start.map((d) => ({ ...d, B: { ...d.B }, M: { ...d.M }, A: { ...d.A }, S: { ...d.S } }));
  let best = totalObjective(days, persons, recs, recsA);
  const sharedSlot = (s: Slot) => persons.length === 2 && (s === "M" || s === "A");
  for (let it = 0; it < iterations; it++) {
    let improved = false;
    for (let pi = 0; pi < days.length; pi++) {
      const per = persons[pi] ?? persons[0];
      for (const slot of SLOTS) {
        const cur = days[pi][slot];
        const shared = sharedSlot(slot);
        const used = new Set<number>();
        for (const s of SLOTS) if (s !== slot) used.add(days[pi][s].recipe.id);
        const cands = candidates(recs, slot, per, used, 14);
        const partnerCur = shared ? days[1 - pi][slot] : null;
        for (const rec of cands) {
          for (const servings of sz(rec)) {
            if (rec.id === cur.recipe.id && servings === cur.servings) continue;
            days[pi][slot] = { recipe: rec, servings };
            if (shared) {
              const partner = days[1 - pi];
              partner[slot] = { recipe: rec, servings: clampServings(partnerCur!.servings, sz(rec)) };
            }
            const obj = totalObjective(days, persons, recs, recsA);
            if (obj < best - 1e-9) {
              best = obj;
              improved = true;
              // restliche Kandidaten in dieser Runde überspringen
              cands.length = 0;
              break;
            }
            days[pi][slot] = { recipe: cur.recipe, servings: cur.servings };
            if (shared) days[1 - pi][slot] = partnerCur!;
          }
        }
      }
      // ---- Paar-Move: zwei Slots gleichzeitig (beste Änderung, ein Commit) ----
      let pairBest = best;
      let pairMove: {
        si: Slot;
        sj: Slot;
        ci: RecipeOpt;
        qi: number;
        cj: RecipeOpt;
        qj: number;
      } | null = null;
      for (let a = 0; a < SLOTS.length; a++) {
        for (let b = a + 1; b < SLOTS.length; b++) {
          const si = SLOTS[a];
          const sj = SLOTS[b];
          const curI = days[pi][si];
          const curJ = days[pi][sj];
          const partI = sharedSlot(si) ? days[1 - pi][si] : null;
          const partJ = sharedSlot(sj) ? days[1 - pi][sj] : null;
          const used = new Set<number>();
          for (const s of SLOTS) if (s !== si && s !== sj) used.add(days[pi][s].recipe.id);
          const cI = candidates(recs, si, per, used, 8);
          const cJ = candidates(recs, sj, per, used, 8);
          for (const recI of cI) {
            for (const qI of sz(recI)) {
              if (recI.id === curI.recipe.id && qI === curI.servings) continue;
              for (const recJ of cJ) {
                for (const qJ of sz(recJ)) {
                  if (recJ.id === curJ.recipe.id && qJ === curJ.servings) continue;
                  days[pi][si] = { recipe: recI, servings: qI };
                  days[pi][sj] = { recipe: recJ, servings: qJ };
                  if (partI) days[1 - pi][si] = { recipe: recI, servings: clampServings(partI.servings, sz(recI)) };
                  if (partJ) days[1 - pi][sj] = { recipe: recJ, servings: clampServings(partJ.servings, sz(recJ)) };
                  const obj = totalObjective(days, persons, recs, recsA);
                  if (obj < pairBest) {
                    pairBest = obj;
                    pairMove = { si, sj, ci: recI, qi: qI, cj: recJ, qj: qJ };
                  }
                  // Rollback (inkl. Partner bei geteilten Slots)
                  days[pi][si] = { recipe: curI.recipe, servings: curI.servings };
                  days[pi][sj] = { recipe: curJ.recipe, servings: curJ.servings };
                  if (partI) days[1 - pi][si] = partI;
                  if (partJ) days[1 - pi][sj] = partJ;
                }
              }
            }
          }
        }
      }
      if (pairMove && pairBest < best - 1e-9) {
        const { si, sj, ci, qi, cj, qj } = pairMove;
        days[pi][si] = { recipe: ci, servings: qi };
        days[pi][sj] = { recipe: cj, servings: qj };
        if (sharedSlot(si))
          days[1 - pi][si] = { recipe: ci, servings: clampServings(days[1 - pi][si].servings, sz(ci)) };
        if (sharedSlot(sj))
          days[1 - pi][sj] = { recipe: cj, servings: clampServings(days[1 - pi][sj].servings, sz(cj)) };
        best = pairBest;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return days;
}

/** Vergleichs-Signatur eines Plans (Profil/Slot → Rezept × Portion). */
export function planSignature(
  days: Array<{ profileId: number } & Record<Slot, { recipe: { id: number }; servings: number }>>
): string {
  return days
    .flatMap((d) => SLOTS.map((s) => `${d.profileId}${s}${d[s].recipe.id}x${d[s].servings}`))
    .sort()
    .join(",");
}

// Kleiner deterministischer Zufallsgenerator (mulberry32)
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * EIN Template generieren. avoid = Rezepte des anderen Templates
 * (werden leicht bestraft → Abwechslung zwischen A und B).
 * Mehrere zufällige Startpunkte; gewählt wird zufällig unter den
 * Ergebnissen, die höchstens 12 % schlechter sind als das beste — so
 * liefert „Neu generieren“ jedes Mal eine andere, aber gute Kombination.
 */
export function generateTemplate(
  persons: Person[],
  recipes: RecipeOpt[],
  avoid?: Set<number>,
  seed = Date.now(),
  previous?: string
): { days: PersonDay[]; ms: number } {
  const t0 = Date.now();
  if (!persons.length || !recipes.length) {
    throw new Error("Es werden mindestens ein Profil und ein Rezept benötigt.");
  }
  const recs = recipes.filter((r) => r.kcal > 0 && r.slots.length > 0);
  if (!recs.length) throw new Error("Keine Rezepte mit kcal-Werten gefunden.");
  PERSONS = persons;
  incUsable.clear();
  const rnd = rng(seed);
  const av = avoid && avoid.size ? avoid : undefined;
  const runs: Array<{ days: PersonDay[]; obj: number }> = [];
  for (let k = 0; k < 10; k++) {
    const start = initial(persons, recs, k === 0 ? () => 0 : rnd);
    const days = optimize(persons, recs, start, av);
    runs.push({ days, obj: totalObjective(days, persons, recs, av) });
  }
  const best = Math.min(...runs.map((r) => r.obj));
  const good = runs.filter((r) => r.obj <= best * 1.12 + 1e-6);
  // Bevorzugt eine Variante, die sich vom bisherigen Stand unterscheidet
  const fresh = good.filter((r) => planSignature(r.days) !== previous);
  const pool = fresh.length ? fresh : good;
  const pick = pool[Math.floor(rnd() * pool.length)];
  return { days: pick.days, ms: Date.now() - t0 };
}
