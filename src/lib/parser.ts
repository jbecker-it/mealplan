// Import-Parser: Textformat → Preview mit Entity-Matching (grün/gelb/rot)
import { db } from "./db";
import { UNIT_PATTERN, normalizeAmount, parseAmount } from "./units";

export interface ParsedIngredient {
  raw: string;
  amount?: number;
  unit?: string;
  name: string;
  match: "existing" | "alias" | "fuzzy" | "new";
  matchedId?: number; // existing/alias
  suggestion?: { id: number; name: string }; // fuzzy
  // UI kann überschreiben:
  acceptSuggestion?: boolean;
  newName?: string;
}

export interface ParsedRecipe {
  title: string;
  macros?: {
    kcal?: number;
    p?: number;
    c?: number;
    f?: number;
    sugar?: number;
    salt?: number;
  };
  ingredients: ParsedIngredient[];
  steps: string[];
  tags: string[];
  slots: string[]; // erlaubte Slots: B=Frühstück, M=Mittag, A=Abend, S=Snack
  warnings: string[];
}

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^(die|der|das|frische|frischer|frisches|frischen)\s+/, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = tmp;
    }
  }
  return dp[n];
}

// Menge: 1 | 1,5 | 1.5 | 1/2 | 1 1/2 | ½ | 1½ | 1-2 (Bereich → oberer Wert)
const AMT = "(\\d+(?:[.,]\\d+)?(?:\\s+\\d+/\\d+)?(?:/\\d+)?\\s*[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])";
const AMT_UNIT_RE = new RegExp(
  `^${AMT}(?:\\s*[-–]\\s*${AMT})?\\s*(${UNIT_PATTERN})\\.?(?=\\s|$)\\s*(.*)$`,
  "i"
);
const AMT_ONLY_RE = new RegExp(`^${AMT}(?:\\s*[-–]\\s*${AMT})?\\s+(.+)$`, "i");

function parseIngLine(line: string): ParsedIngredient {
  const raw = line.trim();
  let amount: number | undefined;
  let unit: string | undefined;
  let rest = raw;

  const mu = AMT_UNIT_RE.exec(raw);
  const mo = mu ? null : AMT_ONLY_RE.exec(raw);
  if (mu && mu[4].trim()) {
    const a = parseAmount(mu[2] ?? mu[1]);
    const n = normalizeAmount(a, mu[3]);
    amount = n.amount ?? undefined;
    unit = n.unit;
    rest = mu[4];
  } else if (mo) {
    // „2 Zwiebeln“ → 2 Stück
    const a = parseAmount(mo[2] ?? mo[1]);
    if (a != null) {
      amount = a;
      unit = "Stück";
      rest = mo[3];
    }
  }
  rest = rest.replace(/^(?:von\s+)/i, "");

  const name = rest.replace(/\s*\(.*\)$/, "").trim();
  const ing: ParsedIngredient = { raw, amount, unit, name: name || raw, match: "new" };

  const n = norm(name);
  const lc = (x: string) => x.toLocaleLowerCase("de-DE");
  // Exakt (Unicode-sicher ohne Groß/Klein — SQLite-NOCASE kennt kein Ä/Ö/Ü)
  const all = db.prepare("SELECT id, name FROM ingredient").all() as Array<{ id: number; name: string }>;
  const ex = all.find((e) => lc(e.name) === lc(name.trim()) || norm(e.name) === n);
  if (ex) {
    ing.match = "existing";
    ing.matchedId = ex.id;
    return ing;
  }
  const aliases = db
    .prepare("SELECT a.from_name, i.id, i.name FROM alias a JOIN ingredient i ON i.id = a.ingredient_id")
    .all() as Array<{ from_name: string; id: number; name: string }>;
  const al = aliases.find((a) => norm(a.from_name) === n);
  if (al) {
    ing.match = "alias";
    ing.matchedId = al.id;
    return ing;
  }
  // Fuzzy: kleiner Tippfehler-Abstand (abhängig von der Wortlänge) oder
  // Teilstring (z. B. „Räuchertofu“ ↔ „Tofu“) → Vorschlag zum Bestätigen
  const maxD = n.length <= 4 ? 1 : n.length <= 8 ? 2 : 3;
  let best: { id: number; name: string } | undefined;
  let bestD = Infinity;
  const consider = (cand: string, target: { id: number; name: string }) => {
    const c = norm(cand);
    let d = levenshtein(n, c);
    if (d > maxD && n.length >= 4 && c.length >= 4 && (c.includes(n) || n.includes(c))) d = maxD + 0.5;
    if (d <= maxD + 0.5 && d < bestD) {
      bestD = d;
      best = { id: target.id, name: target.name };
    }
  };
  for (const e of all) consider(e.name, e);
  for (const a of aliases) consider(a.from_name, a);
  if (best) {
    ing.match = "fuzzy";
    ing.suggestion = best;
  }
  return ing;
}

