import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ensureSeed } from "./seed";

export const DB_PATH =
  process.env.MEALPLAN_DB ||
  path.join(process.cwd(), "data", "mealplan.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

type DbInstance = InstanceType<typeof Database>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kcal_target REAL,
  p_target REAL,
  c_target REAL,
  f_target REAL,
  sugar_target REAL NOT NULL DEFAULT 0,
  salt_target REAL NOT NULL DEFAULT 0,
  slot_split TEXT,
  tag_include TEXT,
  tag_exclude TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredient (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category TEXT DEFAULT 'Trockenwaren',
  unit_default TEXT DEFAULT 'g',
  rewe_product_id TEXT
);

CREATE TABLE IF NOT EXISTS tag (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS recipe (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  kcal REAL,
  protein_g REAL,
  carbs_g REAL,
  fat_g REAL,
  sugar_g REAL,
  salt_g REAL,
  favorite INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_tag (
  recipe_id INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
);

CREATE TABLE IF NOT EXISTS recipe_ingredient (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredient(id),
  amount REAL,
  unit TEXT,
  note TEXT,
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS step (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alias (
  from_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredient(id)
);

CREATE TABLE IF NOT EXISTS plan_meal (
  id INTEGER PRIMARY KEY,
  week_key TEXT NOT NULL,
  template_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  profile_id INTEGER NOT NULL REFERENCES profile(id),
  slot TEXT NOT NULL,
  recipe_id INTEGER NOT NULL REFERENCES recipe(id),
  servings REAL NOT NULL,
  kcal REAL,
  p REAL,
  c REAL,
  f REAL,
  sugar REAL DEFAULT 0,
  salt REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_plan_week ON plan_meal(week_key, day, profile_id);

CREATE TABLE IF NOT EXISTS check_state (
  week_key TEXT NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredient(id),
  checked_at TEXT,
  PRIMARY KEY (week_key, ingredient_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS session (
  token TEXT PRIMARY KEY,
  expiry INTEGER NOT NULL
);
`;

function createDb(): DbInstance {
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(SCHEMA);
  // Migration: erlaubte Slots pro Rezept (B=Frühstück, M=Mittag, A=Abend, S=Snack)
  try {
    d.exec("ALTER TABLE recipe ADD COLUMN slots TEXT DEFAULT 'B,M,A,S'");
  } catch {
    // Spalte existiert bereits
  }
  // Migration: Zucker + Salz als zusätzliche Makros
  // (SQLite kennt kein "ADD COLUMN IF NOT EXISTS" → try/catch)
  const addCol = (stmt: string) => {
    try {
      d.exec(stmt);
    } catch {
      // Spalte existiert bereits
    }
  };
  addCol("ALTER TABLE recipe ADD COLUMN sugar_g REAL");
  addCol("ALTER TABLE recipe ADD COLUMN salt_g REAL");
  addCol("ALTER TABLE profile ADD COLUMN sugar_target REAL NOT NULL DEFAULT 0");
  addCol("ALTER TABLE profile ADD COLUMN salt_target REAL NOT NULL DEFAULT 0");
  addCol("ALTER TABLE plan_meal ADD COLUMN sugar REAL DEFAULT 0");
  addCol("ALTER TABLE plan_meal ADD COLUMN salt REAL DEFAULT 0");
  ensureSeed(d);
  return d;
}

// EINE Verbindung pro Prozess, über globalThis geteilt:
// Next.js läuft Server-Components (Layout) und API-Routen in SEPARATEN
// Modul-Kontexten — je eigener Modul-Instanz wäre je eine eigene
// SQLite-Connection entstanden, und closeDb() (Restore/Reset) hätte
// nur eine davon geschlossen: Die anderen würden auf der alten,
// getauschten Datei hängen (Stale-Data + „connection is not open“).
// globalThis ist pro Node-Prozess eindeutig → ein einziger Handle.
const g = globalThis as unknown as { __mpDb?: DbInstance | null };

function ensure(): DbInstance {
  if (g.__mpDb) return g.__mpDb;
  g.__mpDb = createDb();
  return g.__mpDb;
}

// Stabiler Export: alle bestehenden `import { db }` funktionieren weiter.
// Der Handle kann per closeDb() geschlossen und beim nächsten Zugriff
// automatisch neu geöffnet werden (nötig für den Restore-Dateitausch).
export const db: DbInstance = new Proxy({} as DbInstance, {
  get(_target, prop) {
    const cur = ensure();
    const v = (cur as unknown as Record<PropertyKey, unknown>)[prop];
    if (typeof v === "function")
      return (v as (...args: unknown[]) => unknown).bind(cur);
    return v;
  },
  has(_target, prop) {
    return prop in (ensure() as unknown as object);
  },
});

export function closeDb(): void {
  if (g.__mpDb) {
    try {
      g.__mpDb.close();
    } catch {
      // ignorieren
    }
    g.__mpDb = null;
  }
}
