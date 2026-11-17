import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ensureSeed } from "./seed";
import { shiftWeek, weekNum } from "./week";

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

CREATE TABLE IF NOT EXISTS template (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  slots_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS check_state (
  week_key TEXT NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredient(id),
  checked_at TEXT,
  PRIMARY KEY (week_key, ingredient_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS session (
  token TEXT PRIMARY KEY,
  expiry INTEGER NOT NULL
);

-- REWE-Integration: aktiver Markt + Produkt-Cache (Live-Daten via rewerse-Brücke)
CREATE TABLE IF NOT EXISTS rewe_market (
  ww_ident TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  plz TEXT,
  street TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rewe_product (
  product_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brand TEXT,
  article_id TEXT,
  image_url TEXT,
  grammage TEXT,
  price_cents INTEGER,
  discount_json TEXT,
  is_vegan INTEGER DEFAULT 0,
  is_organic INTEGER DEFAULT 0,
  description TEXT,
  nutrition_json TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
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
  // Migration: settings.created_at (Cache-TTL, z. B. REWE-Discounts 24 h)
  addCol("ALTER TABLE settings ADD COLUMN created_at INTEGER");
  try {
    d.prepare("UPDATE settings SET created_at = ? WHERE created_at IS NULL").run(Date.now());
  } catch {
    // Backfill überspringbar
  }
  // Unique-Index für Upserts (ON CONFLICT) — evtl. Duplikate erst auflösen.
  try {
    d.exec(`
      DELETE FROM plan_meal WHERE id NOT IN (
        SELECT MAX(id) FROM plan_meal
        GROUP BY week_key, template_id, day, profile_id, slot
      )`);
    d.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_slot ON
       plan_meal(week_key, template_id, day, profile_id, slot)`
    );
  } catch {
    // Index konnte nicht angelegt werden — Upserts fallen auf Delete-then-Insert zurück
  }
  // Migration: EINE Woche = EINES Template (ungerade Woche = A, gerade = B).
  // Altes Modell: A und B in derselben Woche. B-Zeilen wandern in die
  // Folgewoche, A-Zeilen (in geraden Wochen) in die Vorwoche — aber nur,
  // wenn dort noch kein Plan liegt (idempotent, keine Datenverluste).
  try {
    const rows = d
      .prepare("SELECT DISTINCT week_key, template_id FROM plan_meal")
      .all() as Array<{ week_key: string; template_id: string }>;
    const done = new Set<string>();
    for (const { week_key, template_id } of rows) {
      const expected = weekNum(week_key) % 2 === 1 ? "A" : "B";
      if (template_id === expected) continue;
      const target =
        template_id === "B" ? shiftWeek(week_key, 1) : shiftWeek(week_key, -1);
      if (done.has(target + template_id)) continue;
      done.add(target + template_id);
      const existing = d
        .prepare(
          "SELECT COUNT(*) AS n FROM plan_meal WHERE week_key = ? AND template_id = ?"
        )
        .get(target, template_id) as { n: number };
      if (existing.n > 0) continue;
      d.prepare("UPDATE plan_meal SET week_key = ? WHERE week_key = ? AND template_id = ?")
        .run(target, week_key, template_id);
    }
  } catch {
    // Migration überspringbar — neue Daten werden korrekt geschrieben
  }
  // Migration: Zutaten-Kategorien auf die REWE-Markt-Abteilungen umstellen
  // (2026-11-17, Commit 4ebaa6d+). Nur Zutaten, die noch die alten
  // Kategorien „Trockenwaren“/„Kühlregal“ tragen, werden umgelabelt —
  // manuell gesetzte Kategorien bleiben unverändert. Idempotent.
  try {
    const REWE_CAT: Array<[string, string[]]> = [
      ["Fleisch, Wurst & Fisch", ["Tofu", "Tempeh"]],
      ["Käse, Eier & Molkerei", ["Haferdrink", "Sojadrink", "Magerquark", "Sojajoghurt", "Haferproteinpulver"]],
      ["Tiefkühlkost", ["Edamame"]],
      ["Backwaren, Cerealien & Aufstriche", ["Vollkornbrot", "Haferflocken", "Cornflakes", "Ahornsirup"]],
      ["Kochen & Backen", ["Nudeln", "Fusilli", "Reis", "Kichererbsen", "Rote Linsen", "Kokosraspeln"]],
      ["Öle, Soßen & Gewürze", ["Rapsöl", "Kokosöl", "Kürbiskernöl", "Sojasoße", "Currypaste", "Tahini", "Sesam", "Hefeflocken"]],
      ["Fertiggerichte & Konserven", ["Falafel", "Kokosmilch"]],
      ["Süßes & Salziges", ["Chiasamen"]],
    ];
    const up = d.prepare(
      "UPDATE ingredient SET category = ? WHERE name = ? AND category IN ('Trockenwaren', 'Kühlregal')"
    );
    for (const [cat, names] of REWE_CAT) for (const name of names) up.run(cat, name);
    // Rename (2026-11-17): „Tiefkühl" → „Tiefkühlkost" (Abteilungsname im
    // REWE-Markt 35418 Buseck)
    d.prepare("UPDATE ingredient SET category = 'Tiefkühlkost' WHERE category = 'Tiefkühl'").run();
  } catch {
    // Migration überspringbar — Kategorien sind freie Labels
  }
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
