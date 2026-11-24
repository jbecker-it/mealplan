// Erlaubte Portionsgrößen.
//
// Global: 0,5 / 1 / 1,5 Portionen. Ein Rezept kann das überschreiben
// (recipe.servings_allowed, z. B. "1,1.5,2" für Waffeln, bei denen eine
// Portion = 2 Stück ist und halbe Waffeln keinen Sinn ergeben).
// NULL/leer = globale Vorgabe. Client- und Server-tauglich (kein DB-Import).

export const DEFAULT_SIZES = [0.5, 1, 1.5];

/** Auswahl im Rezept-Formular. */
export const SIZE_CHOICES = [0.5, 1, 1.5, 2, 2.5, 3];

/** "1,1.5,2" | [1,1.5,2] | null → sortierte, gültige Portionen (leer = globale Vorgabe). */
export function parseSizes(raw: unknown): number[] {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[;,\s]+/);
  const out = new Set<number>();
  for (const v of arr) {
    const n = typeof v === "number" ? v : Number(String(v).trim());
    if (Number.isFinite(n) && n > 0 && n <= 10) out.add(Math.round(n * 100) / 100);
  }
  return [...out].sort((a, b) => a - b);
}

/** Für die DB: sortiert, kommagetrennt mit Punkt als Dezimaltrenner; null = globale Vorgabe. */
export function serializeSizes(raw: unknown): string | null {
  const s = parseSizes(raw);
  return s.length ? s.join(",") : null;
}

/** Effektiv erlaubte Portionen eines Rezepts. */
export function sizesFor(override: number[] | null | undefined): number[] {
  return override && override.length ? override : DEFAULT_SIZES;
}

/** Nächstgelegene erlaubte Portion (bei Gleichstand die kleinere). */
export function clampServings(sv: number, sizes: number[]): number {
  let best = sizes[0];
  for (const s of sizes) if (Math.abs(s - sv) < Math.abs(best - sv) - 1e-9) best = s;
  return best;
}
