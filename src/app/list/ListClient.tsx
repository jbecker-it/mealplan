"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fmtQty, isCountable } from "@/lib/units";

interface Rewe {
  productId: string;
  title: string;
  image: string | null;
  priceCents: number | null;
  vegan: boolean;
  grammage: string | null;
  brand: string | null;
  url: string;
  packs: number | null;
  costCents: number | null;
}
interface Item {
  id: number;
  name: string;
  category: string;
  ingredient_id: number;
  amounts: Array<{ qty: number | null; unit: string }>;
  used_in: string;
  checked: boolean;
  rewe: Rewe | null;
}
interface Group {
  category: string;
  items: Item[];
}
interface ListData {
  template?: string;
  groups: Group[];
  total: number;
  checkedCount: number;
  rewe: { totalCents: number; mappedCount: number; unmappedCount: number };
}

const euro = (cents: number) =>
  (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export default function ListClient() {
  const [data, setData] = useState<ListData | null>(null);

  const load = useCallback(() => {
    fetch("/api/list").then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  useEffect(load, [load]);

  async function toggle(it: Item) {
    if (!data) return;
    const next = !it.checked;
    // optimistisch, ohne State zu mutieren
    setData({
      ...data,
      checkedCount: data.checkedCount + (next ? 1 : -1),
      groups: data.groups.map((g) => ({
        ...g,
        items: g.items.map((x) => (x.ingredient_id === it.ingredient_id ? { ...x, checked: next } : x)),
      })),
    });
    await fetch("/api/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: data.template, ingredientId: it.ingredient_id, checked: next }),
    });
  }

  async function resetChecks() {
    if (!data || !confirm("Alle Haken entfernen?")) return;
    await fetch("/api/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: data.template, reset: true }),
    });
    load();
  }

  if (!data) return <div className="py-20 text-center text-muted">Lade…</div>;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Einkaufsliste</h1>
        {data.template && (
          <span className="rounded-lg bg-card px-2.5 py-1 text-sm text-muted" title="Nur dieses Template — wechseln im Wochenplan">
            Template {data.template}
          </span>
        )}
        <span className="rounded-lg bg-card px-2.5 py-1 text-sm text-muted">
          {data.checkedCount}/{data.total} abgehakt
        </span>
        {data.rewe.totalCents > 0 && (
          <span className="rounded-lg bg-card px-2.5 py-1 text-sm font-semibold text-accent">
            REWE {euro(data.rewe.totalCents)}
          </span>
        )}
        {data.rewe.unmappedCount > 0 && (
          <Link
            href="/rewe"
            className="rounded-lg border border-line px-2.5 py-1 text-sm text-muted transition hover:text-foreground"
          >
            {data.rewe.unmappedCount} ohne REWE-Zuordnung →
          </Link>
        )}
        <span className="flex-1" />
        {data.checkedCount > 0 && (
          <button onClick={resetChecks} className="rounded-lg bg-card px-3 py-1.5 text-sm text-muted hover:text-foreground">
            Haken zurücksetzen
          </button>
        )}
        {(data.groups.length > 0 || data.checkedCount > 0) && (
          <button onClick={load} className="rounded-lg bg-card px-3 py-1.5 text-sm text-muted hover:text-foreground">
            Neu laden
          </button>
        )}
      </div>

      {data.total === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-card p-10 text-center text-muted">
          Noch keine Liste — zuerst einen Plan generieren.
        </div>
      )}

      {data.groups.map((g) => (
        <div key={g.category} className="mb-4 rounded-2xl border border-line bg-card">
          <div className="border-b border-line px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-muted">
            {g.category}
          </div>
          <ul className="divide-y divide-line">
            {g.items.map((it) => (
              <li key={it.ingredient_id} className="flex items-center gap-3 px-4 py-2">
                <input
                  type="checkbox"
                  checked={it.checked}
                  onChange={() => toggle(it)}
                  className="h-5 w-5 shrink-0 accent-[var(--accent)]"
                />
                {it.rewe?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.rewe.image}
                    alt={it.rewe.title}
                    className="h-9 w-9 rounded-md border border-line object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <span className="h-9 w-9 shrink-0 rounded-md border border-dashed border-line" />
                )}
                <span className={`min-w-0 flex-1 text-sm ${it.checked ? "text-muted line-through" : ""}`}>
                  <span className="block truncate">{it.name}</span>
                  {it.rewe && (
                    <a
                      href={it.rewe.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs text-muted/70 hover:text-accent"
                    >
                      {it.rewe.brand ? `${it.rewe.brand} · ` : ""}
                      {it.rewe.title}
                      {it.rewe.vegan && " 🌱"}
                    </a>
                  )}
                </span>
                <span className="shrink-0 text-right text-sm text-muted">
                  {it.amounts
                    .map((a) => fmtQty(a.qty != null && isCountable(a.unit) ? Math.ceil(a.qty - 1e-9) : a.qty, a.unit))
                    .join(" + ")}
                </span>
                {it.rewe?.priceCents != null && (
                  <span className="shrink-0 text-right text-sm font-medium tabular-nums">
                    {it.rewe.packs != null && (
                      <span className="text-xs text-muted">
                        {it.rewe.packs}× {euro(it.rewe.priceCents)}
                      </span>
                    )}
                    {it.rewe.costCents != null && (
                      <span className="ml-1">{euro(it.rewe.costCents)}</span>
                    )}
                  </span>
                )}
                <span className="hidden max-w-40 truncate text-xs text-muted/60 lg:inline" title={it.used_in}>
                  {it.used_in}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
