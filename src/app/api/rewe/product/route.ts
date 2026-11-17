import { NextRequest, NextResponse } from "next/server";
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

// GET ?id=157910 → Produktdetail (Cache, ggf. Live-Anreicherung mit
// Beschreibung + Nährwerten; funktioniert nur in Pickup-Märkten).
export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });

  const cached = db
    .prepare("SELECT * FROM rewe_product WHERE product_id = ?")
    .get(id) as Record<string, unknown> | undefined;

  if (reweAvailable().available) {
    const market = activeMarket();
    if (market) {
      try {
        const live = bridge("product", { market: market.wwIdent, id }, 30000) as ReweProduct;
        upsertProduct(live);
      } catch (e) {
        if (e instanceof ReweError && e.code === 4) {
          // Nur Delivery-Markt → Cache-Grundlage reicht
        } else if (e instanceof ReweError) {
          return NextResponse.json({ error: e.message }, { status: 502 });
        } else {
          throw e;
        }
      }
    }
  }

  const product =
    (db
      .prepare("SELECT * FROM rewe_product WHERE product_id = ?")
      .get(id) as Record<string, unknown> | undefined) ?? cached;
  if (!product)
    return NextResponse.json({ error: "Produkt unbekannt" }, { status: 404 });
  return NextResponse.json({ product });
}
