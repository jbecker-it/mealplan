import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { bridge, reweAvailable, activeMarket } from "@/lib/rewe";

// Status: Brücke verfügbar? Aktiver Markt? Wie viele Zuordnungen? Letzter Refresh?
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const avail = reweAvailable();
  let live = false;
  if (avail.available) {
    try {
      bridge("status", {}, 20000);
      live = true;
    } catch {
      live = false;
    }
  }
  const mapped = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM ingredient WHERE rewe_product_id IS NOT NULL"
      )
      .get() as { n: number }
  ).n;
  const lastRefresh = (
    db.prepare("SELECT value FROM settings WHERE key = 'rewe_last_refresh'").get() as
      | { value: string }
      | undefined
  )?.value ?? null;

  return NextResponse.json({
    bridge: { available: avail.available, live, reason: avail.reason },
    market: activeMarket(),
    mapped,
    lastRefresh,
  });
}
