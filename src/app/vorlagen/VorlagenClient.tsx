"use client";
import { useCallback, useEffect, useState } from "react";

const SLOT_NAMES: Record<string, string> = {
  B: "Frühstück",
  M: "Mittag",
  A: "Abend",
  S: "Snack",
};
const SLOT_ORDER = ["B", "M", "A", "S"];

interface SlotView {
  recipe_id: number;
  title?: string;
  servings: number;
}
type SlotsView = Record<string, Record<string, SlotView> | null>;
interface Vorlage {
  id: number;
  name: string;
  created_at: string;
  slots: SlotsView;
}

export default function VorlagenClient() {
  const [items, setItems] = useState<Vorlage[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [applyTpl, setApplyTpl] = useState<"A" | "B">("A");
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/templates", { cache: "no-store" });
    if (r.ok) setItems(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = async (v: Vorlage) => {
    if (
      !confirm(
        `Vorlage „${v.name}“ als Template ${applyTpl} einplanen? Der aktuelle Stand von ${applyTpl} wird vorher im Verlauf gesichert.`
      )
    )
      return;
    setBusy(v.id);
    const r = await fetch("/api/templates/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: v.id, template: applyTpl }),
    });
    const j = await r.json();
    setMsg(
      r.ok
        ? { text: j.note || "Vorlage angewendet", kind: "ok" }
        : { text: j.error || "Anwenden fehlgeschlagen", kind: "err" }
    );
    setBusy(null);
  };

  const rename = async (v: Vorlage) => {
    if (!editName.trim()) return;
    setBusy(v.id);
    const r = await fetch(`/api/templates/${v.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    const j = await r.json();
    setMsg(
      r.ok
        ? { text: `Umbenannt in „${j.name}“`, kind: "ok" }
        : { text: j.error || "Umbenennen fehlgeschlagen", kind: "err" }
    );
    setBusy(null);
    setEditing(null);
    void load();
  };

  const del = async (v: Vorlage) => {
    if (!confirm(`Vorlage „${v.name}“ wirklich löschen?`)) return;
    setBusy(v.id);
    const r = await fetch(`/api/templates/${v.id}`, { method: "DELETE" });
    const j = await r.json();
    setMsg(
      r.ok
        ? { text: `„${v.name}“ gelöscht`, kind: "ok" }
        : { text: j.error || "Löschen fehlgeschlagen", kind: "err" }
    );
    setBusy(null);
    void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Vorlagen</h1>
        <span className="text-sm text-slate-400">
          Eigene Tages-Pläne als Vorlage anlegen und bei Lust und Laune einplanen.
        </span>
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

      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/50 p-4">
        <span className="text-sm">Neue Vorlage anlegen:</span>
        <span className="text-sm text-slate-400">
          im <a href="/plan" className="text-emerald-400 underline">Wochenplan</a> einplanen →
          <span className="ml-2 inline-block rounded-lg bg-slate-800 px-3 py-1.5">„… als Vorlage speichern“</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-400">Vorlagen einplanen als Template:</span>
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {(["A", "B"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setApplyTpl(t)}
              className={`px-4 py-1.5 text-sm font-medium ${
                applyTpl === t
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-800/50 text-slate-400 hover:bg-slate-800"
              }`}
              title={`Als Template ${t} einplanen`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-sm text-slate-500 animate-pulse">Lade Vorlagen…</div>}

      {!loading && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/15 p-8 text-center text-slate-400">
          Noch keine Vorlagen. Im Wochenplan einen Tag generieren und dort als
          Vorlage speichern — dann findest du ihn hier und kannst ihn jederzeit
          wieder einplanen.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((v) => (
          <div key={v.id} className="rounded-xl border border-white/10 bg-slate-900/50 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              {editing === v.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 rounded-lg bg-slate-800 border border-white/10 px-3 py-1.5 text-sm"
                    autoFocus
                  />
                  <button
                    onClick={() => rename(v)}
                    disabled={busy === v.id}
                    className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
                  >
                    Speichern
                  </button>
                  <button onClick={() => setEditing(null)} className="text-xs px-2 py-1 text-slate-500">
                    Abbrechen
                  </button>
                </div>
              ) : (
                <>
                  <h3 className="font-semibold">{v.name}</h3>
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setEditing(v.id); setEditName(v.name); }}
                      className="text-xs px-2 py-1 rounded hover:bg-slate-800 text-slate-400"
                    >
                      Umbenennen
                    </button>
                    <button
                      onClick={() => del(v)}
                      disabled={busy === v.id}
                      className="text-xs px-2 py-1 rounded hover:bg-rose-900/40 text-rose-400 disabled:opacity-50"
                    >
                      Löschen
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="space-y-1">
              {SLOT_ORDER.map((s) => {
                const e = v.slots[s];
                return (
                  <div key={s} className="flex items-center gap-2 text-sm">
                    <span className="w-24 text-slate-500">{SLOT_NAMES[s]}</span>
                    {e && Object.keys(e).length ? (
                      <span className="flex-1 truncate">
                        {Object.values(e)
                          .map((x) => `${x.title ?? "(Rezept fehlt)"} (${x.servings}×)`)
                          .join("  ·  ")}
                      </span>
                    ) : (
                      <span className="flex-1 text-slate-600">— leer —</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
              <button
                onClick={() => apply(v)}
                disabled={busy === v.id}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
              >
                {busy === v.id ? "Plane ein…" : `Als Template ${applyTpl} einplanen`}
              </button>
              <span className="text-[11px] text-slate-600">
                angelegt {new Date(v.created_at).toLocaleDateString("de-DE")}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
