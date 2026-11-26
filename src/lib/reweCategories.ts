import { db } from "./db";
import { bridge, type ReweMarket } from "./rewe";

// Ladenspezifische Kategorien: Der Kategorienbaum des REWE-Online-Shops
// (shop-overview) liefert je Markt die Abteilungen (oberste Ebene) samt
// Unterkategorien. Jedes Produkt trägt in `categories` Verweise auf diesen
// Baum (id, slug oder Pfad). Für eine Zutat werden die Top-Produkte der
// Suche gewertet (Platz 1 zählt am meisten) → Vorschlag = Abteilung mit den
// meisten Stimmen. Es wird NIE automatisch gespeichert — nur Vorschläge.

export type ShopCategory = {
  id: string | null;
  name: string | null;
  slug: string | null;
  tags: string[];
  children: ShopCategory[];
};

export type CategorySuggestion = {
  query: string;
  suggested: string | null; // Abteilung (oberste Ebene)
  sub: string | null; // tiefste erkannte Unterkategorie (Info)
  confidence: number; // 0..1 Stimmanteil der gewählten Abteilung
  alternatives: string[]; // weitere Abteilungen mit Stimmen
  products: string[]; // Titel der gewerteten Produkte (max. 3)
  raw: string[]; // Kategorie-Strings des ersten Produkts (Diagnose)
  error?: string;
};

const TTL_MS = 7 * 24 * 3_600_000; // Sortiment-Baum ändert sich selten

export function shopTree(market: ReweMarket, force = false): ShopCategory[] {
  const key = `rewe_shop_overview_${market.wwIdent}`;
  if (!force) {
    const row = db
      .prepare("SELECT value, created_at FROM settings WHERE key = ?")
      .get(key) as { value: string; created_at: number | null } | undefined;
    if (row && row.created_at && Date.now() - row.created_at < TTL_MS) {
      try {
        const cats = JSON.parse(row.value) as ShopCategory[];
        if (Array.isArray(cats) && cats.length) return cats;
      } catch {
        // kaputter Cache → neu laden
      }
    }
  }
  const res = bridge("shop_overview", { market: market.wwIdent, plz: market.plz ?? "" }, 45000) as {
    categories: ShopCategory[];
  };
  db.prepare(
    `INSERT INTO settings(key, value, created_at) VALUES(?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`
  ).run(key, JSON.stringify(res.categories), Date.now());
  return res.categories;
}

/** Abteilungen (oberste Ebene) — Inspirations-Kategorien („Angebote“, „Vegan“ …) raus. */
export function departments(tree: ShopCategory[]): ShopCategory[] {
  const anyTagged = tree.some((c) => c.tags?.length);
  return tree.filter(
    (c) => c.name && (!anyTagged || c.tags.includes("sortiment") || !c.tags.length)
  );
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .trim();

type Hit = { dept: string; name: string; depth: number };

/** Lookup id/slug/name → Abteilung über den ganzen Baum. */
export function buildResolver(tree: ShopCategory[]) {
  const map = new Map<string, Hit>();
  const put = (k: string | null, h: Hit) => {
    if (!k) return;
    const nk = norm(String(k));
    const cur = map.get(nk);
    // gleicher Schlüssel mehrfach → die tiefere (spezifischere) Kategorie gewinnt
    if (!cur || h.depth > cur.depth) map.set(nk, h);
  };
  const walk = (c: ShopCategory, dept: string, depth: number) => {
    const h = { dept, name: c.name ?? dept, depth };
    put(c.id, h);
    put(c.slug, h);
    put(c.name, h);
    for (const k of c.children ?? []) walk(k, dept, depth + 1);
  };
  for (const d of departments(tree)) walk(d, d.name!, 0);

  return (raw: string): Hit | null => {
    const s = norm(raw);
    if (!s) return null;
    const direct = map.get(s);
    if (direct) return direct;
    // Pfade wie "obst-gemuese/obst/aepfel" oder "Obst & Gemüse > Obst":
    // tiefstes bekanntes Segment gewinnt
    const segs = s.split(/\s*[>/|]\s*/).filter(Boolean);
    let best: Hit | null = null;
    for (const seg of segs) {
      const h = map.get(seg);
      if (h && (!best || h.depth >= best.depth)) best = h;
    }
    return best;
  };
}

export function suggest(
  tree: ShopCategory[],
  results: Array<{ query: string; ok: boolean; error?: string; products: Array<{ title: string; categories: string[] }> }>
): CategorySuggestion[] {
  const resolve = buildResolver(tree);
  return results.map((r) => {
    const votes = new Map<string, number>();
    const subs = new Map<string, { name: string; depth: number; w: number }>();
    let total = 0;
    r.products.forEach((p, rank) => {
      const w = 1 / (rank + 1);
      // pro Produkt jede Abteilung nur einmal zählen
      const seen = new Map<string, Hit>();
      for (const c of p.categories ?? []) {
        const h = resolve(String(c));
        if (!h) continue;
        const prev = seen.get(h.dept);
        if (!prev || h.depth > prev.depth) seen.set(h.dept, h);
      }
      if (!seen.size) return;
      total += w;
      for (const [dept, h] of seen) {
        votes.set(dept, (votes.get(dept) ?? 0) + w / seen.size);
        const sk = `${dept}|${h.name}`;
        const cur = subs.get(sk);
        subs.set(sk, { name: h.name, depth: h.depth, w: (cur?.w ?? 0) + w });
      }
    });
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked[0]?.[0] ?? null;
    let sub: string | null = null;
    if (top) {
      const cands = [...subs.entries()]
        .filter(([k, v]) => k.startsWith(top + "|") && v.depth > 0)
        .sort((a, b) => b[1].w - a[1].w);
      sub = cands[0]?.[1].name ?? null;
    }
    return {
      query: r.query,
      suggested: top,
      sub,
      confidence: top && total ? Math.round((ranked[0][1] / total) * 100) / 100 : 0,
      alternatives: ranked.slice(1, 3).map(([d]) => d),
      products: r.products.slice(0, 3).map((p) => p.title),
      raw: (r.products[0]?.categories ?? []).slice(0, 6).map(String),
      ...(r.ok ? {} : { error: r.error ?? "Suche fehlgeschlagen" }),
    };
  });
}
