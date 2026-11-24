// Plan-Speicher (Stand 2026-11-23): Template A und B sind DAUERHAFT —
// keine Kalenderwochen mehr. plan_meal nutzt dafür den festen Schlüssel
// PLAN_KEY in der Spalte week_key (Schema bleibt kompatibel).
//
// Verlauf: Bevor ein Template überschrieben wird (Generieren, Vorlage
// anwenden, Wiederherstellen), wird sein Stand als Snapshot in
// plan_snapshot gesichert und kann später als A oder B zurückgeholt werden.
import { db } from "./db";
import type { Person, RecipeOpt } from "./engine";
import { profileTagNames } from "./ingredients";
import { parseSizes } from "./servings";

export const PLAN_KEY = "current";
export type Tpl = "A" | "B";
const SLOTS = ["B", "M", "A", "S"] as const;
const MAX_SNAPSHOTS = 40;

export interface SnapRow {
  profile_id: number;
  slot: string;
  recipe_id: number;
  servings: number;
}

function upsertStmt() {
  return db.prepare(
    `INSERT INTO plan_meal(week_key, template_id, day, profile_id, slot, recipe_id, servings, kcal, p, c, f, sugar, salt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(week_key, template_id, day, profile_id, slot) DO UPDATE SET
       recipe_id = excluded.recipe_id, servings = excluded.servings,
       kcal = excluded.kcal, p = excluded.p, c = excluded.c, f = excluded.f,
       sugar = excluded.sugar, salt = excluded.salt`
  );
}

/** Einen Slot für alle 7 Tage setzen (Makros aus dem Rezept berechnet). */
export function setMeal(tpl: Tpl, profileId: number, slot: string, recipeId: number, servings: number): boolean {
  const rec = db
    .prepare("SELECT kcal, protein_g, carbs_g, fat_g, sugar_g, salt_g FROM recipe WHERE id = ?")
    .get(recipeId) as
    | { kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; sugar_g: number | null; salt_g: number | null }
    | undefined;
  if (!rec) return false;
  const up = upsertStmt();
  for (let day = 0; day < 7; day++) {
    up.run(
      PLAN_KEY, tpl, day, profileId, slot, recipeId, servings,
      (rec.kcal || 0) * servings,
      (rec.protein_g || 0) * servings,
      (rec.carbs_g || 0) * servings,
      (rec.fat_g || 0) * servings,
      (rec.sugar_g || 0) * servings,
      (rec.salt_g || 0) * servings
    );
  }
  return true;
}

export function currentRows(tpl: Tpl): SnapRow[] {
  return db
    .prepare(
      `SELECT profile_id, slot, recipe_id, servings FROM plan_meal
       WHERE week_key = ? AND template_id = ? AND day = 0 ORDER BY profile_id, slot`
    )
    .all(PLAN_KEY, tpl) as SnapRow[];
}

/** Aktuellen Stand eines Templates sichern (nichts tun, wenn leer oder identisch zum letzten Snapshot). */
export function snapshot(tpl: Tpl, label: string): number | null {
  const rows = currentRows(tpl);
  if (rows.length === 0) return null;
  const json = JSON.stringify(rows);
  const last = db
    .prepare("SELECT rows_json FROM plan_snapshot ORDER BY id DESC LIMIT 1")
    .get() as { rows_json: string } | undefined;
  if (last && last.rows_json === json) return null;
  const id = Number(
    db
      .prepare("INSERT INTO plan_snapshot(label, template_id, rows_json) VALUES (?,?,?)")
      .run(label, tpl, json).lastInsertRowid
  );
  db.prepare(
    `DELETE FROM plan_snapshot WHERE id NOT IN (SELECT id FROM plan_snapshot ORDER BY id DESC LIMIT ?)`
  ).run(MAX_SNAPSHOTS);
  return id;
}

/** Template komplett durch die gegebenen Zeilen ersetzen. */
export function writeTemplate(tpl: Tpl, rows: SnapRow[]): number {
  let n = 0;
  db.prepare("DELETE FROM plan_meal WHERE week_key = ? AND template_id = ?").run(PLAN_KEY, tpl);
  for (const r of rows) {
    if (!SLOTS.includes(r.slot as (typeof SLOTS)[number])) continue;
    const exists = db.prepare("SELECT 1 FROM profile WHERE id = ?").get(r.profile_id);
    if (!exists) continue;
    if (setMeal(tpl, Number(r.profile_id), r.slot, Number(r.recipe_id), Number(r.servings) || 1)) n++;
  }
  return n;
}

// ── Eingaben für Optimizer/Vorschläge ─────────────────────────────────────

function parseSplit(raw: unknown) {
  if (!raw) return null;
  try {
    const o = JSON.parse(String(raw)) as Record<string, unknown>;
    return { B: Number(o.B) || 0, M: Number(o.M) || 0, A: Number(o.A) || 0, S: Number(o.S) || 0 };
  } catch {
    return null;
  }
}

export function loadPersons(): Person[] {
  const profiles = db
    .prepare(
      `SELECT id, kcal_target, p_target, c_target, f_target,
              COALESCE(sugar_target, 0) AS sugar_target,
              COALESCE(salt_target, 0) AS salt_target,
              slot_split, tag_include, tag_exclude
       FROM profile ORDER BY id`
    )
    .all() as Array<Record<string, unknown>>;
  return profiles.map((p) => ({
    id: Number(p.id),
    K: Number(p.kcal_target) || 2000,
    P: Number(p.p_target) || 80,
    C: Number(p.c_target) || 180,
    F: Number(p.f_target) || 70,
    SuT: Number(p.sugar_target) || 0,
    SaT: Number(p.salt_target) || 0,
    slotK: parseSplit(p.slot_split),
    inc: profileTagNames(p.tag_include),
    exc: profileTagNames(p.tag_exclude),
  }));
}

export function loadRecipeOpts(): RecipeOpt[] {
  const recs = db
    .prepare(
      `SELECT r.id, r.title, r.slots, r.kcal, r.protein_g, r.carbs_g, r.fat_g,
              r.sugar_g, r.salt_g, r.servings_allowed,
              (SELECT group_concat(t.name, '|') FROM recipe_tag rt
               JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id) AS tags
       FROM recipe r WHERE r.archived = 0 AND r.kcal IS NOT NULL`
    )
    .all() as Array<Record<string, unknown>>;
  return recs.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    slots: String(r.slots || "B,M,A,S").split(",").map((s) => s.trim()).filter(Boolean),
    kcal: Number(r.kcal) || 0,
    p: Number(r.protein_g) || 0,
    c: Number(r.carbs_g) || 0,
    f: Number(r.fat_g) || 0,
    Su: r.sugar_g == null ? null : Number(r.sugar_g),
    Sa: r.salt_g == null ? null : Number(r.salt_g),
    tags: String(r.tags || "").split("|").filter(Boolean),
    sizes: parseSizes(r.servings_allowed),
  }));
}
