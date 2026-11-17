import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";

// REWE-Livedaten über die Python-Brücke (rewerse + mTLS-Zertifikat).
// Der Kern bleibt ohne Python lauffähig: alle Daten landen im SQLite-Cache
// (rewe_product), die Brücke wird nur für Suche/Aktualisierung gebraucht.

const REWE_DIR = path.join(process.cwd(), "rewe");
const BRIDGE = path.join(REWE_DIR, "rewerse_bridge.py");
const CERT = path.join(REWE_DIR, "certificate.pem");
const KEY = path.join(REWE_DIR, "private.key");

export class ReweError extends Error {
  code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

export type ReweProduct = {
  productId: string;
  title: string;
  brand: string | null;
  articleId: string | null;
  imageURL: string | null;
  grammage: string | null;
  priceCents: number | null;
  discount: unknown;
  loyaltyBonus: unknown;
  isVegan: boolean;
  isVegetarian: boolean;
  isOrganic: boolean;
  description?: string | null;
  nutritionFacts?: unknown;
};

export type ReweMarket = {
  wwIdent: string;
  name: string;
  city: string | null;
  plz: string | null;
  street: string | null;
  hasPickup?: boolean;
  hasDelivery?: boolean;
};

export function reweAvailable(): { available: boolean; reason?: string } {
  if (!fs.existsSync(BRIDGE))
    return { available: false, reason: "Brücke fehlt (rewe/rewerse_bridge.py)" };
  if (!fs.existsSync(CERT) || !fs.existsSync(KEY))
    return { available: false, reason: "mTLS-Zertifikat fehlt (rewe/)" };
  return { available: true };
}

/** Brücke aufrufen; wirft ReweError mit klarem Grund bei Fehlschlag. */
export function bridge(
  cmd: string,
  args: Record<string, unknown> = {},
  timeoutMs = 45000
): unknown {
  const r = spawnSync("python3", [BRIDGE, cmd, JSON.stringify(args)], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error)
    throw new ReweError(`Bridge nicht ausführbar: ${r.error.message}`, 3);
  const stderr = (r.stderr || "").trim();
  if (r.status !== 0) {
    let msg = stderr || `Bridge-Exit ${r.status}`;
    try {
      const j = JSON.parse(stderr);
      if (j?.error) msg = j.error;
    } catch {
      // stderr war kein JSON — roh übernehmen
    }
    throw new ReweError(msg, r.status ?? 1);
  }
  const stdout = (r.stdout || "").trim();
  try {
    return JSON.parse(stdout);
  } catch {
    throw new ReweError("Ungültige Bridge-Ausgabe", 1);
  }
}

// ---------- Cache-Helfer ----------

export function upsertProduct(p: ReweProduct): void {
  db.prepare(
    `INSERT INTO rewe_product
       (product_id, title, brand, article_id, image_url, grammage, price_cents,
        discount_json, is_vegan, is_organic, description, nutrition_json, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(product_id) DO UPDATE SET
       title=excluded.title,
       brand=COALESCE(excluded.brand, rewe_product.brand),
       article_id=COALESCE(excluded.article_id, rewe_product.article_id),
       image_url=COALESCE(excluded.image_url, rewe_product.image_url),
       grammage=COALESCE(excluded.grammage, rewe_product.grammage),
       price_cents=COALESCE(excluded.price_cents, rewe_product.price_cents),
       discount_json=excluded.discount_json,
       is_vegan=excluded.is_vegan,
       is_organic=excluded.is_organic,
       description=COALESCE(excluded.description, rewe_product.description),
       nutrition_json=COALESCE(excluded.nutrition_json, rewe_product.nutrition_json),
       updated_at=datetime('now')`
  ).run(
    p.productId,
    p.title,
    p.brand ?? null,
    p.articleId ?? null,
    p.imageURL ?? null,
    p.grammage ?? null,
    p.priceCents ?? null,
    p.discount == null ? null : JSON.stringify(p.discount),
    p.isVegan ? 1 : 0,
    p.isOrganic ? 1 : 0,
    p.description ?? null,
    p.nutritionFacts == null ? null : JSON.stringify(p.nutritionFacts)
  );
}

export function activeMarket(): ReweMarket | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'rewe_active_market'")
    .get() as { value: string } | undefined;
  if (!row) return null;
  try {
    const m = JSON.parse(row.value) as ReweMarket;
    return m && m.wwIdent ? m : null;
  } catch {
    return null;
  }
}

export function setActiveMarket(m: ReweMarket): void {
  db.prepare(
    `INSERT INTO rewe_market (ww_ident, name, city, plz, street)
     VALUES (?,?,?,?,?)
     ON CONFLICT(ww_ident) DO UPDATE SET name=excluded.name, city=excluded.city,
       plz=excluded.plz, street=excluded.street`
  ).run(m.wwIdent, m.name, m.city ?? null, m.plz ?? null, m.street ?? null);
  db.prepare(
    `INSERT INTO settings(key, value) VALUES('rewe_active_market', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(JSON.stringify(m));
}

// ---------- Rechen-Helfer (Listen-Kosten) ----------

/** "500g (1 kg = 3,38 €)" → 500, "1L" → 1000, "250 ml" → 250. */
export function grammageToGrams(g: string | null | undefined): number | null {
  if (!g) return null;
  const m = g.match(/(\d+(?:[.,]\d+)?)\s*(mg|g|kg|ml|l)\b/i);
  if (!m) return null;
  const val = parseFloat(m[1].replace(",", "."));
  if (!isFinite(val) || val <= 0) return null;
  switch (m[2].toLowerCase()) {
    case "mg":
      return val / 1000;
    case "kg":
      return val * 1000;
    case "l":
      return val * 1000;
    default:
      return val; // g und ml ≈ g
  }
}

export function reweUrl(title: string): string {
  return `https://www.rewe.de/search?q=${encodeURIComponent(title)}`;
}
