"use client";

import { useCallback, useEffect, useState } from "react";

type Market = {
  wwIdent: string;
  name: string;
  city: string | null;
  plz: string | null;
  street: string | null;
};
type Product = {
  productId: string;
  title: string;
  brand: string | null;
  imageURL: string | null;
  grammage: string | null;
  priceCents: number | null;
  isVegan: boolean;
  isOrganic: boolean;
  discount: unknown;
};
type Ing = {
  id: number;
  name: string;
  category: string;
  recipe_count: number;
  rewe_product_id: string | null;
};
type Offer = {
  title: string;
  brand: string | null;
  priceCents: number | null;
  imageURL: string | null;
  loyaltyBonus: unknown;
};
type Status = {
  bridge: { available: boolean; live: boolean; reason?: string };
  market: Market | null;
  mapped: number;
  lastRefresh: string | null;
};

const euro = (c: number | null) =>
  c == null ? "–" : (c / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export default function ReWeClient() {
  const [status, setStatus] = useState<Status | null>(null);

  // Markt
  const [mQuery, setMQuery] = useState("");
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [mBusy, setMBusy] = useState(false);
  const [mError, setMError] = useState<string | null>(null);

  // Zuordnung
  const [iQuery, setIQuery] = useState("");
  const [ingredients, setIngredients] = useState<Ing[]>([]);
  const [pQuery, setPQuery] = useState("");
  const [vegan, setVegan] = useState(true);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [pBusy, setPBusy] = useState(false);
  const [pError, setPError] = useState<string | null>(null);
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [pickingFor, setPickingFor] = useState<Ing | null>(null);

  // Refresh + Angebote
  const [rBusy, setRBusy] = useState(false);
  const [rMsg, setRMsg] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [oError, setOError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const r = await fetch("/api/rewe/status");
    setStatus((await r.json()) as Status);
  }, []);

  const loadIngredients = useCallback(async () => {
    const r = await fetch("/api/ingredients");
    setIngredients((await r.json()) as Ing[]);
  }, []);

  useEffect(() => {
    loadStatus();
    loadIngredients();
  }, [loadStatus, loadIngredients]);

  async function searchMarkets() {
    if (!mQuery.trim()) return;
    setMBusy(true);
    setMError(null);
    try {
      const r = await fetch(`/api/rewe/market?q=${encodeURIComponent(mQuery.trim())}`);
      const j = await r.json();
      if (!r.ok) setMError(j.error || "Fehler");
      else setMarkets(j.markets);
    } catch {
      setMError("Keine Verbindung");
    }
    setMBusy(false);
  }

  async function activateMarket(m: Market) {
    const r = await fetch("/api/rewe/market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(m),
    });
    const j = await r.json();
    if (r.ok) {
      setMarkets(null);
      setMQuery("");
      await loadStatus();
    } else setMError(j.error || "Fehler");
  }

  async function searchProducts() {
    if (!pQuery.trim()) return;
    setPBusy(true);
    setPError(null);
    try {
      const r = await fetch(
        `/api/rewe/search?q=${encodeURIComponent(pQuery.trim())}&vegan=${vegan ? 1 : 0}`
      );
      const j = await r.json();
      if (!r.ok) setPError(j.error || "Fehler");
      else setProducts(j.products);
    } catch {
      setPError("Keine Verbindung");
    }
    setPBusy(false);
  }

  async function assign(product: Product, ing: Ing) {
    const r = await fetch("/api/rewe/mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ingredientId: ing.id,
        productId: product.productId,
        product,
      }),
    });
    const j = await r.json();
    if (r.ok) {
      setAssignMsg(`${ing.name} → ${product.title}`);
      loadIngredients();
      await loadStatus();
      setPickingFor(null);
      setProducts(null);
      setPQuery("");
    } else {
      setAssignMsg(`Fehler: ${j.error || "unbekannt"}`);
    }
  }

  async function unassign(ing: Ing) {
    await fetch("/api/rewe/mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredientId: ing.id, productId: null }),
    });
    loadIngredients();
    await loadStatus();
  }

  async function refresh() {
    setRBusy(true);
    setRMsg(null);
    try {
      const r = await fetch("/api/rewe/refresh", { method: "POST" });
      const j = await r.json();
      if (r.ok) setRMsg(`${j.updated}/${j.total} aktualisiert${j.failed ? `, ${j.failed} fehlgeschlagen` : ""}`);
      else setRMsg(`Fehler: ${j.error || "unbekannt"}`);
      await loadStatus();
    } catch {
      setRMsg("Keine Verbindung");
    }
    setRBusy(false);
  }

  async function loadOffers() {
    setOError(null);
    try {
      const r = await fetch("/api/rewe/discounts");
      const j = await r.json();
      if (!r.ok) setOError(j.error || "Fehler");
      else setOffers((j.offers || []).slice(0, 24));
    } catch {
      setOError("Keine Verbindung");
    }
  }

  const filteredIng = ingredients.filter(
    (i) =>
      i.name.toLowerCase().includes(iQuery.toLowerCase()) ||
      i.category.toLowerCase().includes(iQuery.toLowerCase())
  );
  const mappedIng = filteredIng.filter((i) => i.rewe_product_id);
  const unmappedIng = filteredIng.filter((i) => !i.rewe_product_id);

  if (!status) return <div className="py-20 text-center text-muted">Lade…</div>;

  const bridgeOff = !status.bridge.available;

  return (
    <div className="space-y-5">
      {/* Status */}
      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">REWE</h1>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              status.bridge.live
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
            }`}
          >
            {status.bridge.available
              ? status.bridge.live
                ? "Live"
                : "Erreichbar"
              : "Nicht verfügbar"}
          </span>
          {status.market ? (
            <span className="text-sm text-muted">
              {status.market.name}
              {status.market.plz ? ` · ${status.market.plz}` : ""}
            </span>
          ) : (
            <span className="text-sm text-amber-600 dark:text-amber-400">Kein Markt gewählt</span>
          )}
          <span className="flex-1" />
          <button
            onClick={refresh}
            disabled={rBusy || bridgeOff || !status.market}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {rBusy ? "Aktualisiere…" : "Preise aktualisieren"}
          </button>
        </div>
        {bridgeOff && (
          <p className="mt-2 text-sm text-muted">{status.bridge.reason ?? "Brücke fehlt."}</p>
        )}
        {rMsg && <p className="mt-2 text-sm text-accent">{rMsg}</p>}
        {status.lastRefresh && (
          <p className="mt-1 text-xs text-muted">Letzte Aktualisierung: {status.lastRefresh}</p>
        )}
      </div>

      {/* Markt */}
      <div className="rounded-2xl border border-line bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Markt</h2>
        <div className="flex gap-2">
          <input
            value={mQuery}
            onChange={(e) => setMQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchMarkets()}
            placeholder="PLZ, Stadt oder Adresse (z. B. Dortmund)"
            disabled={bridgeOff}
            className="flex-1 rounded-lg border border-line bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={searchMarkets}
            disabled={mBusy || bridgeOff || !mQuery.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {mBusy ? "…" : "Suchen"}
          </button>
        </div>
        {mError && <p className="mt-2 text-sm text-rose-500">{mError}</p>}
        {markets && (
          <ul className="mt-3 divide-y divide-line">
            {markets.map((m) => (
              <li key={m.wwIdent} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate">{m.name}</span>
                  <span className="text-xs text-muted">
                    {[m.street, m.plz, m.city].filter(Boolean).join(", ")}
                  </span>
                </span>
                {status.market?.wwIdent === m.wwIdent ? (
                  <span className="text-xs text-accent">aktiv</span>
                ) : (
                  <button
                    onClick={() => activateMarket(m)}
                    className="rounded-lg border border-line px-3 py-1 text-sm hover:border-accent"
                  >
                    Verwenden
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Zuordnung */}
      <div className="rounded-2xl border border-line bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
          Zutaten ↔ REWE-Produkte
        </h2>
        <p className="mb-3 text-xs text-muted">
          Zuordnung pro Zutat: Einkaufsliste zeigt dann Bild, Packgröße, Preis und
          Gesamtkosten.
        </p>

        <div className="flex gap-2">
          <input
            value={iQuery}
            onChange={(e) => setIQuery(e.target.value)}
            placeholder="Zutat filtern (z. B. Haferflocken, Erbsen)"
            className="flex-1 rounded-lg border border-line bg-background px-3 py-2 text-sm"
          />
        </div>

        {assignMsg && <p className="mt-2 text-sm text-accent">{assignMsg}</p>}

        {/* Unzugeordnete Zutaten */}
        {unmappedIng.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Ohne REWE-Produkt ({unmappedIng.length})
            </div>
            <ul className="mt-1 max-h-64 divide-y divide-line overflow-y-auto">
              {unmappedIng.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {i.name} <span className="text-xs text-muted">({i.category}, {i.recipe_count}×)</span>
                  </span>
                  <button
                    onClick={() => {
                      setPickingFor(i);
                      setPQuery(i.name);
                    }}
                    className="rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent"
                  >
                    Zuordnen
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Zugeordnete Zutaten */}
        {mappedIng.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Zugeschrieben ({mappedIng.length})
            </div>
            <ul className="mt-1 max-h-64 divide-y divide-line overflow-y-auto">
              {mappedIng.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {i.name}{" "}
                    <span className="text-xs text-accent">→ {i.rewe_product_id}</span>
                  </span>
                  <button
                    onClick={() => unassign(i)}
                    className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-rose-500"
                  >
                    Entfernen
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Produkt-Suche */}
        {pickingFor && (
          <div className="mt-4 rounded-xl border border-accent/40 p-3">
            <div className="mb-2 text-sm font-medium">
              Produkt für <span className="text-accent">{pickingFor.name}</span> suchen
            </div>
            <div className="flex gap-2">
              <input
                value={pQuery}
                onChange={(e) => setPQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchProducts()}
                placeholder="REWE-Produkt (z. B. Haferflocken)"
                className="flex-1 rounded-lg border border-line bg-background px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={vegan}
                  onChange={(e) => setVegan(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                vegan
              </label>
              <button
                onClick={searchProducts}
                disabled={pBusy || !pQuery.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {pBusy ? "…" : "Suchen"}
              </button>
              <button
                onClick={() => {
                  setPickingFor(null);
                  setProducts(null);
                }}
                className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
              >
                Abbrechen
              </button>
            </div>
            {pError && <p className="mt-2 text-sm text-rose-500">{pError}</p>}
            {products && (
              <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto">
                {products.length === 0 && (
                  <li className="py-3 text-sm text-muted">Keine Treffer</li>
                )}
                {products.map((p) => (
                  <li key={p.productId} className="flex items-center gap-3 py-2">
                    {p.imageURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageURL}
                        alt={p.title}
                        className="h-10 w-10 rounded-md border border-line object-contain"
                      />
                    ) : (
                      <span className="h-10 w-10 shrink-0 rounded-md border border-dashed border-line" />
                    )}
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block truncate">{p.title}</span>
                      <span className="text-xs text-muted">
                        {p.brand ? `${p.brand} · ` : ""}
                        {p.grammage}
                        {p.isVegan ? " · 🌱 vegan" : ""}
                        {p.isOrganic ? " · bio" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {euro(p.priceCents)}
                    </span>
                    <button
                      onClick={() => assign(p, pickingFor)}
                      className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white"
                    >
                      Zuordnen
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Angebote */}
      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="mb-2 flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Angebote der Woche
          </h2>
          <span className="flex-1" />
          <button
            onClick={loadOffers}
            disabled={bridgeOff || !status.market}
            className="rounded-lg border border-line px-3 py-1 text-xs hover:border-accent disabled:opacity-40"
          >
            {offers ? "Neu laden" : "Laden"}
          </button>
        </div>
        {oError && <p className="text-sm text-rose-500">{oError}</p>}
        {offers && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {offers.map((o, idx) => (
              <div key={idx} className="rounded-xl border border-line p-2">
                {o.imageURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={o.imageURL}
                    alt={o.title}
                    className="mb-2 h-24 w-full rounded-lg object-contain"
                  />
                ) : (
                  <div className="mb-2 h-24 w-full rounded-lg border border-dashed border-line" />
                )}
                <p className="line-clamp-2 text-xs">{o.title}</p>
                <p className="mt-1 text-sm font-semibold text-accent">{euro(o.priceCents)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
