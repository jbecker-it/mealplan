"use client";
import { useCallback, useEffect, useState } from "react";

const SLOT_NAMES: Record<string, string> = {
  B: "Frühstück",
  M: "Mittag",
  A: "Abend",
  S: "Snack",
};
const SLOT_ORDER = ["B", "M", "A", "S"];

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
  sugar: number;
  salt: number;
}
interface Totals {
  kcal: number;
  p: number;
  c: number;
  f: number;
  sugar: number;
  salt: number;
  meals: number;
}
interface PlanData {
  week: string;
  template: string;
  day: number;
  rows: Row[];
  totals: Record<string, Totals>;
  profiles: Profile[];
  hasPlan: boolean;
}
interface Suggestion {
  rank: number;
  id: number;
  title: string;
  servings: number;
  kcal: number;
  p: number;
  c: number;
  f: number;
  sugar: number;
  salt: number;
  score: number;
  deltaKcal: number;
  current: boolean;
}

function fmt(n: number, d = 0) {
  return n.toLocaleString("de-DE", { maximumFractionDigits: d });
}

function Cell({ v, t }: { v: number; t: number }) {
  if (!t) return <span className="px-2 py-1 text-slate-500">—</span>;
  const over = v > t * 1.05;
  const under = v < t * 0.7;
  return (
    <span
      className={`px-2 py-1 tabular-nums ${
        over ? "bg-rose-500/10 text-rose-400 font-semibold" : under ? "text-amber-300/80" : "text-emerald-300"
      }`}
    >
      {fmt(v, 1)}
    </span>
  );
}

