"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fmtAmount, fmtQty, parseAmount } from "@/lib/units";

interface IngRow {
  id: number;
  name: string;
  amount: number | null;
  unit: string | null;
}
interface Recipe {
  id: number;
  title: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  ingredients: IngRow[];
  steps: string[];
}
interface PlanRow {
  recipe_id: number;
  servings: number;
}

const QUICK = [1, 2, 3, 4, 6, 8];

// Kochmodus: Rezept (Mengen = 1 Portion) auf beliebig viele Portionen
// hochrechnen, Zutaten und Schritte abhaken, Bildschirm bleibt an.
export default function CookClient({ id, initialPortions }: { id: number; initialPortions: number | null }) {
  const [rec, setRec] = useState<Recipe | null>(null);
  const [err, setErr] = useState("");
  const [portions, setPortions] = useState(initialPortions ?? 1);
  const [text, setText] = useState(String(initialPortions ?? 1).replace(".", ","));
  const [planWeek, setPlanWeek] = useState<{ tpl: string; perDay: number } | null>(null);
  const [doneIng, setDoneIng] = useState<Set<number>>(new Set());
  const [doneStep, setDoneStep] = useState<Set<number>>(new Set());
  const [awake, setAwake] = useState(false);
  const lock = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    fetch(`/api/recipes/${id}`)
      .then(async (r) => (r.ok ? setRec(await r.json()) : setErr("Rezept nicht gefunden")))
      .catch(() => setErr("Laden fehlgeschlagen"));
    // Bedarf laut aktivem Plan (Portionen pro Tag, beide Personen)
    fetch("/api/plan?day=0", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { template: string; rows: PlanRow[] }) => {
        const perDay = j.rows.filter((r) => r.recipe_id === id).reduce((a, r) => a + Number(r.servings), 0);
        if (perDay > 0) setPlanWeek({ tpl: j.template, perDay });
      })
      .catch(() => {});
  }, [id]);

  // Bildschirm wach halten (Wake Lock API, wo verfügbar)
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) return;
    let cancelled = false;
    const acquire = () =>
      nav.wakeLock!
        .request("screen")
        .then((l) => {
          if (cancelled) void l.release();
          else {
            lock.current = l;
            setAwake(true);
          }
        })
        .catch(() => setAwake(false));
    void acquire();
    const onVis = () => document.visibilityState === "visible" && void acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      void lock.current?.release().catch(() => {});
    };
  }, []);

  const setP = (v: number) => {
    const n = Math.max(0.25, Math.round(v * 4) / 4);
    setPortions(n);
    setText(String(n).replace(".", ","));
  };

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, k: number) => {
    const next = new Set(set);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setter(next);
  };

  if (err) return <div className="py-20 text-center text-danger">{err}</div>;
  if (!rec) return <div className="py-20 text-center text-muted">Lade…</div>;

  const btn = (active: boolean) =>
    `rounded-lg px-3 py-2 text-sm font-semibold transition ${
      active ? "bg-accent text-background" : "bg-card2 text-muted hover:text-foreground"
    }`;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/recipes" className="text-sm text-muted hover:text-foreground">← Rezepte</Link>
        <span className="flex-1" />
        {awake && <span className="text-xs text-muted">Bildschirm bleibt an</span>}
      </div>
      <h1 className="text-2xl font-bold">{rec.title}</h1>

      {/* Portionen */}
      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-sm font-semibold uppercase tracking-wide text-muted">Portionen</span>
          <span className="flex-1" />
          <button onClick={() => setP(portions - 1)} className="h-10 w-10 rounded-lg bg-card2 text-xl font-bold hover:text-accent" aria-label="Weniger">−</button>
          <input
            value={text}
            inputMode="decimal"
            onChange={(e) => {
              setText(e.target.value);
              const n = parseAmount(e.target.value);
              if (n && n > 0) setPortions(n);
            }}
            onBlur={() => setText(String(portions).replace(".", ","))}
            className="h-10 w-20 rounded-lg border border-line bg-background text-center text-xl font-bold outline-none focus:border-accent"
          />
          <button onClick={() => setP(portions + 1)} className="h-10 w-10 rounded-lg bg-card2 text-xl font-bold hover:text-accent" aria-label="Mehr">+</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q} onClick={() => setP(q)} className={btn(portions === q)}>
              {q}
            </button>
          ))}
          {planWeek && (
            <>
              <button onClick={() => setP(planWeek.perDay * 7)} className={btn(portions === planWeek.perDay * 7)} title={`Template ${planWeek.tpl}: ${fmtAmount(planWeek.perDay, "x")} Portionen pro Tag × 7`}>
                Woche laut Plan ({fmtAmount(planWeek.perDay * 7, "x")})
              </button>
              <button onClick={() => setP(planWeek.perDay)} className={btn(portions === planWeek.perDay)} title={`Template ${planWeek.tpl}: beide Personen, ein Tag`}>
                1 Tag ({fmtAmount(planWeek.perDay, "x")})
              </button>
            </>
          )}
        </div>
        {rec.kcal != null && (
          <p className="mt-3 text-xs text-muted">
            Gesamt: {Math.round(rec.kcal * portions).toLocaleString("de-DE")} kcal · P {Math.round((rec.protein_g ?? 0) * portions)} g ·
            KH {Math.round((rec.carbs_g ?? 0) * portions)} g · F {Math.round((rec.fat_g ?? 0) * portions)} g
          </p>
        )}
      </div>

      {/* Zutaten */}
      <div className="rounded-2xl border border-line bg-card">
        <div className="border-b border-line px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-muted">
          Zutaten für {fmtAmount(portions, "x")} {portions === 1 ? "Portion" : "Portionen"}
        </div>
        <ul className="divide-y divide-line">
          {rec.ingredients.map((i) => {
            const done = doneIng.has(i.id);
            const unit = i.unit || "";
            return (
              <li key={i.id}>
                <button onClick={() => toggle(doneIng, setDoneIng, i.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${done ? "border-accent bg-accent text-background" : "border-line"}`}>
                    {done ? "✓" : ""}
                  </span>
                  <span className={`w-28 shrink-0 text-right text-lg font-bold tabular-nums ${done ? "text-muted line-through" : "text-accent"}`}>
                    {fmtQty(i.amount != null ? i.amount * portions : null, unit)}
                  </span>
                  <span className={`text-base ${done ? "text-muted line-through" : ""}`}>{i.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Schritte */}
      {rec.steps.length > 0 && (
        <div className="rounded-2xl border border-line bg-card">
          <div className="border-b border-line px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-muted">Zubereitung</div>
          <ol className="divide-y divide-line">
            {rec.steps.map((s, idx) => {
              const done = doneStep.has(idx);
              return (
                <li key={idx}>
                  <button onClick={() => toggle(doneStep, setDoneStep, idx)} className="flex w-full gap-3 px-4 py-3 text-left">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-accent text-background" : "bg-card2 text-muted"}`}>
                      {done ? "✓" : idx + 1}
                    </span>
                    <span className={`text-base leading-relaxed ${done ? "text-muted line-through" : ""}`}>{s}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <p className="text-center text-xs text-muted">Mengen im Rezept gelten für 1 Portion und werden hier hochgerechnet.</p>
    </div>
  );
}
