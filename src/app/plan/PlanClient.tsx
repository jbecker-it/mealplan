"use client";

import { useCallback, useEffect, useState } from "react";

const SLOTS = ["B", "M", "A", "S"] as const;
const SLOT_NAMES: Record<string, string> = { B: "Frühstück", M: "Mittag", A: "Abend", S: "Snack" };
const SIZES = [0.5, 1, 1.5];
const DOW = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

interface Row {
  profile_id: number;
  profile_name: string;
  slot: string;
  recipe_id: number;
  title: string;
  servings: number;
  kcal: number;
  p: number;
  c: number;
  f: number;
}
interface Profile {
  id: number;
  name: string;
  kcal_target: number;
  p_target: number;
  c_target: number;
  f_target: number;
  sugar_target: number;
  salt_target: number;
}
interface PlanData {
  week: string;
  template: "A" | "B";
  day: number;
  rows: Row[];
  totals: Record<string, { kcal: number; p: number; c: number; f: number; sugar: number; salt: number; meals: number }>;
  profiles: Profile[];
  hasPlan: boolean;
}
interface RecipeOpt {
  id: number;
  title: string;
  kcal: number;
  protein_g: number;
}

export default function PlanClient() {
  const [data, setData] = useState<PlanData | null>(null);
  const [day, setDay] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [recipes, setRecipes] = useState<RecipeOpt[]>([]);
  const [picker, setPicker] = useState<{ day: number; profileId: number; slot: string } | null>(null);

  const load = useCallback(() => {
    fetch(`/api/plan?week=${data?.week ?? ""}&day=${day}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {});
  }, [day, data?.week]);

  useEffect(() => {
    if (!data) load();
  }, [load, data]);

  useEffect(() => {
    if (data) load();
  }, [day, data, load]);

  useEffect(() => {
    if (data?.profiles?.length) {
      fetch("/api/recipes")
        .then((r) => r.json())
        .then((rs: Array<RecipeOpt & { kcal: number | null }>) =>
          setRecipes(rs.filter((r) => r.kcal != null))
        )
        .catch(() => {});
    }
  }, [data?.profiles?.length]);

  async function generate() {
    setBusy(true);
    setMsg("");
    const r = await fetch("/api/plan/generate", { method: "POST" });
    const d = await r.json();
    if (!r.ok) setMsg(d.error || "Fehler");
    else setMsg(`Plan generiert (${d.ms} ms) — Template ${d.template}`);
    setBusy(false);
    load();
  }

  async function swap(profileId: number, slot: string, recipeId: number, servings: number) {
    const r = await fetch("/api/plan/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week: data!.week, day, profileId, slot, recipeId, servings }),
    });
    if (r.ok) {
      setPicker(null);
      load();
    }
  }

  async function changeServings(profileId: number, slot: string, servings: number) {
    const row = data!.rows.find(
      (r) => r.profile_id === profileId && r.slot === slot
    );
    if (!row) return;
    await fetch("/api/plan/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week: data!.week, day, profileId, slot, recipeId: row.recipe_id, servings }),
    });
    load();
  }

  if (!data)
    return <div className="py-20 text-center text-muted">Lade…</div>;

  const { profiles } = data;
  const cell = (pi: number, slot: string) =>
    data.rows.find((r) => r.profile_id === pi && r.slot === slot);

  const pct = (v: number, t: number) => Math.min(100, Math.round((v / t) * 100));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Wochenplan</h1>
        <span className="rounded-lg bg-card px-2.5 py-1 text-sm text-muted">
          {data.week} · Template <b className="text-accent">{data.template}</b>
        </span>
        <span className="flex-1" />
        <button
          onClick={generate}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 font-semibold text-background transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Berechne…" : "Plan generieren"}
        </button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>

      {!data.hasPlan && (
        <div className="mb-5 rounded-xl border border-dashed border-line bg-card p-6 text-center text-muted">
          Noch kein Plan — oben auf „Plan generieren“ klicken.
        </div>
      )}

      {/* Tagwahl */}
      <div className="mb-4 flex gap-1.5">
        {DOW.map((d, i) => (
          <button
            key={d}
            onClick={() => setDay(i)}
            className={`rounded-lg px-3.5 py-1.5 text-sm transition ${
              i === day ? "bg-accent font-semibold text-background" : "bg-card text-muted hover:text-foreground"
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {profiles.map((p) => {
          const tot = data.totals[String(p.id)];
          return (
            <div key={p.id} className="rounded-2xl border border-line bg-card">
              <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-muted">
                    Ziel: {p.kcal_target} kcal · {p.p_target} P · {p.c_target} C · {p.f_target} F
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-b-2xl bg-line sm:grid-cols-6">
                {(["kcal", "p", "c", "f", "sugar", "salt"] as const).map((m) => {
                  const target = { kcal: p.kcal_target, p: p.p_target, c: p.c_target, f: p.f_target, sugar: p.sugar_target, salt: p.salt_target }[m];
                  const val = tot ? (tot[m] ?? 0) : 0;
                  const pc = pct(val, target);
                  const over = val > target * 1.05;
                  const shown = val >= 10 ? Math.round(val) : Math.round(val * 10) / 10;
                  const shownT = target >= 10 ? Math.round(target) : Math.round(target * 10) / 10;
                  const label = { kcal: "kcal", p: "P", c: "C", f: "F", sugar: "Zucker", salt: "Salz" }[m];
                  return (
                    <div key={m} className="bg-card px-3 py-2.5 text-center">
                      <div className={`text-xs uppercase ${over ? "text-warn" : "text-muted"}`}>{label}</div>
                      <div className="text-sm font-semibold">
                        {shown}
                        <span className="text-xs font-normal text-muted">/{shownT}{m === "kcal" ? "" : " g"}</span>
                      </div>
                      <div className="mx-auto mt-1 h-1 w-full rounded bg-background">
                        <div
                          className={`h-1 rounded ${over ? "bg-warn" : "bg-accent"}`}
                          style={{ width: `${pc}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="divide-y divide-line">
                {SLOTS.map((slot) => {
                  const r = cell(p.id, slot);
                  return (
                    <div key={slot} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-20 text-xs uppercase tracking-wide text-muted">
                        {SLOT_NAMES[slot]}
                      </span>
                      {r ? (
                        <>
                          <button
                            onClick={() => setPicker({ day, profileId: p.id, slot })}
                            className="flex-1 truncate text-left text-sm hover:text-accent"
                            title="Klicken zum Ändern"
                          >
                            {r.title}
                          </button>
                          <div className="flex gap-0.5">
                            {SIZES.map((s) => (
                              <button
                                key={s}
                                onClick={() => changeServings(p.id, slot, s)}
                                className={`rounded px-1.5 py-0.5 text-xs transition ${
                                  r.servings === s
                                    ? "bg-accent font-semibold text-background"
                                    : "bg-card2 text-muted hover:text-foreground"
                                }`}
                              >
                                {s}×
                              </button>
                            ))}
                          </div>
                          <span className="w-16 text-right text-xs text-muted">
                            {Math.round(r.kcal)} kcal
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rezept-Picker */}
      {picker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPicker(null)}>
          <div className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">
                {SLOT_NAMES[picker.slot]} · {profiles.find((p) => p.id === picker.profileId)?.name}
              </h3>
              <button onClick={() => setPicker(null)} className="text-muted hover:text-foreground">✕</button>
            </div>
            <div className="space-y-1">
              {recipes.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-card2">
                  <button
                    className="flex-1 truncate text-left text-sm"
                    onClick={() => swap(picker.profileId, picker.slot, r.id, 1)}
                  >
                    {r.title}
                  </button>
                  <span className="text-xs text-muted">{r.kcal} kcal</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
