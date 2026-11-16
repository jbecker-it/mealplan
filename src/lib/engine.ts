// Makro-Engine — deterministischer 1:1-Port von mealplan-engine-proto.py
// Diskrete Portionsgrößen {0.5, 1.0, 1.5}; Slot M+A gemeinsam (gleiches Rezept), B+S getrennt.

export interface Recipe {
  id: number;
  name: string;
  K: number;
  P: number;
  C: number;
  F: number;
  Su?: number; // Zucker pro Portion (g)
  Sa?: number; // Salz pro Portion (g)
  slots: SlotKey[];
}

export interface Person {
  name: string;
  K: number;
  P: number;
  C: number;
  F: number;
  SuT?: number; // Tages-Ziel Zucker (g), 0 = unbeachtlich
  SaT?: number; // Tages-Ziel Salz (g), 0 = unbeachtlich
  split: Record<SlotKey, number>;
}

export const SLOT_KEYS = ["B", "M", "A", "S"] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];
export const SLOT_NAMES: Record<SlotKey, string> = {
  B: "Frühstück",
  M: "Mittag",
  A: "Abend",
  S: "Snack",
};
export const SIZES = [0.5, 1.0, 1.5];
const SHARED: Record<SlotKey, boolean> = { B: false, M: true, A: true, S: false };

function allows(r: Recipe, k: SlotKey): boolean {
  return !r.slots || r.slots.length === 0 || r.slots.includes(k);
}

type Sel = Array<[Recipe, number]>;
export interface PlanCell {
  recipeId: number;
  servings: number;
}
export type PersonPlan = (PlanCell | null)[]; // Index = Slot-Index (B,M,A,S)
export type DayPlan = PersonPlan[]; // [personIdx]
export interface TemplateResult {
  A: DayPlan[];
  B: DayPlan[];
}

function totals(sel: Sel | null | undefined): [number, number, number, number, number, number] {
  if (!sel) return [0, 0, 0, 0, 0, 0];
  let K = 0, P = 0, C = 0, F = 0, Su = 0, Sa = 0;
  for (const cell of sel) {
    if (!cell) continue;
    const [r, s] = cell;
    K += r.K * s;
    P += r.P * s;
    C += r.C * s;
    F += r.F * s;
    Su += (r.Su ?? 0) * s;
    Sa += (r.Sa ?? 0) * s;
  }
  return [K, P, C, F, Su, Sa];
}

export function personObj(sel: Sel | null | undefined, p: Person, pen: Map<string, number>): number {
  const [K, P, C, F, Su, Sa] = totals(sel);
  if (K === 0) return 1e9; // noch nicht vollständig gefüllt
  const obj =
    1.0 * (Math.abs(P - p.P) / p.P) +
    0.8 * (Math.abs(K - p.K) / p.K) +
    0.3 * Math.abs(C / (C + F) - p.C / (p.C + p.F));
  // Zucker/Salz: nur ÜBERSCHUSS über das Tagesziel bestrafen
  // (weniger Zucker/Salz ist gut; Ziel 0 = unbeachtlich)
  let suPen = 0;
  if (p.SuT && p.SuT > 0) suPen += 0.4 * Math.max(0, Su - p.SuT) / p.SuT;
  if (p.SaT && p.SaT > 0) suPen += 0.4 * Math.max(0, Sa - p.SaT) / p.SaT;
  let slotPen = 0;
  for (let i = 0; i < 4; i++) {
    const cell = sel?.[i];
    if (!cell) continue;
    const [r, s] = cell;
    const sk = p.split[SLOT_KEYS[i]];
    const tP = (p.P * sk) / p.K; // Protein-Ziel proportional zum kcal-Anteil
    slotPen +=
      0.15 * (Math.abs(s * r.K - sk) / sk) +
      0.1 * (Math.abs(s * r.P - tP) / Math.max(tP, 1));
  }
  const names = (sel ?? []).filter((c): c is [Recipe, number] => !!c).map(([r]) => r.name);
  const uniq = new Set(names).size;
  const dup = uniq < names.length ? 0.4 * (names.length - uniq) : 0;
  let rep = 0;
  for (const cell of sel ?? []) if (cell) rep += 0.5 * (pen.get(cell[0].name) ?? 0);
  return obj + slotPen + dup + rep + suPen;
}

function dayObj(day: Sel[], persons: Person[], pens: Map<string, number>[]): number {
  return day.reduce((a, sel, i) => a + personObj(sel, persons[i], pens[i]), 0);
}

function slotFit(r: Recipe, s: number, p: Person, i: number): number {
  const sk = p.split[SLOT_KEYS[i]];
  const tP = (p.P * sk) / p.K;
  return Math.abs(s * r.K - sk) / sk + Math.abs(s * r.P - tP) / Math.max(tP, 1);
}

