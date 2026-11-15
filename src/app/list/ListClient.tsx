"use client";

import { useCallback, useEffect, useState } from "react";

interface Item {
  id: number;
  name: string;
  category: string;
  unit: string | null;
  qty: number;
  used_in: string;
  checked: boolean;
}
interface Group {
  category: string;
  items: Item[];
}
interface ListData {
  week: string;
  groups: Group[];
  total: number;
  checkedCount: number;
}

export default function ListClient() {
  const [data, setData] = useState<ListData | null>(null);

  const load = useCallback(() => {
    fetch("/api/list").then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  useEffect(load, [load]);

  async function toggle(it: Item) {
    const next = !it.checked;
    it.checked = next; // optimistic
    if (data) setData({ ...data, checkedCount: data.checkedCount + (next ? 1 : -1) });
    await fetch("/api/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week: data?.week, ingredientId: it.id, checked: next }),
    });
  }

  if (!data) return <div className="py-20 text-center text-muted">Lade…</div>;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Einkaufsliste</h1>
        <span className="rounded-lg bg-card px-2.5 py-1 text-sm text-muted">{data.week}</span>
        <span className="rounded-lg bg-card px-2.5 py-1 text-sm text-muted">
          {data.checkedCount}/{data.total} abgehakt
        </span>
        <span className="flex-1" />
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
              <li key={it.id} className="flex items-center gap-3 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={it.checked}
                  onChange={() => toggle(it)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className={`flex-1 text-sm ${it.checked ? "text-muted line-through" : ""}`}>
                  {it.name}
                </span>
                <span className="text-sm text-muted">
                  {Number(it.qty).toLocaleString("de-DE")} {it.unit || ""}
                </span>
                <span className="hidden max-w-40 truncate text-xs text-muted/60 md:inline" title={it.used_in}>
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
