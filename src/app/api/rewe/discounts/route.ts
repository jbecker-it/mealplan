import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  bridge,
  ReweError,
  reweAvailable,
  activeMarket,
} from "@/lib/rewe";

type Offer = {
  title: string;
  brand: string | null;
  priceCents: number | null;
  articleNumber: string | null;
  imageURL: string | null;
  loyaltyBonus: unknown;
  category: string | null;
};

// GET → Angebote der Woche (Cache 24h je Markt — der Wochenflyer ändert
// sich nicht täglich).
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const market = activeMarket();
  if (!market)
    return NextResponse.json({ error: "Kein REWE-Markt gewählt" }, { status: 400 });
  if (!reweAvailable().available)
    return NextResponse.json({ error: "REWE-Brücke nicht verfügbar" }, { status: 503 });

  const cacheKey = `rewe_discounts_${market.wwIdent}`;
  const cached = db
    .prepare("SELECT value, created_at FROM settings WHERE key = ?")
    .get(cacheKey) as { value: string; created_at: number } | undefined;
  if (cached) {
    const ageH = (Date.now() - cached.created_at) / 3_600_000;
    if (ageH < 24) {
      try {
        const j = JSON.parse(cached.value) as { offers: Offer[] };
        return NextResponse.json({ market: market.wwIdent, cached: true, ...j });
      } catch {
        // kaputter Cache → neu laden
      }
    }
  }

  try {
    const res = bridge("discounts", { market: market.wwIdent }, 60000) as {
      count: number;
      offers: Offer[];
    };
    db.prepare(
      `INSERT INTO settings(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(cacheKey, JSON.stringify({ count: res.count, offers: res.offers }));
    return NextResponse.json({
      market: market.wwIdent,
      cached: false,
      count: res.count,
      offers: res.offers,
    });
  } catch (e) {
    if (e instanceof ReweError)
      return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }
}
