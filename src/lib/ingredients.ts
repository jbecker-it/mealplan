// Zutat-Entitäten nachschlagen/anlegen — EIN Ort für alle Routen
// (Rezept anlegen/bearbeiten, Import). Vergleicht Unicode-sicher ohne
// Groß/Klein (SQLite-NOCASE kennt nur ASCII: „Öl“ ≠ „öl“) und löst
// Aliase auf, damit keine Dubletten entstehen.
import { db } from "./db";

export function findIngredientId(name: string): number | null {
  const n = name.trim().toLocaleLowerCase("de-DE");
  if (!n) return null;
  const all = db.prepare("SELECT id, name FROM ingredient").all() as Array<{ id: number; name: string }>;
  const hit = all.find((i) => i.name.toLocaleLowerCase("de-DE") === n);
  if (hit) return Number(hit.id);
  const aliases = db.prepare("SELECT from_name, ingredient_id FROM alias").all() as Array<{
    from_name: string;
    ingredient_id: number;
  }>;
  const al = aliases.find((a) => a.from_name.toLocaleLowerCase("de-DE") === n);
  return al ? Number(al.ingredient_id) : null;
}

export function upsertIngredient(
  name: string,
  category = "Kochen & Backen",
  unit = "g"
): { id: number; created: boolean } {
  const existing = findIngredientId(name);
  if (existing != null) return { id: existing, created: false };
  const info = db
    .prepare("INSERT INTO ingredient(name, category, unit_default) VALUES (?,?,?)")
    .run(name.trim(), category, unit);
  return { id: Number(info.lastInsertRowid), created: true };
}

export function upsertTag(name: string): number {
  const n = name.trim();
  const all = db.prepare("SELECT id, name FROM tag").all() as Array<{ id: number; name: string }>;
  const hit = all.find((t) => t.name.toLocaleLowerCase("de-DE") === n.toLocaleLowerCase("de-DE"));
  if (hit) return Number(hit.id);
  return Number(db.prepare("INSERT INTO tag(name) VALUES (?)").run(n).lastInsertRowid);
}

/** Profil-Tags (gespeichert als JSON-Array von Tag-IDs) → Tag-Namen. */
export function profileTagNames(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  let ids: unknown[] = [];
  try {
    const v = JSON.parse(String(raw));
    ids = Array.isArray(v) ? v : [];
  } catch {
    // Altformat: Komma-Liste von Namen
    return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
  }
  const names: string[] = [];
  for (const id of ids) {
    if (typeof id === "string" && isNaN(Number(id))) {
      names.push(id);
      continue;
    }
    const row = db.prepare("SELECT name FROM tag WHERE id = ?").get(Number(id)) as { name: string } | undefined;
    if (row) names.push(row.name);
  }
  return names;
}
