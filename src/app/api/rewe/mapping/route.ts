import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import { upsertProduct, type ReweProduct } from "@/lib/rewe";

// POST {ingredientId, productId|null, product?} → Zutat ↔ REWE-Produkt
// zuordnen (productId=null löscht die Zuordnung).
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson;
  const { ingredientId, productId, product } = raw as {
    ingredientId: number;
    productId: string | null;
    product?: ReweProduct;
  };
  if (!ingredientId)
    return NextResponse.json({ error: "ingredientId fehlt" }, { status: 400 });

  const ing = db
    .prepare("SELECT id FROM ingredient WHERE id = ?")
    .get(ingredientId) as { id: number } | undefined;
  if (!ing)
    return NextResponse.json({ error: "Zutat unbekannt" }, { status: 404 });

  if (productId) {
    if (product && product.productId === productId) upsertProduct(product);
    else {
      const known = db
        .prepare("SELECT product_id FROM rewe_product WHERE product_id = ?")
        .get(productId);
      if (!known)
        return NextResponse.json(
          { error: "Produkt nicht im Cache — zuerst suchen." },
          { status: 400 }
        );
    }
  }
  db.prepare("UPDATE ingredient SET rewe_product_id = ? WHERE id = ?").run(
    productId ?? null,
    ingredientId
  );
  return NextResponse.json({ ok: true });
}