function initDay(
  persons: Person[],
  recipes: Recipe[],
  pens: Map<string, number>[]
): Sel[] {
  const day: Sel[] = persons.map(() => new Array(4).fill(null) as Sel);
  for (let i = 0; i < 4; i++) {
    if (SHARED[SLOT_KEYS[i]]) {
      const pool = recipes.filter((r) => allows(r, SLOT_KEYS[i]));
      let best: { r: Recipe; s0: number; s1: number; v: number } | null = null;
      for (const r of pool)
        for (const s0 of SIZES)
          for (const s1 of SIZES) {
            const v =
              slotFit(r, s0, persons[0], i) +
              slotFit(r, s1, persons[1], i) +
              (pens[0].get(r.name) ?? 0);
            if (!best || v < best.v) best = { r, s0, s1, v };
          }
      if (best) {
        day[0][i] = [best.r, best.s0];
        day[1][i] = [best.r, best.s1];
      }
    } else {
      const pool = recipes.filter((r) => allows(r, SLOT_KEYS[i]));
      for (let pi = 0; pi < persons.length; pi++) {
        let best: { r: Recipe; s: number; v: number } | null = null;
        for (const r of pool)
          for (const s of SIZES) {
            const v = slotFit(r, s, persons[pi], i) + (pens[pi].get(r.name) ?? 0);
            if (!best || v < best.v) best = { r, s, v };
          }
        if (best) day[pi][i] = [best.r, best.s];
      }
    }
  }
  return day;
}

function optimizeDay(
  day0: Sel[],
  persons: Person[],
  recipes: Recipe[],
  pens: Map<string, number>[]
): Sel[] {
  const day: Sel[] = day0.map((sel) => sel.slice());
  let bestV = dayObj(day, persons, pens);
  for (let pass = 0; pass < 200; pass++) {
    let improved = false;
    for (let i = 0; i < 4; i++) {
      if (SHARED[SLOT_KEYS[i]]) {
        const pool = recipes.filter((r) => allows(r, SLOT_KEYS[i]));
        let old0 = day[0][i];
        let old1 = day[1][i];
        for (const r of pool)
          for (const s0 of SIZES)
            for (const s1 of SIZES) {
              if (
                old0 &&
                old1 &&
                r.id === old0[0].id &&
                s0 === old0[1] &&
                r.id === old1[0].id &&
                s1 === old1[1]
              )
                continue;
              day[0][i] = [r, s0];
              day[1][i] = [r, s1];
              const v = dayObj(day, persons, pens);
              if (v < bestV) {
                bestV = v;
                improved = true;
                old0 = day[0][i];
                old1 = day[1][i];
              } else {
                day[0][i] = old0;
                day[1][i] = old1;
              }
            }
      } else {
        const pool = recipes.filter((r) => allows(r, SLOT_KEYS[i]));
        for (let pi = 0; pi < persons.length; pi++) {
          let old = day[pi][i];
          for (const r of pool)
            for (const s of SIZES) {
              if (old && r.id === old[0].id && s === old[1]) continue;
              day[pi][i] = [r, s];
              const v = dayObj(day, persons, pens);
              if (v < bestV) {
                bestV = v;
                improved = true;
                old = day[pi][i];
              } else {
                day[pi][i] = old;
              }
            }
        }
      }
    }
    if (!improved) break;
  }
  return day;
}

function toCells(sel: Sel): PersonPlan {
  return sel.map((c) => (c ? { recipeId: c[0].id, servings: c[1] } : null));
}

export function generatePlan(
  persons: Person[],
  recipes: Recipe[]
): TemplateResult {
  const build = (extra?: Map<string, number>): DayPlan[] => {
    const days: DayPlan[] = [];
    const used: Record<string, number> = {};
    for (let d = 0; d < 7; d++) {
      const pen = new Map<string, number>();
      for (const [n, c] of Object.entries(used)) pen.set(n, 0.8 * c);
      if (extra)
        for (const [n, p] of extra) pen.set(n, (pen.get(n) ?? 0) + p);
      const pens = persons.map(() => pen);
      let day = initDay(persons, recipes, pens);
      day = optimizeDay(day, persons, recipes, pens);
      const cells = day.map(toCells);
      days.push(cells);
      const names = new Set<string>();
      for (const sel of cells)
        for (const c of sel) {
          if (!c) continue;
          const r = recipes.find((x) => x.id === c.recipeId);
          if (r) names.add(r.name);
        }
      for (const n of names) used[n] = (used[n] ?? 0) + 1;
    }
    return days;
  };

  const A = build();
  const countA: Record<string, number> = {};
  for (const day of A)
    for (const sel of day)
      for (const c of sel) {
        if (!c) continue;
        const r = recipes.find((x) => x.id === c.recipeId);
        if (r) countA[r.name] = (countA[r.name] ?? 0) + 1;
      }
  const extra = new Map<string, number>();
  for (const [n, c] of Object.entries(countA)) extra.set(n, 0.6 * c);
  return { A, B: build(extra) };
}
