import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  bridge,
  ReweError,
  reweAvailable,
  activeMarket,
  upsertProduct,
  type ReweProduct,
} from "@/lib/rewe";

// GET ?q=haferflocken&vegan=1&n=20 → Produkt-Suche im aktiven Markt.
// Alle Treffer landen im lokalen Cache (rewe_product).
export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q)
    return NextResponse.json({ error: "Suchbegriff fehlt (q=…)" }, { status: 400 });
  const market = activeMarket();
  if (!market)
    return NextResponse.json(
      { error: "Kein REWE-Markt gewählt — bitte zuerst einen Markt suchen und festlegen." },
      { status: 400 }
    );
  if (!reweAvailable().available)
    return NextResponse.json(
      { error: "REWE-Brücke nicht verfügbar" },
      { status: 503 }
    );
  const vegan = req.nextUrl.searchParams.get("vegan") === "1";
  const n = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("n") || 20)));
  try {
    const res = bridge("search", {
      market: market.wwIdent,
      query: q,
      vegan,
      n,
      page: 1,
    }) as {
      searchTerm: { original: string; corrected?: string | null } | null;
      pagination: Record<string, unknown> | null;
      products: ReweProduct[];
    };
    for (const p of res.products) upsertProduct(p);
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof ReweError)
      return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }
}
