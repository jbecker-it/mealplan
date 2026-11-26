"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BASE_UNITS } from "@/lib/units";

interface Ing {
  id: number;
  name: string;
  category: string;
  unit_default: string;
  per_el: number | null;
  recipe_count: number;
  aliases: string[];
}

const BASE_CATEGORIES = ["Obst & Gemüse", "Fleisch, Wurst & Fisch", "Käse, Eier & Molkerei", "Tiefkühlkost", "Backwaren, Cerealien & Aufstriche", "Kochen & Backen", "Öle, Soßen & Gewürze", "Fertiggerichte & Konserven", "Süßes & Salziges", "Kaffee, Tee & Kakao", "Getränke & Genussmittel", "Sonstige"];
const UNITS: readonly string[] = BASE_UNITS;
const NEW_CAT = "__new__";

interface Suggestion {
  id: number;
  name: string;
  current: string;
  suggested: string | null;
  sub: string | null;
  confidence: number;
  alternatives: string[];
  products: string[];
  raw: string[];
  error?: string;
}

export default function IngredientsClient() {
  const [ings, setIngs] = useState<Ing[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  // Neuanlage
  const [nName, setNName] = useState("");
  const [nCat, setNCat] = useState("Kochen & Backen");
  const [nUnit, setNUnit] = useState("g");
  const [nPerEl, setNPerEl] = useState("");

  // Bearbeiten / Alias pro Zeile
  const [editId, setEditId] = useState<number | null>(null);
  const [eName, setEName] = useState("");
  const [eCat, setECat] = useState("Kochen & Backen");
  const [eUnit, setEUnit] = useState("g");
  const [ePerEl, setEPerEl] = useState("");
  const [aliasFor, setAliasFor] = useState<number | null>(null);
  const [aliasText, setAliasText] = useState("");

  // REWE-Sortierung (nur Vorschläge, Übernahme erst nach Bestätigung)
  const [reweOk, setReweOk] = useState(false);
  const [reweDepts, setReweDepts] = useState<string[]>([]);
  const [rsOpen, setRsOpen] = useState(false);
  const [rsScope, setRsScope] = useState<"sonstige" | "all">("sonstige");
  const [rsBusy, setRsBusy] = useState(false);
  const [rsProgress, setRsProgress] = useState<{ done: number; total: number } | null>(null);
  const [rsList, setRsList] = useState<Suggestion[]>([]);
  const [rsPick, setRsPick] = useState<Record<number, string>>({}); // id → Zielkategorie
  const [rsOn, setRsOn] = useState<Record<number, boolean>>({});
  const [rsError, setRsError] = useState<string | null>(null);

  const flash = (msg: string, ok = true) => {
    setStatus({ msg, ok });
    window.setTimeout(() => setStatus(null), 4000);
  };

  const load = useCallback(() => {
    fetch("/api/ingredients").then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) setIngs(d);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/rewe/status").then((r) => r.json()).then((d) => {
      setReweOk(Boolean(d?.bridge?.available && d?.market));
    }).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return ings;
    return ings.filter(
      (i) =>
        i.name.toLowerCase().includes(s) ||
        i.aliases.some((a) => a.toLowerCase().includes(s))
    );
  }, [ings, q]);

  // Kategorien: Basis-Kategorien + alle bereits vorhandenen (frei anlegbar)
  const catOptions = useMemo(() => {
    const order = reweDepts.length ? [...reweDepts, ...BASE_CATEGORIES.filter((c) => !reweDepts.includes(c))] : BASE_CATEGORIES;
    const set = new Set<string>(order);
    for (const i of ings) if (i.category) set.add(i.category);
    const base = order.filter((c) => set.has(c));
    const rest = [...set].filter((c) => !order.includes(c)).sort((a, b) => a.localeCompare(b, "de"));
    return [...base, ...rest];
  }, [ings, reweDepts]);

  const grouped = useMemo(() => {
    const map = new Map<string, Ing[]>();
    for (const i of filtered) {
      const key = i.category || "Sonstige";
      const list = map.get(key) ?? [];
      list.push(i);
      map.set(key, list);
    }
    const keys = [...map.keys()].sort(
      (a, b) =>
        catOptions.indexOf(a) - catOptions.indexOf(b) || a.localeCompare(b, "de")
    );
    return keys.map((k) => [k, map.get(k)!] as const);
  }, [filtered, catOptions]);

  async function addIng() {
    if (!nName.trim()) return;
    const r = await fetch("/api/ingredients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nName, category: nCat, unit: nUnit, per_el: nPerEl || null }),
    });
    const d = await r.json();
    if (r.ok) {
      flash(`„${nName.trim()}“ angelegt`);
      setNName("");
      setNPerEl("");
      load();
    } else flash(d.error ?? "Fehler", false);
  }

  function startEdit(i: Ing) {
    setEditId(i.id);
    setEName(i.name);
    setECat(i.category || "Sonstige");
    setEUnit(i.unit_default || "g");
    setEPerEl(i.per_el != null ? String(i.per_el).replace(".", ",") : "");
    setAliasFor(null);
  }

  async function saveEdit() {
    if (editId === null) return;
    const r = await fetch("/api/ingredients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editId, name: eName, category: eCat, unit: eUnit, per_el: ePerEl || null }),
    });
    const d = await r.json();
    if (r.ok) {
      flash("Gespeichert");
      setEditId(null);
      load();
    } else flash(d.error ?? "Fehler", false);
  }

  // Kategorie direkt in der Liste setzen (ohne Bearbeiten-Modus)
  async function setCategory(i: Ing, value: string) {
    let cat = value;
    if (value === NEW_CAT) {
      const n = window.prompt("Neue Kategorie:", "")?.trim();
      if (!n) return;
      cat = n;
    }
    if (cat === (i.category || "Sonstige")) return;
    const prev = i.category;
    setIngs((xs) => xs.map((x) => (x.id === i.id ? { ...x, category: cat } : x)));
    const r = await fetch("/api/ingredients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: i.id, category: cat }),
    }).catch(() => null);
    if (r?.ok) flash(`„${i.name}“ → ${cat}`);
    else {
      setIngs((xs) => xs.map((x) => (x.id === i.id ? { ...x, category: prev } : x)));
      flash("Kategorie konnte nicht gespeichert werden", false);
    }
  }

  async function runReweSort() {
    const targets = ings.filter((i) =>
      rsScope === "all" ? true : !i.category || i.category === "Sonstige"
    );
    setRsError(null);
    setRsList([]);
    setRsPick({});
    setRsOn({});
    if (!targets.length) {
      setRsError("Keine Zutaten im gewählten Bereich.");
      return;
    }
    setRsBusy(true);
    setRsProgress({ done: 0, total: targets.length });
    try {
      const dr = await fetch("/api/rewe/categorize");
      const dd = await dr.json();
      if (!dr.ok) throw new Error(dd.error ?? "REWE-Kategorien nicht abrufbar");
      if (Array.isArray(dd.departments)) setReweDepts(dd.departments);
      const CHUNK = 10;
      for (let k = 0; k < targets.length; k += CHUNK) {
        const ids = targets.slice(k, k + CHUNK).map((i) => i.id);
        const r = await fetch("/api/rewe/categorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Fehler bei der REWE-Abfrage");
        const sugg = d.suggestions as Suggestion[];
        setRsList((xs) => [...xs, ...sugg]);
        setRsPick((m) => {
          const n = { ...m };
          for (const s of sugg) if (s.suggested) n[s.id] = s.suggested;
          return n;
        });
        setRsOn((m) => {
          const n = { ...m };
          for (const s of sugg)
            n[s.id] = Boolean(s.suggested && s.suggested !== s.current && s.confidence >= 0.5);
          return n;
        });
        setRsProgress({ done: Math.min(k + CHUNK, targets.length), total: targets.length });
      }
    } catch (e) {
      setRsError(e instanceof Error ? e.message : String(e));
    } finally {
      setRsBusy(false);
    }
  }

  async function applyReweSort() {
    const updates = rsList
      .filter((s) => rsOn[s.id] && rsPick[s.id] && rsPick[s.id] !== s.current)
      .map((s) => ({ id: s.id, category: rsPick[s.id] }));
    if (!updates.length) return;
    const r = await fetch("/api/ingredients/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
    const d = await r.json();
    if (r.ok) {
      flash(`${d.changed} Zutat(en) neu kategorisiert`);
      setRsList([]);
      setRsOpen(false);
      setRsProgress(null);
      load();
    } else flash(d.error ?? "Fehler", false);
  }

  const rsChanges = rsList.filter((s) => s.suggested && s.suggested !== s.current);
  const rsSame = rsList.filter((s) => s.suggested && s.suggested === s.current).length;
  const rsNone = rsList.filter((s) => !s.suggested);
  const rsSelected = rsChanges.filter((s) => rsOn[s.id] && rsPick[s.id] !== s.current).length;

  async function delIng(i: Ing) {
    if (i.recipe_count > 0) {
      flash(`„${i.name}“ ist in ${i.recipe_count} Rezept(en) verwendet`, false);
      return;
    }
    if (!window.confirm(`Zutat „${i.name}“ wirklich löschen?`)) return;
    const r = await fetch("/api/ingredients", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: i.id }),
    });
    const d = await r.json();
    if (r.ok) {
      flash(`„${i.name}“ gelöscht`);
      load();
    } else flash(d.error ?? "Fehler", false);
  }

  async function addAlias(ingId: number) {
    const n = aliasText.trim();
    if (!n) return;
    const r = await fetch("/api/aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredient_id: ingId, name: n }),
    });
    const d = await r.json();
    if (r.ok) {
      flash(`Alias „${n}“ hinzugefügt`);
      setAliasText("");
      setAliasFor(null);
      load();
    } else flash(d.error ?? "Fehler", false);
  }

  async function delAlias(name: string) {
    const r = await fetch("/api/aliases", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      flash(`Alias „${name}“ entfernt`);
      load();
    }
  }

  const selCls = "rounded-lg border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">Zutaten</h1>
        <span className="text-sm text-muted">{ings.length} Einträge</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {reweOk && (
            <button
              onClick={() => setRsOpen((o) => !o)}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-foreground"
              title="Kategorien aus den Abteilungen deines REWE-Markts vorschlagen lassen"
            >
              Mit REWE sortieren
            </button>
          )}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Suche (Name oder Alias)…"
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
      </div>

      {status && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            status.ok ? "border-line bg-card text-foreground" : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          {status.msg}
        </div>
      )}

      {rsOpen && (
        <div className="mb-6 rounded-xl border border-accent/40 bg-card/50 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Kategorien aus REWE vorschlagen</p>
            <button onClick={() => setRsOpen(false)} className="ml-auto text-xs text-muted hover:text-foreground">
              Schließen
            </button>
          </div>
          <p className="mb-2 text-xs text-muted">
            Sucht jede Zutat in deinem REWE-Markt und ordnet sie der Abteilung zu, in der
            die besten Treffer liegen. Es wird nichts automatisch geändert — du wählst aus,
            was übernommen wird.
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              value={rsScope}
              onChange={(e) => setRsScope(e.target.value as "sonstige" | "all")}
              disabled={rsBusy}
              className={selCls}
            >
              <option value="sonstige">Nur „Sonstige“ / ohne Kategorie</option>
              <option value="all">Alle Zutaten</option>
            </select>
            <button
              onClick={runReweSort}
              disabled={rsBusy}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50"
            >
              {rsBusy ? "Frage REWE ab…" : "Vorschläge holen"}
            </button>
            {rsProgress && (
              <span className="text-xs text-muted">
                {rsProgress.done} / {rsProgress.total}
              </span>
            )}
          </div>
          {rsError && (
            <p className="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{rsError}</p>
          )}
          {rsList.length > 0 && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>{rsChanges.length} Änderungsvorschläge</span>
                {rsSame > 0 && <span>· {rsSame} bereits passend</span>}
                {rsNone.length > 0 && <span>· {rsNone.length} ohne Treffer</span>}
                <button
                  onClick={() => setRsOn(Object.fromEntries(rsChanges.map((s) => [s.id, true])))}
                  className="ml-auto underline hover:text-foreground"
                >
                  alle
                </button>
                <button onClick={() => setRsOn({})} className="underline hover:text-foreground">
                  keine
                </button>
              </div>
              <div className="mb-3 divide-y divide-line rounded-xl border border-line bg-card/40">
                {rsChanges.map((s) => (
                  <label key={s.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(rsOn[s.id])}
                      onChange={(e) => setRsOn((m) => ({ ...m, [s.id]: e.target.checked }))}
                    />
                    <div className="min-w-40 flex-1">
                      <span className="font-medium">{s.name}</span>
                      <span className="ml-2 text-xs text-muted">{s.current} →</span>
                      {s.products.length > 0 && (
                        <div className="truncate text-xs text-muted" title={s.products.join(" · ")}>
                          {s.sub ? `${s.sub} · ` : ""}z. B. {s.products[0]}
                        </div>
                      )}
                    </div>
                    <select
                      value={rsPick[s.id] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRsPick((m) => ({ ...m, [s.id]: v }));
                        setRsOn((m) => ({ ...m, [s.id]: true }));
                      }}
                      className={selCls}
                    >
                      {[...new Set([s.suggested!, ...s.alternatives, ...catOptions])].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        s.confidence >= 0.75 ? "bg-accent/15 text-accent" : s.confidence >= 0.5 ? "bg-card text-muted" : "bg-red-500/10 text-red-300"
                      }`}
                      title="Anteil der REWE-Treffer in dieser Abteilung"
                    >
                      {Math.round(s.confidence * 100)} %
                    </span>
                  </label>
                ))}
              </div>
              {rsNone.length > 0 && (
                <p className="mb-3 text-xs text-muted" title={rsNone.map((s) => `${s.name}${s.error ? ": " + s.error : s.raw.length ? ": " + s.raw.join(", ") : ""}`).join("\n")}>
                  Ohne Vorschlag: {rsNone.map((s) => s.name).join(", ")}
                </p>
              )}
              <button
                onClick={applyReweSort}
                disabled={rsBusy || rsSelected === 0}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50"
              >
                {rsSelected} übernehmen
              </button>
            </>
          )}
        </div>
      )}

      <div className="mb-6 rounded-xl border border-line bg-card/50 p-3">
        <p className="mb-2 text-sm font-semibold">Neue Zutat</p>
        <p className="mb-2 text-xs text-muted">
          Einheit = wie die Zutat auf der Einkaufsliste summiert wird. „1 EL =“ rechnet
          EL/TL aus Rezepten um (1 TL = ⅓ EL). Ohne Angabe: ml-Zutaten 15 ml/EL,
          sonst steht „x EL“ separat auf der Liste.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={nName}
            onChange={(e) => setNName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addIng()}
            placeholder="z. B. Kokosmilch"
            className="min-w-40 flex-1 rounded-lg border border-line bg-card px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <input
            value={nCat}
            onChange={(e) => setNCat(e.target.value)}
            list="cat-datalist"
            placeholder="Kategorie (frei wählen, z. B. Kochen & Backen)"
            className={selCls + " min-w-44"}
          />
          <datalist id="cat-datalist">
            {catOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <select value={nUnit} onChange={(e) => setNUnit(e.target.value)} className={selCls} title="Einheit auf der Einkaufsliste">
            {UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          {(nUnit === "g" || nUnit === "ml") && (
            <PerElInput value={nPerEl} onChange={setNPerEl} unit={nUnit} />
          )}
          <button
            onClick={addIng}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-background hover:opacity-90"
          >
            Anlegen
          </button>
        </div>
      </div>

      {grouped.map(([cat, items]) => (
        <section key={cat} className="mb-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
            {cat} <span className="font-normal">({items.length})</span>
          </h2>
          <div className="divide-y divide-line rounded-xl border border-line bg-card/40">
            {items.map((i) =>
              editId === i.id ? (
                <div key={i.id} className="flex flex-wrap items-center gap-2 p-3">
                  <input
                    value={eName}
                    onChange={(e) => setEName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                    className="min-w-32 flex-1 rounded-lg border border-line bg-card px-3 py-1.5 text-sm outline-none focus:border-accent"
                  />
                  <input
                    value={eCat}
                    onChange={(e) => setECat(e.target.value)}
                    list="cat-datalist-edit"
                    placeholder="Kategorie"
                    className={selCls + " min-w-40"}
                  />
                  <datalist id="cat-datalist-edit">
                    {catOptions.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <select value={eUnit} onChange={(e) => setEUnit(e.target.value)} className={selCls} title="Einheit auf der Einkaufsliste">
                    {[...new Set([...UNITS, eUnit])].map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                  {(eUnit === "g" || eUnit === "ml") && (
                    <PerElInput value={ePerEl} onChange={setEPerEl} unit={eUnit} />
                  )}
                  <button onClick={saveEdit} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-background">
                    Speichern
                  </button>
                  <button onClick={() => setEditId(null)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted">
                    Abbrechen
                  </button>
                </div>
              ) : (
                <div key={i.id} className="flex flex-wrap items-center gap-2 p-3">
                  <div className="min-w-40 flex-1">
                    <span className="text-sm font-medium">{i.name}</span>
                    <span className="ml-2 text-xs text-muted">{i.unit_default}</span>
                    {i.per_el != null && (
                      <span className="ml-2 text-xs text-muted" title="Umrechnung für EL/TL in Rezepten">
                        1 EL = {String(i.per_el).replace(".", ",")} {i.unit_default}
                      </span>
                    )}
                    {i.recipe_count > 0 && (
                      <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                        in {i.recipe_count} Rezept{i.recipe_count === 1 ? "" : "en"}
                      </span>
                    )}
                    {i.aliases.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {i.aliases.map((a) => (
                          <span key={a} className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 text-xs text-muted">
                            {a}
                            <button
                              onClick={() => delAlias(a)}
                              title={`Alias „${a}“ entfernen`}
                              className="text-muted hover:text-red-400"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex w-full items-center gap-1 sm:w-auto">
                    <select
                      value={i.category || "Sonstige"}
                      onChange={(e) => setCategory(i, e.target.value)}
                      className="min-w-0 flex-1 rounded-lg sm:max-w-44 sm:flex-none border border-line bg-card px-2 py-1 text-xs outline-none focus:border-accent"
                      title="Kategorie direkt ändern"
                      aria-label={`Kategorie von ${i.name}`}
                    >
                      {[...new Set([...catOptions, i.category || "Sonstige"])].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                      <option value={NEW_CAT}>＋ Neue Kategorie…</option>
                    </select>
                    {aliasFor === i.id ? (
                      <>
                        <input
                          autoFocus
                          value={aliasText}
                          onChange={(e) => setAliasText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") addAlias(i.id);
                            if (e.key === "Escape") setAliasFor(null);
                          }}
                          placeholder="Alias, z. B. Kokosdrinks"
                          className="w-28 min-w-0 rounded-lg border border-line bg-card px-2 py-1 text-xs outline-none focus:border-accent sm:w-44"
                        />
                        <button onClick={() => addAlias(i.id)} className="rounded-lg bg-accent px-2 py-1 text-xs font-semibold text-background">
                          OK
                        </button>
                        <button onClick={() => setAliasFor(null)} className="rounded-lg border border-line px-2 py-1 text-xs text-muted">
                          Abbr.
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { setAliasFor(i.id); setAliasText(""); }}
                          className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-foreground"
                          title="Alias anlegen (z. B. „Reis“ → „Basmatireis“)"
                        >
                          + Alias
                        </button>
                        <button
                          onClick={() => startEdit(i)}
                          className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-foreground"
                        >
                          Bearbeiten
                        </button>
                        <button
                          onClick={() => delIng(i)}
                          disabled={i.recipe_count > 0}
                          title={
                            i.recipe_count > 0
                              ? `In ${i.recipe_count} Rezept(en) verwendet`
                              : "Zutat löschen"
                          }
                          className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Löschen
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </section>
      ))}

      {filtered.length === 0 && (
        <p className="text-sm text-muted">Keine Zutaten gefunden.</p>
      )}
    </div>
  );
}

function PerElInput({ value, onChange, unit }: { value: string; onChange: (v: string) => void; unit: string }) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted" title="Umrechnung für EL/TL in Rezepten (1 TL = ⅓ EL)">
      1 EL =
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder={unit === "ml" ? "15" : "z. B. 10"}
        className="w-16 rounded-lg border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
      {unit}
    </label>
  );
}
