"use client";
import { useCallback, useEffect, useState } from "react";
import { shiftWeek, weekTemplate } from "@/lib/week";

const SLOT_NAMES: Record<string, string> = {
  B: "Frühstück",
  M: "Mittag",
  A: "Abend",
  S: "Snack",
};
const SLOT_ORDER = ["B", "M", "A", "S"] as const;
const SIZES = [0.5, 1, 1.5];

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
  template: "A" | "B";
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

// Fortschrittsbalken: Balken = Verbrauch relativ zum Tagesziel (voll = Ziel erreicht).
// Überschritten → Balken VOLL + rot (Text ebenfalls). soft (Protein): Überzug ist
// nicht schlimm → bleibt grün. Ziel 0 → neutrale Zeile, keine Warnung.
function MacroBar({
  label,
  val,
  target,
  unit,
  soft = false,
}: {
  label: string;
  val: number;
  target: number;
  unit: string;
  soft?: boolean;
}) {
  if (!target) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-slate-500">
          {label}
        </span>
        <div className="h-2.5 flex-1 rounded bg-slate-800/60" />
        <span className="w-40 shrink-0 text-right text-xs tabular-nums text-slate-400">
          {fmt(val, 1)} {unit} · kein Ziel
        </span>
      </div>
    );
  }
  const over = val > target + 0.001;
  const red = over && !soft;
  const width = Math.min(100, (val / target) * 100);
  const delta = Math.abs(val - target);
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="h-2.5 flex-1 overflow-hidden rounded bg-slate-800">
        <div
          className={`h-full ${red ? "bg-rose-500" : "bg-emerald-500/90"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span
        className={`w-40 shrink-0 text-right text-xs tabular-nums ${
          red ? "font-semibold text-rose-400" : "text-slate-300"
        }`}
      >
        {fmt(val, 1)} / {fmt(target, 1)} {unit}{" "}
        <span className={red ? "text-rose-400" : "text-slate-500"}>
          {over ? `(+${fmt(delta, 1)})` : `(${fmt(delta, 1)} frei)`}
        </span>
      </span>
    </div>
  );
}

export default function PlanClient() {
  const [week, setWeek] = useState("");
  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  // Swap-Dialog
  const [swapSlot, setSwapSlot] = useState<{
    slot: string;
    profileId: number;
    profileName: string;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  // Vorlage speichern
  const [tplName, setTplName] = useState("");
  const [savingTpl, setSavingTpl] = useState(false);

  const load = useCallback(async (w?: string) => {
    setLoading(true);
    const url = w ? `/api/plan?week=${encodeURIComponent(w)}&day=0` : "/api/plan?day=0";
    const r = await fetch(url, { cache: "no-store" });
    if (r.ok) {
      const j: PlanData = await r.json();
      setData(j);
      setWeek(j.week);
    } else {
      setMsg({ text: "Fehler beim Laden des Plans", kind: "err" });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const goto = (delta: number) => {
    if (!week) return;
    void load(shiftWeek(week, delta));
  };

  const generate = async () => {
    setBusy("generate");
    setMsg(null);
    const r = await fetch("/api/plan/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(week ? { week } : {}),
    });
    const j = await r.json();
    setMsg(
      r.ok
        ? { text: j.note || "Plan generiert — Template A und B", kind: "ok" }
        : { text: j.error || "Generierung fehlgeschlagen", kind: "err" }
    );
    setBusy(null);
    void load(week || undefined);
  };

  const openSwap = async (slot: string, profileId: number, profileName: string) => {
    if (!data) return;
    setSwapSlot({ slot, profileId, profileName });
    setSuggestions(null);
    setSuggestLoading(true);
    const r = await fetch(
      `/api/plan/suggest?week=${encodeURIComponent(week)}&template=${data.template}&slot=${slot}&profileId=${profileId}`,
      { cache: "no-store" }
    );
    if (r.ok) setSuggestions((await r.json()).suggestions as Suggestion[]);
    else setMsg({ text: "Vorschläge konnten nicht geladen werden", kind: "err" });
    setSuggestLoading(false);
  };

  const doSwap = async (s: Suggestion) => {
    if (!swapSlot || !data) return;
    setBusy(`swap-${s.id}`);
    const r = await fetch("/api/plan/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        week,
        template: data.template,
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
            text:
              j.note ||
              `${swapSlot.profileName} · ${SLOT_NAMES[swapSlot.slot]}: → „${s.title}“ (${s.servings}×) · alle 7 Tage + Einkaufsliste aktualisiert`,
            kind: "ok",
          }
        : { text: j.error || "Austausch fehlgeschlagen", kind: "err" }
    );
    setBusy(null);
    setSwapSlot(null);
    setSuggestions(null);
    void load(week || undefined);
  };

  const changeServings = async (profileId: number, slot: string, servings: number) => {
    if (!data) return;
    const row = data.rows.find((r) => r.profile_id === profileId && r.slot === slot);
    if (!row) return;
    await fetch("/api/plan/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        week,
        template: data.template,
        profileId,
        slot,
        recipeId: row.recipe_id,
        servings,
      }),
    });
    void load(week || undefined);
  };

  const saveTemplate = async () => {
    if (!tplName.trim()) return;
    setSavingTpl(true);
    const r = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tplName.trim(), week }),
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

  if (!data)
    return (
      <div className="flex flex-col items-center gap-2 py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <div className="text-sm text-slate-500">Lade Wochenplan…</div>
      </div>
    );

  const isOdd = weekTemplate(data.week) === "A";
  const cell = (pi: number, slot: string) =>
    data.rows.find((r) => r.profile_id === pi && r.slot === slot);

  return (
    <div className="space-y-4">
      {/* Kopf: Titel + Wochen-Navigation + Template-Badge */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Wochenplan</h1>
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-900/60 p-1">
          <button
            onClick={() => goto(-1)}
            disabled={!!busy}
            className="rounded px-2.5 py-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40"
            title="Vorwoche"
          >
            ‹
          </button>
          <span className="min-w-[92px] px-1 text-center text-sm font-medium tabular-nums">
            {week}
          </span>
          <button
            onClick={() => goto(1)}
            disabled={!!busy}
            className="rounded px-2.5 py-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40"
            title="Folgewoche"
          >
            ›
          </button>
        </div>
        <span className="rounded-lg bg-emerald-900/50 px-3 py-1.5 text-sm text-emerald-300">
          Template <b>{data.template}</b> · {isOdd ? "ungerade Woche" : "gerade Woche"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={generate}
            disabled={!!busy}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy === "generate" ? "Optimiere…" : "Neu generieren"}
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Eine Woche hat genau ein Template: ungerade Woche → <b>A</b>, gerade →{" "}
        <b>B</b>. Innerhalb des Templates ist jeder der 7 Tage identisch.
      </p>

      {msg && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            msg.kind === "ok" ? "bg-emerald-900/40 text-emerald-300" : "bg-rose-900/40 text-rose-300"
          }`}
        >
          {msg.text}
        </div>
      )}

      {!data.hasPlan && (
        <div className="rounded-xl border border-dashed border-white/15 p-8 text-center text-slate-400">
          Noch kein Plan für Woche {week} (Template {data.template}).
          <br />
          Oben auf <b>„Neu generieren“</b> tippen — dann entstehen Template A und B
          je eine Woche.
        </div>
      )}

      {data.hasPlan && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.profiles.map((p) => {
            const tot = data.totals[String(p.id)];
            return (
              <div key={p.id} className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/50">
                <div className="border-b border-white/10 bg-slate-800/60 px-4 py-2.5">
                  <h3 className="font-semibold">{p.name}</h3>
                  <div
                    className="whitespace-nowrap text-[11px] text-slate-500"
                    title="Tagesziele: kcal, Protein, Kohlenhydrate, Fett, Zucker, Salz"
                  >
                    Tagesziel: {p.kcal_target} kcal · {p.p_target} P · {p.c_target} C ·{" "}
                    {p.f_target} F · Z{" "}
                    {p.sugar_target > 0 ? p.sugar_target + " g" : "–"} · S{" "}
                    {p.salt_target > 0 ? p.salt_target + " g" : "–"}
                  </div>
                </div>

                {/* Fortschrittsbalken je Makro */}
                <div className="space-y-1.5 border-b border-white/10 px-4 py-3">
                  <MacroBar label="kcal" val={tot?.kcal || 0} target={p.kcal_target} unit="" />
                  <MacroBar label="Protein" val={tot?.p || 0} target={p.p_target} unit="g" soft />
                  <MacroBar label="KH" val={tot?.c || 0} target={p.c_target} unit="g" />
                  <MacroBar label="Fett" val={tot?.f || 0} target={p.f_target} unit="g" />
                  <MacroBar label="Zucker" val={tot?.sugar || 0} target={p.sugar_target} unit="g" />
                  <MacroBar label="Salz" val={tot?.salt || 0} target={p.salt_target} unit="g" />
                </div>

                {/* Slots */}
                <div className="divide-y divide-white/5">
                  {SLOT_ORDER.map((slot) => {
                    const r = cell(p.id, slot);
                    return (
                      <div key={slot} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-slate-500">
                          {SLOT_NAMES[slot]}
                        </span>
                        {r ? (
                          <>
                            <button
                              onClick={() => openSwap(slot, p.id, p.name)}
                              className="min-w-0 flex-1 truncate text-left text-sm hover:text-emerald-400"
                              title="Klicken zum Austauschen"
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
                                      ? "bg-emerald-600 font-semibold text-white"
                                      : "bg-slate-800 text-slate-400 hover:text-white"
                                  }`}
                                >
                                  {s}×
                                </button>
                              ))}
                            </div>
                            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-500">
                              {fmt(r.kcal)} kcal
                            </span>
                          </>
                        ) : (
                          <span className="flex-1 text-xs text-slate-600">— leer —</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="px-4 py-2 text-[11px] text-slate-600">
                  {tot?.meals || 0} Mahlzeiten pro Tag · an allen 7 Wochentagen identisch
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.hasPlan && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-slate-900/50 p-4">
          <span className="text-sm font-medium">Vorlage speichern:</span>
          <input
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
            placeholder={`z. B. „Mein ${data.template}-Tag“`}
            className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-600"
          />
          <button
            onClick={saveTemplate}
            disabled={savingTpl || !tplName.trim()}
            className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-600 disabled:opacity-40"
          >
            {savingTpl ? "Speichert…" : "Als Vorlage speichern"}
          </button>
        </div>
      )}

      {/* Swap-Dialog */}
      {swapSlot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSwapSlot(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-white/10 bg-slate-900 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">
                {SLOT_NAMES[swapSlot.slot]} austauschen · {swapSlot.profileName}
              </h3>
              <button
                onClick={() => {
                  setSwapSlot(null);
                  setSuggestions(null);
                }}
                className="text-slate-500 hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Sortiert nach bestem Ersatz für genau diese Position (KH/Fett hart,
              Protein am Ziel, Zucker/Salz best-effort). Der Wechsel gilt für alle
              7 Tage; die Einkaufsliste aktualisiert sich automatisch.
            </p>
            {suggestLoading && (
              <div className="animate-pulse text-sm text-slate-500">Lade Vorschläge…</div>
            )}
            {suggestions && suggestions.length === 0 && (
              <div className="text-sm text-slate-500">Keine Alternativen für diesen Slot.</div>
            )}
            <div className="max-h-[50vh] space-y-1 overflow-y-auto">
              {suggestions?.map((s) => (
                <button
                  key={s.id}
                  onClick={() => doSwap(s)}
                  disabled={s.current || busy !== null}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-800 disabled:opacity-50 ${
                    s.rank === 1 && !s.current ? "bg-emerald-900/30" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm">
                      <span className="mr-1 text-slate-500">#{s.rank}</span> {s.title}
                      {s.current && <span className="ml-2 text-[11px] text-slate-500">(aktuell)</span>}
                      {s.rank === 1 && !s.current && (
                        <span className="ml-2 text-[11px] text-emerald-400">Beste Wahl</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {s.servings}× · {fmt(s.kcal)} kcal · P {fmt(s.p, 1)} · C {fmt(s.c, 1)} · F {fmt(s.f, 1)}
                      {s.sugar > 0 && ` · Zucker ${fmt(s.sugar, 1)} g`}
                      {s.salt > 0 && ` · Salz ${fmt(s.salt, 2)} g`}
                      {s.deltaKcal !== 0 &&
                        ` · Δkcal ${s.deltaKcal > 0 ? "+" : ""}${fmt(s.deltaKcal)}`}
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
