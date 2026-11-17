import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";
import {
  bridge,
  ReweError,
  reweAvailable,
  setActiveMarket,
  activeMarket,
  type ReweMarket,
} from "@/lib/rewe";

// GET  ?q=     → Märkte suchen (z. B. "Dortmund")
// POST {…}     → aktiven Markt festlegen
export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q)
    return NextResponse.json({ error: "Suchbegriff fehlt (q=…)" }, { status: 400 });
  if (!reweAvailable().available)
    return NextResponse.json(
      { error: "REWE-Brücke nicht verfügbar" },
      { status: 503 }
    );
  try {
    const markets = bridge("markets", { query: q }) as ReweMarket[];
    return NextResponse.json({ markets, active: activeMarket() });
  } catch (e) {
    if (e instanceof ReweError)
      return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = await readJson(req);
  if (raw === null) return badJson;
  const m = raw as ReweMarket;
  if (!m.wwIdent || !m.name)
    return NextResponse.json({ error: "wwIdent und name fehlen" }, { status: 400 });
  setActiveMarket(m);
  return NextResponse.json({ ok: true, market: activeMarket() });
}
