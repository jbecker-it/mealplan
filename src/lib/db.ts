import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ensureSeed } from "./seed";
import { normalizeAmount } from "./units";

// Fester Plan-Schlüssel (siehe lib/plan.ts) — hier dupliziert, um einen
// Import-Zyklus db ↔ plan zu vermeiden.
const PLAN_KEY = "current";

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

-- Verlauf: gesicherte Stände von Template A/B (vor Generieren/Überschreiben)
CREATE TABLE IF NOT EXISTS plan_snapshot (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  template_id TEXT NOT NULL,
  rows_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
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
  try {
    migrateWeeklyPlans(d);
  } catch (e) {
    console.error("Plan-Migration fehlgeschlagen:", e);
  }
  // Migration: EL/TL-Umrechnung pro Zutat (g bzw. ml pro EL)
  addCol("ALTER TABLE ingredient ADD COLUMN per_el REAL");
  // Migration: Einheiten in Rezepten vereinheitlichen (kg→g, „stk“→„Stück“,
  // „el“→„EL“ …). Idempotent — bereits kanonische Einheiten bleiben gleich.
  try {
    const rows = d
      .prepare("SELECT id, amount, unit FROM recipe_ingredient WHERE unit IS NOT NULL")
      .all() as Array<{ id: number; amount: number | null; unit: string }>;
    const up = d.prepare("UPDATE recipe_ingredient SET amount = ?, unit = ? WHERE id = ?");
    d.transaction(() => {
      for (const r of rows) {
        const n = normalizeAmount(r.amount, r.unit);
        if (n.unit !== r.unit || n.amount !== r.amount) up.run(n.amount, n.unit, r.id);
      }
    })();
    d.prepare("UPDATE ingredient SET unit_default = 'Stück' WHERE unit_default IN ('Stk', 'stk', 'stück')").run();
  } catch {
    // überspringbar
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

// ── Aktives Template (A/B) ────────────────────────────────────────────────
// Seit 2026-11-19 ist das Template NICHT mehr wochenabhängig: beide Templates
// liegen in derselben Woche, die UI wählt das aktive per Umschalter.
// Persistiert in settings(active_template), Default "A".
const ACTIVE_KEY = "active_template";

export function getActiveTemplate(): "A" | "B" {
  try {
    const r = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(ACTIVE_KEY) as { value: string } | undefined;
    return r && r.value === "B" ? "B" : "A";
  } catch {
    return "A";
  }
}

export function setActiveTemplate(t: "A" | "B"): void {
  db.prepare(
    `INSERT INTO settings(key, value, created_at) VALUES(?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`
  ).run(ACTIVE_KEY, t, Date.now());
}

/**
 * Migration von wochenbasierten Plänen (vor 2026-11-23): Jede alte
 * (Woche, Template)-Kombination wird als Snapshot gesichert; der jeweils
 * NEUESTE Stand von A bzw. B wird zum dauerhaften Template. Idempotent:
 * danach liegen nur noch Zeilen mit PLAN_KEY in plan_meal.
 */
function migrateWeeklyPlans(d: DbInstance): void {
  const groups = d
    .prepare(
      `SELECT DISTINCT week_key, template_id FROM plan_meal
       WHERE week_key != ? ORDER BY week_key, template_id`
    )
    .all(PLAN_KEY) as Array<{ week_key: string; template_id: string }>;
  if (groups.length === 0) return;
  d.transaction(() => {
    const ins = d.prepare("INSERT INTO plan_snapshot(label, template_id, rows_json) VALUES (?,?,?)");
    for (const g of groups) {
      const rows = d
        .prepare(
          `SELECT profile_id, slot, recipe_id, servings FROM plan_meal
           WHERE week_key = ? AND template_id = ? AND day = 0 ORDER BY profile_id, slot`
        )
        .all(g.week_key, g.template_id);
      if (rows.length) ins.run(`Woche ${g.week_key} · Template ${g.template_id}`, g.template_id, JSON.stringify(rows));
    }
    for (const tid of ["A", "B"]) {
      const has = d
        .prepare("SELECT 1 FROM plan_meal WHERE week_key = ? AND template_id = ? LIMIT 1")
        .get(PLAN_KEY, tid);
      if (has) continue;
      const newest = d
        .prepare("SELECT MAX(week_key) AS w FROM plan_meal WHERE template_id = ? AND week_key != ?")
        .get(tid, PLAN_KEY) as { w: string | null };
      if (newest.w)
        d.prepare("UPDATE plan_meal SET week_key = ? WHERE template_id = ? AND week_key = ?").run(
          PLAN_KEY,
          tid,
          newest.w
        );
    }
    d.prepare("DELETE FROM plan_meal WHERE week_key != ?").run(PLAN_KEY);
    // Abhak-Status der Einkaufsliste hing an der Woche → neu beginnen
    d.prepare("DELETE FROM check_state WHERE week_key NOT LIKE 'current-%'").run();
  })();
}
