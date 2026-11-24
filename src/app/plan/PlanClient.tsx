"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { sizesFor } from "@/lib/servings";

const SLOT_NAMES: Record<string, string> = {
  B: "Frühstück",
  M: "Mittag",
  A: "Abend",
  S: "Snack",
};
const SLOT_ORDER = ["B", "M", "A", "S"] as const;

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
  servings_allowed?: number[]; // leer = globale Vorgabe
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
  template: "A" | "B";
  day: number;
  rows: Row[];
  totals: Record<string, Totals>;
  profiles: Profile[];
  hasPlan: boolean;
}
interface Snapshot {
  id: number;
  label: string;
  template: string;
  created_at: string;
  meals: Array<{ profile_id: number; slot: string; servings: number; title: string }>;
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
// nicht schlimm → bleibt grün. band (kcal): Überzug bis +band ist erlaubt (grün).
// Ziel 0 → neutrale Zeile, keine Warnung.
function MacroBar({
  label,
  val,
  target,
  unit,
  soft = false,
  band = 0,
}: {
  label: string;
  val: number;
  target: number;
  unit: string;
  soft?: boolean;
  band?: number;
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
  const over = val > target + band + 0.001;
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
  const [active, setActive] = useState<"A" | "B">("A");
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

  const load = useCallback(async (t?: "A" | "B") => {
    setLoading(true);
    // Ohne Parameter: Server liefert das aktive Template (settings.active_template)
    const url = t ? `/api/plan?template=${t}&day=0` : "/api/plan?day=0";
    const r = await fetch(url, { cache: "no-store" });
    if (r.ok) {
      const j: PlanData = await r.json();
      setData(j);
      setActive(j.template);
    } else {
      setMsg({ text: "Fehler beim Laden des Plans", kind: "err" });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const switchTemplate = async (t: "A" | "B") => {
    if (t === active) return;
    setBusy(`tpl-${t}`);
    const r = await fetch("/api/active-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: t }),
    });
    setBusy(null);
    if (r.ok) {
      setActive(t);
      setMsg({ text: `Template ${t} ist jetzt aktiv — Plan und Einkaufsliste zeigen es.`, kind: "ok" });
      await load(t);
    } else {
      setMsg({ text: "Template-Umschaltung fehlgeschlagen", kind: "err" });
    }
  };

  const generate = async () => {
    if (
      data?.hasPlan &&
      !confirm(
        `Template ${active} neu generieren?\n\nDas andere Template bleibt unverändert. Der aktuelle Stand von ${active} wird im Verlauf gesichert und kann wiederhergestellt werden.`
      )
    )
      return;
    setBusy("generate");
    setMsg(null);
    const r = await fetch("/api/plan/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: active }),
    });
    const j = await r.json();
    setMsg(
      r.ok
        ? { text: j.note || `Template ${active} generiert`, kind: "ok" }
        : { text: j.error || "Generierung fehlgeschlagen", kind: "err" }
    );
    setBusy(null);
    void load(active);
    if (showHistory) void loadHistory();
  };

  // ── Verlauf ──
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<{ items: Snapshot[]; profiles: Array<{ id: number; name: string }> } | null>(null);
  const loadHistory = useCallback(async () => {
    const r = await fetch("/api/plan/history", { cache: "no-store" });
    if (r.ok) setHistory(await r.json());
  }, []);
  const restore = async (snap: Snapshot, t: "A" | "B") => {
    if (!confirm(`„${snap.label}“ als Template ${t} wiederherstellen?\n\nDer aktuelle Stand von ${t} wird vorher gesichert.`)) return;
    setBusy(`restore-${snap.id}`);
    const r = await fetch("/api/plan/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: snap.id, template: t }),
    });
    const j = await r.json();
    setMsg(r.ok ? { text: j.note, kind: "ok" } : { text: j.error || "Wiederherstellen fehlgeschlagen", kind: "err" });
    setBusy(null);
    void load(active);
    void loadHistory();
  };
  const delSnap = async (snap: Snapshot) => {
    if (!confirm(`„${snap.label}“ aus dem Verlauf löschen?`)) return;
    await fetch("/api/plan/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: snap.id }),
    });
    void loadHistory();
  };

  const openSwap = async (slot: string, profileId: number, profileName: string) => {
    if (!data) return;
    setSwapSlot({ slot, profileId, profileName });
    setSuggestions(null);
    setSuggestLoading(true);
    const r = await fetch(
      `/api/plan/suggest?template=${data.template}&slot=${slot}&profileId=${profileId}`,
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
    void load();
  };

  const changeServings = async (profileId: number, slot: string, servings: number) => {
    if (!data) return;
    const row = data.rows.find((r) => r.profile_id === profileId && r.slot === slot);
    if (!row) return;
    await fetch("/api/plan/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template: data.template,
        profileId,
        slot,
        recipeId: row.recipe_id,
        servings,
      }),
    });
    void load();
  };

  const saveTemplate = async () => {
    if (!data) return;
    if (!tplName.trim()) return;
    setSavingTpl(true);
    const r = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tplName.trim(), template: data.template }),
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

  const cell = (pi: number, slot: string) =>
    data.rows.find((r) => r.profile_id === pi && r.slot === slot);

  return (
    <div className="space-y-4">
      {/* Kopf: Titel + Template-Umschalter + Aktionen */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Wochenplan</h1>
        <div
          className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-900/60 p-1"
          role="group"
          aria-label="Aktives Template"
        >
          {(["A", "B"] as const).map((t) => (
            <button
              key={t}
              onClick={() => void switchTemplate(t)}
              disabled={!!busy}
              className={`rounded px-3.5 py-1 text-sm font-semibold transition ${
                active === t
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
              title={`Template ${t} aktivieren (Plan + Einkaufsliste)`}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="rounded-lg bg-emerald-900/50 px-3 py-1.5 text-sm text-emerald-300">
          Aktiv: <b>{active}</b>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={generate}
            disabled={!!busy}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy === "generate" ? "Optimiere…" : `${active} neu generieren`}
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Zwei dauerhafte Templates, frei wählbar: <b>A</b> oder <b>B</b> — unabhängig von
        der Kalenderwoche. Innerhalb des Templates ist jeder der 7 Tage identisch. Die{" "}
        <b>Einkaufsliste</b> zeigt nur das ausgewählte Template. Vor jedem Überschreiben
        wird der alte Stand im <b>Verlauf</b> gesichert.
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
          Template {data.template} ist noch leer.
          <br />
          Oben auf <b>„{data.template} neu generieren“</b> tippen, eine Vorlage einplanen
          oder unten einen früheren Stand aus dem Verlauf wiederherstellen.
        </div>
      )}

      {data.hasPlan && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.profiles.map((p) => {
            const tot = data.totals[String(p.id)];
            return (
              <div key={p.id} className="@container overflow-hidden rounded-xl border border-white/10 bg-slate-900/50">
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
                  <MacroBar label="kcal" val={tot?.kcal || 0} target={p.kcal_target} unit="" band={50} />
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
                      // Schmale Karte (Handy, 2-spaltig im Querformat): Name bekommt
                      // eine eigene, umbrechende Zeile; Bedienelemente darunter.
                      // Breite Karte (@xl): alles in einer Zeile wie bisher.
                      <div key={slot} className="px-4 py-3 @xl:flex @xl:items-center @xl:gap-3 @xl:py-2.5">
                        <div className="flex items-baseline justify-between @xl:contents">
                          <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-500 @xl:w-20">
                            {SLOT_NAMES[slot]}
                          </span>
                          {r && (
                            <span className="whitespace-nowrap text-xs tabular-nums text-slate-400 @xl:hidden">
                              {fmt(r.kcal, 1)} kcal
                            </span>
                          )}
                        </div>
                        {r ? (
                          <>
                            <button
                              onClick={() => openSwap(slot, p.id, p.name)}
                              className="mt-0.5 block w-full text-left text-base font-medium leading-snug hover:text-emerald-400 @xl:mt-0 @xl:w-auto @xl:min-w-0 @xl:flex-1 @xl:text-sm @xl:font-normal"
                              title="Antippen zum Austauschen"
                            >
                              {r.title}
                            </button>
                            <div className="mt-2 flex items-center gap-1 @xl:mt-0 @xl:contents">
                              <div className="flex gap-1 @xl:gap-0.5">
                                {[...new Set([...sizesFor(r.servings_allowed), r.servings])].sort((a, b) => a - b).map((s) => (
                                  <button
                                    key={s}
                                    onClick={() => changeServings(p.id, slot, s)}
                                    className={`rounded px-2.5 py-1 text-xs transition @xl:px-1.5 @xl:py-0.5 ${
                                      r.servings === s
                                        ? "bg-emerald-600 font-semibold text-white"
                                        : "bg-slate-800 text-slate-400 hover:text-white"
                                    }`}
                                  >
                                    {String(s).replace(".", ",")}×
                                  </button>
                                ))}
                              </div>
                              <span className="hidden w-20 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-slate-400 @xl:inline">
                                {fmt(r.kcal, 1)} kcal
                              </span>
                              <span className="flex-1 @xl:hidden" />
                              <Link
                                href={`/cook/${r.recipe_id}`}
                                title="Kochmodus (Portionen frei wählbar)"
                                className="shrink-0 rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:text-emerald-400 @xl:px-1.5 @xl:py-0.5 @xl:text-slate-400"
                              >
                                Kochen
                              </Link>
                            </div>
                          </>
                        ) : (
                          <span className="mt-0.5 block text-xs text-slate-600 @xl:mt-0 @xl:flex-1">— leer —</span>
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

      {/* Verlauf: frühere Stände von A/B */}
      <div className="rounded-xl border border-white/10 bg-slate-900/50">
        <button
          onClick={() => {
            const next = !showHistory;
            setShowHistory(next);
            if (next) void loadHistory();
          }}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
        >
          <span>Verlauf · frühere Stände wiederherstellen</span>
          <span className="text-slate-500">{showHistory ? "▲" : "▼"}</span>
        </button>
        {showHistory && (
          <div className="space-y-2 border-t border-white/10 p-4">
            {!history && <div className="text-sm text-slate-500">Lade…</div>}
            {history && history.items.length === 0 && (
              <div className="text-sm text-slate-500">
                Noch keine gesicherten Stände. Vor jedem Neu-Generieren, Vorlage-Einplanen
                oder Wiederherstellen wird der alte Stand hier abgelegt.
              </div>
            )}
            {history?.items.map((snap) => (
              <div key={snap.id} className="rounded-lg border border-white/5 bg-slate-800/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{snap.label}</span>
                  <span className="text-xs text-slate-500">{snap.created_at}</span>
                  <span className="flex-1" />
                  {(["A", "B"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => void restore(snap, t)}
                      disabled={!!busy}
                      className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      Als {t} wiederherstellen
                    </button>
                  ))}
                  <button
                    onClick={() => void delSnap(snap)}
                    className="rounded px-2 py-1 text-xs text-slate-500 hover:text-rose-400"
                    title="Aus dem Verlauf löschen"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 grid gap-x-4 gap-y-0.5 text-xs text-slate-400 sm:grid-cols-2">
                  {history.profiles.map((p) => (
                    <div key={p.id}>
                      <span className="font-semibold text-slate-300">{p.name}:</span>{" "}
                      {SLOT_ORDER.map((sl) => snap.meals.find((m) => m.profile_id === p.id && m.slot === sl))
                        .filter(Boolean)
                        .map((m) => `${m!.title} (${m!.servings}×)`)
                        .join(" · ") || "—"}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
