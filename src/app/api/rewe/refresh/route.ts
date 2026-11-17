import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  bridge,
  ReweError,
  reweAvailable,
  activeMarket,
  upsertProduct,
  type ReweProduct,
} from "@/lib/rewe";

// POST → Preise/Bilder/Vegan-Status aller gemappten REWE-Produkte
// parallel aktualisieren (4 Worker in der Brücke).
export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;
  const market = activeMarket();
  if (!market)
    return NextResponse.json(
      { error: "Kein REWE-Markt gewählt" },
      { status: 400 }
    );
  if (!reweAvailable().available)
    return NextResponse.json(
      { error: "REWE-Brücke nicht verfügbar" },
      { status: 503 }
    );

  const products = db
    .prepare(
      `SELECT DISTINCT rp.product_id, rp.title
       FROM rewe_product rp
       JOIN ingredient i ON i.rewe_product_id = rp.product_id`
    )
    .all() as Array<{ product_id: string; title: string }>;
  if (products.length === 0)
    return NextResponse.json(
      { error: "Keine REWE-Zuordnungen vorhanden" },
      { status: 400 }
    );

  try {
    const res = bridge(
      "refresh",
      {
        market: market.wwIdent,
        products: products.map((p) => ({ id: p.product_id, title: p.title })),
      },
      180000
    ) as {
      total: number;
      updated: number;
      failed: number;
      results: Array<{ id: string; ok: boolean; product?: ReweProduct }>;
    };
    for (const r of res.results) if (r.ok && r.product) upsertProduct(r.product);
    db.prepare(
      `INSERT INTO settings(key, value) VALUES('rewe_last_refresh', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = datetime('now')`
    ).run();
    return NextResponse.json({
      total: res.total,
      updated: res.updated,
      failed: res.failed,
    });
  } catch (e) {
    if (e instanceof ReweError)
      return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }
}
