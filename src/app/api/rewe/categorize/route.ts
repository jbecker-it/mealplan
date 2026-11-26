import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { bridge, ReweError, reweAvailable, activeMarket } from "@/lib/rewe";
import { shopTree, departments, suggest } from "@/lib/reweCategories";

const MAX_PER_CALL = 20;

function precheck() {
  const market = activeMarket();
  if (!market)
    return { error: NextResponse.json({ error: "Kein REWE-Markt gewählt — bitte im REWE-Tab festlegen." }, { status: 400 }) };
  if (!reweAvailable().available)
    return { error: NextResponse.json({ error: "REWE-Brücke nicht verfügbar" }, { status: 503 }) };
  return { market };
}

// GET (?refresh=1) → Abteilungen des aktiven Markts in Shop-Reihenfolge.
export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const pc = precheck();
  if (pc.error) return pc.error;
  try {
    const tree = shopTree(pc.market, req.nextUrl.searchParams.get("refresh") === "1");
    return NextResponse.json({
      market: pc.market,
      departments: departments(tree).map((d) => d.name),
    });
  } catch (e) {
    if (e instanceof ReweError) return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }
}

// POST {ids:number[]} → Kategorie-VORSCHLÄGE (schreibt nichts).
// Max. 20 Zutaten pro Aufruf — der Client ruft in Blöcken auf.
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson();
  const ids = Array.isArray(raw.ids)
    ? (raw.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (!ids.length) return NextResponse.json({ error: "ids fehlen" }, { status: 400 });
  if (ids.length > MAX_PER_CALL)
    return NextResponse.json({ error: `Max. ${MAX_PER_CALL} Zutaten pro Aufruf` }, { status: 400 });
  const pc = precheck();
  if (pc.error) return pc.error;

  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.category, p.title AS product_title
       FROM ingredient i LEFT JOIN rewe_product p ON p.product_id = i.rewe_product_id
       WHERE i.id IN (${ids.map(() => "?").join(",")})`
    )
    .all(...ids) as Array<{ id: number; name: string; category: string | null; product_title: string | null }>;

  try {
    const tree = shopTree(pc.market);
    // Zugeordnetes REWE-Produkt → dessen Titel suchen (präziser als der Zutatenname)
    const queries = rows.map((r) => r.product_title || r.name);
    const res = bridge(
      "categorize",
      { market: pc.market.wwIdent, queries, n: 5 },
      30000 + rows.length * 6000
    ) as { results: Array<{ query: string; ok: boolean; error?: string; products: Array<{ title: string; categories: string[] }> }> };
    const sugg = suggest(tree, res.results);
    return NextResponse.json({
      suggestions: rows.map((r, i) => ({
        id: r.id,
        name: r.name,
        current: r.category || "Sonstige",
        ...sugg[i],
      })),
    });
  } catch (e) {
    if (e instanceof ReweError) return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }
}
