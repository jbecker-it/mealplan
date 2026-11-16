// Mealplan-Optimizer — 2x2-Template-Modell (Stand 2026-11-16)
//
// Ein Template = EINE Tag-Planung (4 Slots × 2 Profile), die innerhalb des
// Templates an allen 7 Tagen der Woche identisch gilt (Meal-Prep-Logik).
// Template A und B werden unabhängig generiert; B wird bestraft, Rezepte
// zu verwenden, die A schon nutzt (Abwechslung zwischen den Wochentypen).
//
// Constraint-Hierarchie (Vorgabe Johannes, 2026-11-16):
//  1. HARD: Kohlenhydrate und Fett dürfen die Tagesziele NICHT überschreiten
//     (hohe Strafe → der Optimizer meidet Überschreitung fast immer).
//  2. Protein: so nah wie möglich am Tagesmaximum (Defizit hart bestraft,
//     Überschuss nur leicht).
//  3. kcal: möglichst nah am Ziel (weich).
//  4. SOFT: Zucker und Salz best-effort unter dem Tagesziel (nur Überschuss
//     bestraft; Ziel 0 = unbeachtlich).
//
// Diskrete Portionen: 0.5, 1, 1.5. Deterministisch: feste Iterationsreihenfolge.

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
}

export interface Person {
  id: number;
  K: number; // kcal-Ziel
  P: number; // Protein-Ziel
  C: number; // Kohlenhydrat-Ziel (hart)
  F: number; // Fett-Ziel (hart)
  SuT?: number; // Zucker-Ziel (best-effort, 0 = unbeachtlich)
  SaT?: number; // Salz-Ziel (best-effort, 0 = unbeachtlich)
  inc: string[];
  exc: string[];
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

export interface PlanResult {
  A: PersonDay[]; // genau 2 Einträge (Person 0, Person 1)
  B: PersonDay[];
  ms: number;
}

const SIZES = [0.5, 1, 1.5];
const SLOTS = ["B", "M", "A", "S"] as const;
type Slot = (typeof SLOTS)[number];

const SLOT_KCAL: Record<Slot, number> = { B: 0.22, M: 0.35, A: 0.32, S: 0.11 };
const SLOT_P: Record<Slot, number> = { B: 0.14, M: 0.33, A: 0.33, S: 0.2 };

// ---- Gewichte der Objective-Funktion (siehe Header-Hierarchie) ----
const HARD = 5.0; // C/F-Überschreitung (harte Tagesobergrenze)
const P_SHORT = 1.2; // Protein unter Ziel (so nah wie möglich am Maximum)
const P_OVER = 0.3; // Protein über Ziel (leicht)
const K_CAL = 0.8; // kcal-Abweichung (weich)
const SOFT = 0.4; // Zucker/Salz-Überschuss (best-effort)
const SLOT_FIT = 0.15; // Slot-Anteile (kcal + Protein)
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

// Reine Makro-Bewertung eines Tages (ohne Slot-Fit/Abwechslung).
// Wird auch von der Swap-Vorschlags-API verwendet.
export function personObjective(t: MacroTotals, per: PersonTargets): number {
  if (t.K === 0) return 1e9;
  let obj = 0;
  obj += HARD * safeDiv(Math.max(0, t.C - per.C), per.C);
  obj += HARD * safeDiv(Math.max(0, t.F - per.F), per.F);
  obj += (t.P >= per.P ? P_OVER : P_SHORT) * safeDiv(Math.abs(t.P - per.P), per.P);
  obj += K_CAL * safeDiv(Math.abs(t.K - per.K), per.K);
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
    obj += SLOT_FIT * (Math.abs(recipe.kcal * servings - SLOT_KCAL[s] * per.K) / per.K);
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

function allowed(rec: RecipeOpt, slot: Slot, per: Person): boolean {
  if (!rec.slots.includes(slot)) return false;
  const t = rec.title.toLowerCase();
  for (const w of per.exc) if (w && t.includes(w.toLowerCase())) return false;
  return true;
}

function candidates(
  recs: RecipeOpt[],
  slot: Slot,
  per: Person,
  avoid?: Set<number>,
  limit = 18
): RecipeOpt[] {
  const out = recs.filter((r) => allowed(r, slot, per) && !(avoid?.has(r.id)));
  out.sort(
    (a, b) =>
      Math.abs(a.kcal - SLOT_KCAL[slot] * per.K) - Math.abs(b.kcal - SLOT_KCAL[slot] * per.K)
  );
  return out.slice(0, limit);
}

function initial(persons: Person[], recs: RecipeOpt[]): PersonDay[] {
  return persons.map((per, i) => {
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
        // deterministisch: erster passierbarer Kandidat, ggf. Portion 0.5/1.5
        day[slot] = {
          recipe: c[i % c.length],
          servings: SIZES[(i + SLOTS.indexOf(slot)) % SIZES.length],
        };
      }
    }
    return day;
  });
}

// Ein Tag optimieren: beste (Rezept, Portion) je Slot pro Person.
// Gemeinsame Slots (Mittag/Abend) werden für beide Personen mit demselben
// Rezept besetzt, aber mit jeweils eigener Portion.
function optimize(
  persons: Person[],
  recs: RecipeOpt[],
  start: PersonDay[],
  recsA?: Set<number>,
  iterations = 40
): PersonDay[] {
  const days = start.map((d) => ({ ...d, B: { ...d.B }, M: { ...d.M }, A: { ...d.A }, S: { ...d.S } }));
  let best = totalObjective(days, persons, recs, recsA);
  for (let it = 0; it < iterations; it++) {
    let improved = false;
    for (let pi = 0; pi < days.length; pi++) {
      const per = persons[pi] ?? persons[0];
      for (const slot of SLOTS) {
        const cur = days[pi][slot];
        const shared = persons.length === 2 && (slot === "M" || slot === "A");
        const used = new Set<number>();
        for (const s of SLOTS) if (s !== slot) used.add(days[pi][s].recipe.id);
        const cands = candidates(recs, slot, per, used, 14);
        for (const rec of cands) {
          for (const servings of SIZES) {
            if (rec.id === cur.recipe.id && servings === cur.servings) continue;
            days[pi][slot] = { recipe: rec, servings };
            if (shared) {
              const partner = days[1 - pi];
              partner[slot] = { recipe: rec, servings: partner[slot].servings };
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
            if (shared) {
              const partner = days[1 - pi];
              partner[slot] = { recipe: cur.recipe, servings: partner[slot].servings };
            }
          }
        }
      }
    }
    if (!improved) break;
  }
  return days;
}

export function generatePlan(persons: Person[], recipes: RecipeOpt[]): PlanResult {
  const t0 = Date.now();
  if (!persons.length || !recipes.length) {
    throw new Error("Es werden mindestens ein Profil und ein Rezept benötigt.");
  }
  const recs = recipes.filter((r) => r.kcal > 0 && r.slots.length > 0);
  if (!recs.length) throw new Error("Keine Rezepte mit kcal-Werten gefunden.");

  const startA = initial(persons, recs);
  const A = optimize(persons, recs, startA);
  const recsA = new Set<number>();
  for (const d of A) for (const s of SLOTS) recsA.add(d[s].recipe.id);
  const B = optimize(persons, recs, initial(persons, recs), recsA);

  return { A, B, ms: Date.now() - t0 };
}
