// Einheiten: Normalisierung, Umrechnung EL/TL → g/ml, Mengen-Formatierung.
// Wird von Parser, Rezept-Editor, Einkaufsliste und Kochmodus gemeinsam
// genutzt (client- und server-tauglich, keine DB-Abhängigkeit).

// Kanonische Einheiten, wie sie in recipe_ingredient.unit gespeichert werden.
export const UNITS = [
  "g",
  "ml",
  "EL",
  "TL",
  "Stück",
  "Prise",
  "Bund",
  "Scheibe",
  "Zehe",
  "Dose",
  "Päckchen",
  "Block",
  "Handvoll",
] as const;

// Standard-Einheiten einer Zutat (ingredient.unit_default)
export const BASE_UNITS = ["g", "ml", "Stück", "Bund", "Scheibe", "Zehe", "Dose", "Päckchen", "Block"] as const;

// Schreibweise → [kanonische Einheit, Faktor]
const ALIASES: Record<string, [string, number]> = {
  g: ["g", 1],
  gr: ["g", 1],
  gramm: ["g", 1],
  kg: ["g", 1000],
  kilo: ["g", 1000],
  kilogramm: ["g", 1000],
  mg: ["g", 0.001],
  ml: ["ml", 1],
  milliliter: ["ml", 1],
  cl: ["ml", 10],
  dl: ["ml", 100],
  l: ["ml", 1000],
  liter: ["ml", 1000],
  el: ["EL", 1],
  essl: ["EL", 1],
  "eßl": ["EL", 1],
  esslöffel: ["EL", 1],
  "eßlöffel": ["EL", 1],
  essenlöffel: ["EL", 1],
  löffel: ["EL", 1],
  tl: ["TL", 1],
  teel: ["TL", 1],
  teelöffel: ["TL", 1],
  stück: ["Stück", 1],
  stueck: ["Stück", 1],
  stk: ["Stück", 1],
  st: ["Stück", 1],
  prise: ["Prise", 1],
  prisen: ["Prise", 1],
  bund: ["Bund", 1],
  bunde: ["Bund", 1],
  scheibe: ["Scheibe", 1],
  scheiben: ["Scheibe", 1],
  zehe: ["Zehe", 1],
  zehen: ["Zehe", 1],
  dose: ["Dose", 1],
  dosen: ["Dose", 1],
  päckchen: ["Päckchen", 1],
  pck: ["Päckchen", 1],
  pkg: ["Päckchen", 1],
  packung: ["Päckchen", 1],
  block: ["Block", 1],
  handvoll: ["Handvoll", 1],
};

// Regex-Alternation aller bekannten Schreibweisen (längste zuerst),
// für den Import-Parser.
export const UNIT_PATTERN = Object.keys(ALIASES)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

/** Einheit normalisieren: "kg" → {unit:"g", factor:1000}, "EL" → {unit:"EL"}. */
export function normalizeUnit(raw: string | null | undefined): { unit: string; factor: number } {
  const k = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!k) return { unit: "", factor: 1 };
  const hit = ALIASES[k];
  if (hit) return { unit: hit[0], factor: hit[1] };
  // Unbekannte Einheit: unverändert (erster Buchstabe groß)
  const t = String(raw).trim();
  return { unit: t.charAt(0).toUpperCase() + t.slice(1), factor: 1 };
}

/** Menge + Einheit normalisieren (kg→g, l→ml, „stk“→„Stück“ …). */
export function normalizeAmount(
  amount: number | null | undefined,
  unit: string | null | undefined
): { amount: number | null; unit: string } {
  const n = normalizeUnit(unit);
  if (amount == null || !Number.isFinite(amount)) return { amount: null, unit: n.unit };
  return { amount: Math.round(amount * n.factor * 1000) / 1000, unit: n.unit };
}

/**
 * EL/TL in die Basiseinheit der Zutat (g/ml) umrechnen.
 * perEl = g bzw. ml pro EL (ingredient.per_el). TL = 1/3 EL.
 * Ohne perEl: ml-Zutaten mit Standardmaß 15 ml/EL, sonst keine Umrechnung.
 */
export function toBaseUnit(
  amount: number,
  unit: string,
  unitDefault: string,
  perEl: number | null | undefined
): { amount: number; unit: string } {
  const n = normalizeUnit(unit);
  let u = n.unit || unitDefault || "g";
  let a = amount * n.factor;
  if ((u === "EL" || u === "TL") && (unitDefault === "g" || unitDefault === "ml")) {
    const f = perEl && perEl > 0 ? perEl : unitDefault === "ml" ? 15 : 0;
    if (f > 0) {
      a = a * f * (u === "TL" ? 1 / 3 : 1);
      u = unitDefault;
    }
  }
  return { amount: a, unit: u };
}

/** Deutsche Zahl parsen: "1,5", "1.5", "½", "1/2", "1 1/2" → Zahl, sonst null. */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;
  const FR: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
  let extra = 0;
  const uni = /([½¼¾⅓⅔⅛])$/.exec(s);
  if (uni) {
    extra = FR[uni[1]];
    s = s.slice(0, -1).trim();
    if (!s) return extra;
  }
  const mixed = /^(\d+) (\d+)\/(\d+)$/.exec(s);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) + extra;
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) + extra : null;
  const num = Number(s.replace(",", "."));
  return Number.isFinite(num) ? num + extra : null;
}

/** Menge für die Anzeige runden — je nach Einheit sinnvoll. */
export function roundAmount(amount: number, unit: string): number {
  if (unit === "g" || unit === "ml") {
    if (amount >= 10) return Math.round(amount);
    return Math.round(amount * 10) / 10;
  }
  // EL, TL, Stück, … → auf Viertel
  return Math.round(amount * 4) / 4;
}

/** Menge hübsch formatieren: 0.5 → „½“, 1.25 → „1¼“, 250 → „250“. */
export function fmtAmount(amount: number, unit: string): string {
  const r = roundAmount(amount, unit);
  if (unit !== "g" && unit !== "ml") {
    const whole = Math.floor(r);
    const frac = Math.round((r - whole) * 4);
    const sym = ["", "¼", "½", "¾"][frac];
    if (sym) return whole > 0 ? `${whole}${sym}` : sym;
    return String(whole);
  }
  return r.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

const PLURAL: Record<string, string> = {
  Prise: "Prisen",
  Scheibe: "Scheiben",
  Zehe: "Zehen",
  Dose: "Dosen",
};

/** Einheit für die Anzeige (Plural ab Menge > 1). */
export function unitLabel(unit: string, amount: number | null | undefined): string {
  return amount != null && amount > 1 && PLURAL[unit] ? PLURAL[unit] : unit;
}

/** Zählbare Einheiten (auf der Einkaufsliste aufrunden: ¾ Banane kauft man nicht). */
export function isCountable(unit: string): boolean {
  return !["g", "ml", "EL", "TL", "Prise"].includes(unit);
}

/** „250 g“, „1½ EL“, „3 Zehen“ */
export function fmtQty(amount: number | null | undefined, unit: string): string {
  if (amount == null) return "nach Bedarf";
  return `${fmtAmount(amount, unit)} ${unitLabel(unit, amount)}`.trim();
}
