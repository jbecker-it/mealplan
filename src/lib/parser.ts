// Import-Parser: Textformat → Preview mit Entity-Matching (grün/gelb/rot)
import { db } from "./db";

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
  macros?: { kcal?: number; p?: number; c?: number; f?: number };
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

const UNITS = "g|kg|mg|ml|l|stück|stk|el|tl|block|scheibe|prise|bunde|bund";
const AMT_RE = new RegExp(`^(\\d+[.,]?\\d*)\\s*(${UNITS})\\s+(.+)$`, "i");
const FRAC_RE = new RegExp(`^([½¼¾])\\s*(${UNITS})\\s+(.+)$`, "i");

function parseIngLine(line: string): ParsedIngredient {
  const raw = line.trim();
  let amount: number | undefined;
  let unit: string | undefined;
  let rest = raw;

  const m = AMT_RE.exec(raw) || FRAC_RE.exec(raw);
  if (m) {
    if (m[1] === "½") amount = 0.5;
    else if (m[1] === "¼") amount = 0.25;
    else if (m[1] === "¾") amount = 0.75;
    else amount = parseFloat(m[1].replace(",", "."));
    unit = m[2].toLowerCase();
    if (unit === "l") unit = "ml";
    if (unit === "bunde") unit = "Bund";
    else if (unit === "stück" || unit === "stk") unit = "Stück";
    else if (unit === "scheibe") unit = "Scheibe";
    else if (unit === "block") unit = "Block";
    rest = m[3];
  }

  const name = rest.replace(/\s*\(.*\)$/, "").trim();
  const ing: ParsedIngredient = { raw, amount, unit, name: name || raw, match: "new" };

  const n = norm(name);
  const ex = db
    .prepare("SELECT id, name FROM ingredient WHERE name = ?")
    .get(n) as { id: number; name: string } | undefined;
  if (ex) {
    ing.match = "existing";
    ing.matchedId = ex.id;
    return ing;
  }
  const al = db
    .prepare(
      "SELECT i.id, i.name FROM alias a JOIN ingredient i ON i.id = a.ingredient_id WHERE a.from_name = ?"
    )
    .get(n) as { id: number; name: string } | undefined;
  if (al) {
    ing.match = "alias";
    ing.matchedId = al.id;
    return ing;
  }
  // Fuzzy: Abstand ≤ 3 oder Teilstring (≥ 5 Zeichen)
  const all = db.prepare("SELECT id, name FROM ingredient").all() as Array<{
    id: number;
    name: string;
  }>;
  let best: { id: number; name: string } | undefined;
  let bestD = 4;
  for (const e of all) {
    const d = levenshtein(n, norm(e.name));
    if (d < bestD || (bestD === 4 && n.length >= 5 && norm(e.name).includes(n) && n.length >= 4)) {
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
  }
  if (best) {
    ing.match = "fuzzy";
    ing.suggestion = best;
  }
  return ing;
}

function macroVal(line: string, words: string[]): number | undefined {
  const W = words.map((w) => `\\b${w}\\b`).join("|");
  const numFirst = new RegExp(`(\\d{2,5}[.,]?\\d*)\\s*(?:g\\s*)?(?:${W})`, "i");
  const wordFirst = new RegExp(`(?:${W})\\s*[:=]?\\s*(\\d{2,5}[.,]?\\d*)`, "i");
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
