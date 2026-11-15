import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ensureSeed } from "./seed";

export const DB_PATH =
  process.env.MEALPLAN_DB ||
  path.join(process.cwd(), "data", "mealplan.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kcal_target REAL,
  p_target REAL,
  c_target REAL,
  f_target REAL,
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
  recipe_id INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
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
  f REAL
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
`);

// Migration: erlaubte Slots pro Rezept (B=Frühstück, M=Mittag, A=Abend, S=Snack)
try {
  db.exec("ALTER TABLE recipe ADD COLUMN slots TEXT DEFAULT 'B,M,A,S'");
} catch {
  // Spalte existiert bereits
}

ensureSeed(db);