export default function PlanClient() {
  const [week, setWeek] = useState("");
  const [template, setTemplate] = useState<"A" | "B">("A");
  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  // Swap-Dialog
  const [swapSlot, setSwapSlot] = useState<{ slot: string; profileId: number; profileName: string } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  // Vorlage speichern
  const [tplName, setTplName] = useState("");
  const [savingTpl, setSavingTpl] = useState(false);

  const load = useCallback(async (tpl?: "A" | "B") => {
    setLoading(true);
    const r = await fetch(
      `/api/plan?template=${tpl ?? template}&day=0`,
      { cache: "no-store" }
    );
    if (r.ok) {
      const j: PlanData = await r.json();
      setData(j);
      if (j.week) setWeek(j.week);
    } else setMsg({ text: "Fehler beim Laden des Plans", kind: "err" });
    setLoading(false);
  }, [template]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setBusy("generate");
    const r = await fetch("/api/plan/generate", { method: "POST" });
    const j = await r.json();
    setMsg(
      r.ok
        ? { text: j.note || `Wochenplan generiert (${j.ms} ms) — Templates A und B`, kind: "ok" }
        : { text: j.error || "Generierung fehlgeschlagen", kind: "err" }
    );
    setBusy(null);
    void load();
  };

  const openSwap = async (slot: string, profileId: number, profileName: string) => {
    setSwapSlot({ slot, profileId, profileName });
    setSuggestions(null);
    setSuggestLoading(true);
    const r = await fetch(
      `/api/plan/suggest?week=${encodeURIComponent(week)}&template=${template}&slot=${slot}&profileId=${profileId}`,
      { cache: "no-store" }
    );
    if (r.ok) setSuggestions((await r.json()).suggestions as Suggestion[]);
    else setMsg({ text: "Vorschläge konnten nicht geladen werden", kind: "err" });
    setSuggestLoading(false);
  };

  const doSwap = async (s: Suggestion) => {
    if (!swapSlot) return;
    setBusy(`swap-${s.id}`);
    const r = await fetch("/api/plan/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        week,
        template,
        profileId: swapSlot.profileId,
        slot: swapSlot.slot,
        recipeId: s.id,
        servings: s.servings,
      }),
    });
    const j = await r.json();
    setMsg(
      r.ok
        ? {
            text: r.status === 200 && j.note ? j.note : `${swapSlot.profileName} · ${SLOT_NAMES[swapSlot.slot]}: → „${s.title}“ (${s.servings}×) · 7 Tage + Einkaufsliste aktualisiert`,
            kind: "ok",
          }
        : { text: j.error || "Austausch fehlgeschlagen", kind: "err" }
    );
    setBusy(null);
    setSwapSlot(null);
    setSuggestions(null);
    void load();
  };

  const saveTemplate = async () => {
    if (!tplName.trim()) return;
    setSavingTpl(true);
    const r = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tplName.trim(), week, template }),
    });
    const j = await r.json();
    setMsg(
      r.ok
        ? { text: j.note || "Vorlage gespeichert", kind: "ok" }
        : { text: j.error || "Speichern fehlgeschlagen", kind: "err" }
    );
    setSavingTpl(false);
    if (r.ok) setTplName("");
  };

  const rowsBySlot = (slot: string) =>
    (data?.rows || []).filter((r) => r.slot === slot);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Wochenplan</h1>
        <span className="text-sm text-slate-400">
          {week} · <b>Template {template}</b> · alle 7 Tage identisch
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            {(["A", "B"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTemplate(t)}
                className={`px-4 py-2 text-sm font-medium ${
                  template === t
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800/50 text-slate-400 hover:bg-slate-800"
                }`}
              >
                Template {t}
              </button>
            ))}
          </div>
          <button
            onClick={generate}
            disabled={!!busy}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
          >
            {busy === "generate" ? "Optimiere…" : "Neu generieren"}
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            msg.kind === "ok" ? "bg-emerald-900/40 text-emerald-300" : "bg-rose-900/40 text-rose-300"
          }`}
        >
          {msg.text}
        </div>
      )}

      {!data?.hasPlan && (
        <div className="rounded-xl border border-dashed border-white/15 p-8 text-center text-slate-400">
          Noch kein Plan für diese Woche. Oben auf <b>„Neu generieren“</b> tippen —
          dann entstehen Template A und B (jeweils ein Tag, an allen 7 Tagen identisch).
        </div>
      )}

      {data?.hasPlan &&
        SLOT_ORDER.map((slot) => {
          const slotRows = rowsBySlot(slot);
          const shared = slot === "M" || slot === "A";
          return (
            <div key={slot} className="rounded-xl border border-white/10 bg-slate-900/50 overflow-hidden">
              <div className="flex items-center px-4 py-2 bg-slate-800/60">
                <h3 className="font-semibold text-sm">{SLOT_NAMES[slot]}</h3>
                {shared && <span className="ml-2 text-[11px] text-slate-500">gemeinsam</span>}
              </div>
              {slotRows.length === 0 ? (
                <div className="p-4 text-sm text-slate-500">— leer —</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-white/5">
                      <th className="px-2 py-1 text-left">Profil</th>
                      <th className="px-2 py-1 text-left">Mahlzeit</th>
                      <th className="px-2 py-1 text-left">Portion</th>
                      <th className="px-2 py-1 text-right">kcal</th>
                      <th className="px-2 py-1 text-right">P</th>
                      <th className="px-2 py-1 text-right">C</th>
                      <th className="px-2 py-1 text-right">F</th>
                      <th className="px-2 py-1 text-right">Zucker</th>
                      <th className="px-2 py-1 text-right">Salz</th>
                      <th className="px-2 py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {slotRows.map((r) => (
                      <tr key={`${r.profile_id}-${r.slot}`} className="border-b border-white/5 last:border-0">
                        <td className="px-2 py-1 text-slate-300">{r.profile_name}</td>
                        <td className="px-2 py-1">{r.title}</td>
                        <td className="px-2 py-1 text-slate-400">{r.servings}×</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(r.kcal)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(r.p, 1)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(r.c, 1)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(r.f, 1)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(r.sugar, 1)} g</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(r.salt, 2)} g</td>
                        <td className="px-2 py-1 text-right">
                          <button
                            onClick={() => openSwap(slot, r.profile_id, r.profile_name)}
                            className="text-xs text-emerald-400 hover:text-emerald-300"
                          >
                            Austauschen
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}

      {data?.hasPlan && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.profiles.map((p) => {
            const t = data.totals[String(p.id)];
            return (
              <div key={p.id} className="rounded-xl border border-white/10 bg-slate-900/50 p-4">
                <h3 className="font-semibold mb-2">{p.name}</h3>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-[11px] uppercase text-slate-500">kcal</div>
                    <Cell v={t?.kcal || 0} t={p.kcal_target} />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-slate-500">Protein</div>
                    <Cell v={t?.p || 0} t={p.p_target} />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-slate-500">KH</div>
                    <Cell v={t?.c || 0} t={p.c_target} />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-slate-500">Fett</div>
                    <Cell v={t?.f || 0} t={p.f_target} />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-slate-500">Zucker</div>
                    <Cell v={t?.sugar || 0} t={p.sugar_target} />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-slate-500">Salz</div>
                    <Cell v={t?.salt || 0} t={p.salt_target} />
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {t?.meals || 0} Mahlzeiten · Tag ist an allen 7 Wochen Tagen identisch
                </p>
              </div>
            );
          })}
        </div>
      )}

      {data?.hasPlan && (
        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Vorlage speichern:</span>
          <input
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
            placeholder={`z. B. „Mein ${template}-Tag“`}
            className="flex-1 min-w-[180px] rounded-lg bg-slate-800 border border-white/10 px-3 py-2 text-sm placeholder:text-slate-600"
          />
          <button
            onClick={saveTemplate}
            disabled={savingTpl || !tplName.trim()}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium disabled:opacity-40"
          >
            {savingTpl ? "Speichert…" : `Template ${template} als Vorlage speichern`}
          </button>
        </div>
      )}

      {loading && (
        <div className="text-sm text-slate-500 animate-pulse">Lade Plan…</div>
      )}

      {/* Swap-Dialog */}
      {swapSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSwapSlot(null)}>
          <div className="w-full max-w-lg rounded-xl border border-white/10 bg-slate-900 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">
                {SLOT_NAMES[swapSlot.slot]} austauschen · {swapSlot.profileName}
              </h3>
              <button onClick={() => { setSwapSlot(null); setSuggestions(null); }} className="text-slate-500 hover:text-white">✕</button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Sortiert nach bestem Ersatz für genau diese Position (KH/Fett hart, Protein am Ziel,
              Zucker/Salz best-effort). Der Wechsel gilt für alle 7 Tage von Template {template};
              die Einkaufsliste aktualisiert sich automatisch.
            </p>
            {suggestLoading && <div className="text-sm text-slate-500 animate-pulse">Lade Vorschläge…</div>}
            {suggestions && suggestions.length === 0 && (
              <div className="text-sm text-slate-500">Keine Alternativen für diesen Slot.</div>
            )}
            <div className="space-y-1 max-h-[50vh] overflow-y-auto">
              {suggestions?.map((s) => (
                <button
                  key={s.id}
                  onClick={() => doSwap(s)}
                  disabled={s.current || busy !== null}
                  className={`w-full text-left rounded-lg px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-800 disabled:opacity-50 ${
                    s.rank === 1 && !s.current ? "bg-emerald-900/30" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm truncate">
                      <span className="text-slate-500 mr-1">#{s.rank}</span> {s.title}
                      {s.current && <span className="ml-2 text-[11px] text-slate-500">(aktuell)</span>}
                      {s.rank === 1 && !s.current && (
                        <span className="ml-2 text-[11px] text-emerald-400">Beste Wahl</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {s.servings}× · {fmt(s.kcal)} kcal · P {fmt(s.p, 1)} · C {fmt(s.c, 1)} · F {fmt(s.f, 1)}
                      {s.sugar > 0 && ` · Zucker ${fmt(s.sugar, 1)} g`}
                      {s.salt > 0 && ` · Salz ${fmt(s.salt, 2)} g`}
                      {s.deltaKcal !== 0 && ` · Δkcal ${s.deltaKcal > 0 ? "+" : ""}${fmt(s.deltaKcal)}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