function macroVal(line: string, words: string[]): number | undefined {
  const W = words.map((w) => `\\b${w}\\b`).join("|");
  const numFirst = new RegExp(`(\\d{1,5}[.,]?\\d*)\\s*(?:g\\s*)?(?:${W})`, "i");
  const wordFirst = new RegExp(`(?:${W})\\s*[:=]?\\s*(\\d{1,5}[.,]?\\d*)`, "i");
  const m = numFirst.exec(line) || wordFirst.exec(line);
  return m ? parseFloat(m[1].replace(",", ".")) : undefined;
}

export function parseImport(text: string): ParsedRecipe[] {
  const blocks = text
    .split(/\r?\n\s*-{3,}\s*\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const out: ParsedRecipe[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim());
    const rec: ParsedRecipe = {
      title: "",
      ingredients: [],
      steps: [],
      tags: [],
      slots: ["B", "M", "A", "S"],
      warnings: [],
    };
    let inSteps = false;
    let macroLine: string | null = null;

    for (const line of lines) {
      if (!line) continue;
      if (/^tags\s*[:]/i.test(line)) {
        rec.tags = line
          .replace(/^tags\s*[:]/i, "")
          .split(/[;,]/)
          .map((t) => t.trim())
          .filter(Boolean);
        inSteps = false;
        continue;
      }
      if (/^(slots?|kategorien?)\s*[:]/i.test(line)) {
        const vals = line
          .replace(/^(slots?|kategorien?)\s*[:]/i, "")
          .split(/[,;|]/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        const MAP: Record<string, string> = {
          b: "B", frühstück: "B", breakfast: "B",
          m: "M", mittag: "M", mittagessen: "M", lunch: "M",
          a: "A", abend: "A", abendessen: "A", dinner: "A",
          s: "S", snack: "S", snacks: "S",
        };
        const out: string[] = [];
        for (const v of vals) {
          if (v === "alle" || v === "all") {
            rec.slots = ["B", "M", "A", "S"];
            break;
          }
          const m = MAP[v];
          if (m && !out.includes(m)) out.push(m);
          else if (m == null) rec.warnings.push(`Unbekannte Kategorie: ${v}`);
        }
        if (out.length) rec.slots = out;
        inSteps = false;
        continue;
      }
      if (/^zutaten\s*[:]?$/i.test(line)) {
        continue;
      }
      if (/^zubereitung\s*[:]?$/i.test(line)) {
        inSteps = true;
        continue;
      }
      if (/^rezept\s*[:]/i.test(line)) {
        rec.title = line.replace(/^rezept\s*[:]/i, "").trim();
        continue;
      }
      if (/^#\s+/.test(line)) {
        if (!rec.title) rec.title = line.replace(/^#\s+/, "").trim();
        continue;
      }
      if (/kcal/i.test(line) && !/^[-*]/.test(line)) {
        if (!macroLine) macroLine = line;
        continue;
      }
      if (/^[-*]\s+/.test(line)) {
        if (!inSteps) rec.ingredients.push(parseIngLine(line.replace(/^[-*]\s+/, "")));
        continue;
      }
      if (inSteps || /^\d+[.)]\s+/.test(line)) {
        const s = line.replace(/^\d+[.)]\s+/, "");
        if (s) rec.steps.push(s);
        continue;
      }
      if (!rec.title && !/^\d/.test(line)) {
        rec.title = line;
      }
    }

    if (macroLine) {
      rec.macros = {
        kcal: macroVal(macroLine, ["kcal"]),
        p: macroVal(macroLine, ["protein", "p"]),
        c: macroVal(macroLine, ["kh", "kohlenhydrate", "carbs", "c"]),
        f: macroVal(macroLine, ["fett", "fat", "f"]),
        sugar: macroVal(macroLine, ["zucker", "sugar"]),
        salt: macroVal(macroLine, ["salz", "salt"]),
      };
    }

    if (!rec.title) rec.warnings.push("Kein Titel erkannt");
    if (!rec.macros?.kcal) rec.warnings.push("Makros fehlen (kcal/p/c/f)");
    else if (rec.macros.p == null) rec.warnings.push("Protein fehlt");
    for (const ing of rec.ingredients)
      if (ing.amount == null)
        rec.warnings.push(`Menge fehlt: ${ing.raw}`);
    if (rec.ingredients.length === 0)
      rec.warnings.push("Keine Zutaten erkannt");

    out.push(rec);
  }
  return out;
}
