"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UNITS, fmtQty } from "@/lib/units";

interface Rec {
  id: number;
  title: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  sugar_g: number | null;
  salt_g: number | null;
  favorite: number;
  tags: string[];
  slots: string[];
}

const SLOT_LABEL: Record<string, string> = { B: "Frühstück", M: "Mittag", A: "Abend", S: "Snack" };
interface Ing {
  id: number;
  name: string;
  category: string;
  unit_default: string;
}
interface IngRow {
  id: number;
  ingredient_id: number;
  name: string;
  category: string;
  amount: number | null;
  unit: string | null;
  note: string | null;
}
interface RecDetail extends Rec {
  ingredients: IngRow[];
  steps: string[];
}
interface Tag {
  id: number;
  name: string;
  recipe_count: number;
}

const inputCls =
  "rounded-lg border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent";

export default function RecipesClient() {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState<number[]>([]);
  const [favOnly, setFavOnly] = useState(false);
  const [sel, setSel] = useState<Rec | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [showForm, setShowForm] = useState(false);

  const loadTags = useCallback(() => {
    fetch("/api/tags").then((r) => r.json()).then(setTags).catch(() => {});
  }, []);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    for (const t of tagFilter) p.append("tag", String(t));
    if (favOnly) p.set("fav", "1");
    fetch(`/api/recipes?${p}`).then((r) => r.json()).then(setRecs).catch(() => {});
  }, [q, tagFilter, favOnly]);

  useEffect(load, [load]);
  useEffect(loadTags, [loadTags]);

  const toggleTag = (id: number) =>
    setTagFilter((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const tagIdByName = (name: string) => tags.find((t) => t.name === name)?.id;

  async function remove(id: number) {
    if (!confirm("Rezept archivieren?")) return;
    await fetch(`/api/recipes/${id}`, { method: "DELETE" });
    setSel(null);
    load();
  }

  async function toggleFav(r: Rec) {
    await fetch(`/api/recipes/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite: !r.favorite }),
    });
    load();
    if (sel?.id === r.id) setSel({ ...sel, favorite: sel.favorite ? 0 : 1 });
  }

  async function create() {
    if (!newTitle.trim()) return;
    const r = await fetch("/api/recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });
    const d = await r.json();
    if (d.id) {
      setShowForm(false);
      setNewTitle("");
      setSel({ id: d.id, title: newTitle, kcal: null, protein_g: null, carbs_g: null, fat_g: null, sugar_g: null, salt_g: null, favorite: 0, tags: [], slots: ["B", "M", "A", "S"] });
      load();
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">Rezepte</h1>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suche…"
          className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <span className="flex-1" />
        <span className="text-sm text-muted">{recs.length} Rezepte</span>
        <button onClick={() => setShowForm(true)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:opacity-90">
          + Neu
        </button>
      </div>

      {/* Filter: Favoriten + Tags (mehrere = Rezept muss alle tragen) */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setFavOnly((v) => !v)}
          className={`rounded-full px-3 py-1 text-sm ${favOnly ? "bg-warn font-semibold text-background" : "bg-card text-muted hover:text-foreground"}`}
        >
          ★ Favoriten
        </button>
        {tags.map((t) => (
          <button
            key={t.id}
            onClick={() => toggleTag(t.id)}
            className={`rounded-full px-3 py-1 text-sm ${
              tagFilter.includes(t.id) ? "bg-accent font-semibold text-background" : "bg-card text-muted hover:text-foreground"
            }`}
          >
            #{t.name} <span className="opacity-60">{t.recipe_count}</span>
          </button>
        ))}
        {(tagFilter.length > 0 || favOnly) && (
          <button
            onClick={() => {
              setTagFilter([]);
              setFavOnly(false);
            }}
            className="px-2 text-sm text-muted underline hover:text-foreground"
          >
            Filter zurücksetzen
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-4 flex gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Neuer Rezept-Titel"
            autoFocus
            className="flex-1 rounded-lg border border-line bg-card px-3 py-2 outline-none focus:border-accent"
          />
          <button onClick={create} className="rounded-lg bg-accent px-4 py-2 font-semibold text-background hover:opacity-90">Anlegen</button>
          <button onClick={() => setShowForm(false)} className="rounded-lg bg-card px-3 py-2 text-muted">Abbrechen</button>
        </div>
      )}

      {recs.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-card p-10 text-center text-muted">
          Keine Rezepte {tagFilter.length || favOnly || q ? "für diesen Filter" : "— über „Import“ oder „+ Neu“ anlegen"}.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {recs.map((r) => (
          <div
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={() => setSel({ ...r })}
            onKeyDown={(e) => e.key === "Enter" && setSel({ ...r })}
            className={`cursor-pointer rounded-2xl border p-4 text-left transition hover:border-accent ${
              sel?.id === r.id ? "border-accent bg-card2" : "border-line bg-card"
            }`}
          >
            <div className="mb-1 flex items-start gap-2">
              <span className={`text-lg ${r.favorite ? "text-warn" : "text-muted/40"}`}>★</span>
              <span className="font-semibold">{r.title}</span>
            </div>
            {r.kcal != null ? (
              <div className="text-xs text-muted">
                {r.kcal} kcal · P {r.protein_g ?? "–"} · C {r.carbs_g ?? "–"} · F {r.fat_g ?? "–"}
                {r.sugar_g != null && <> · Zucker {r.sugar_g} g</>}
                {r.salt_g != null && <> · Salz {r.salt_g} g</>}
              </div>
            ) : (
              <div className="text-xs text-warn">Makros fehlen</div>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {r.slots.map((s) => (
                <span key={s} className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent">{SLOT_LABEL[s] || s}</span>
              ))}
              {r.tags.map((t) => {
                const id = tagIdByName(t);
                return (
                  <button
                    key={t}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (id) toggleTag(id);
                    }}
                    title="Nach diesem Tag filtern"
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      id && tagFilter.includes(id) ? "bg-accent text-background" : "bg-card2 text-muted hover:text-foreground"
                    }`}
                  >
                    #{t}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {sel && (
        <Detail
          key={sel.id}
          rec={sel}
          tags={tags}
          onClose={() => setSel(null)}
          onFav={() => toggleFav(sel)}
          onDelete={() => remove(sel.id)}
          onSaved={() => {
            load();
            loadTags();
          }}
        />
      )}
    </div>
  );
}

// Tags eintippen: Enter/Komma fügt hinzu (neue Tags werden beim Speichern angelegt)
function TagEditor({ value, onChange, all }: { value: string[]; onChange: (v: string[]) => void; all: Tag[] }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) {
      const existing = all.find((t) => t.name.toLowerCase() === p.toLowerCase())?.name ?? p;
      if (!next.some((x) => x.toLowerCase() === existing.toLowerCase())) next.push(existing);
    }
    onChange(next);
    setText("");
  };
  const suggestions = all.filter((t) => !value.some((v) => v.toLowerCase() === t.name.toLowerCase()));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-sm font-semibold text-background">
            #{t}
            <button onClick={() => onChange(value.filter((x) => x !== t))} title="Tag entfernen" className="opacity-70 hover:opacity-100">
              ×
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => {
            if (e.target.value.endsWith(",")) add(e.target.value);
            else setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(text);
            } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => add(text)}
          placeholder="Tag eintippen + Enter"
          className={inputCls + " min-w-40 flex-1"}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-xs text-muted">Vorhanden:</span>
          {suggestions.map((t) => (
            <button key={t.id} onClick={() => add(t.name)} className="rounded-full bg-card2 px-2 py-0.5 text-xs text-muted hover:text-foreground">
              + {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Detail({
  rec, tags, onClose, onFav, onDelete, onSaved,
}: {
  rec: Rec;
  tags: Tag[];
  onClose: () => void;
  onFav: () => void;
  onDelete: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<RecDetail | null>(null);
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(rec.title);
  const [macros, setMacros] = useState({ kcal: "", p: "", c: "", f: "", su: "", sa: "" });
  const [ings, setIngs] = useState<Array<{ name: string; amount: string; unit: string }>>([]);
  const [steps, setSteps] = useState("");
  const [tagSel, setTagSel] = useState<string[]>([]);
  const [slotSel, setSlotSel] = useState<string[]>(["B", "M", "A", "S"]);
  const [ingList, setIngList] = useState<Ing[]>([]);
  const [msg, setMsg] = useState("");
  const firstLoad = useRef(true);

  const num = (v: number | null) => (v != null ? String(v).replace(".", ",") : "");

  const loadDetail = useCallback(() => {
    fetch(`/api/recipes/${rec.id}`)
      .then((r) => r.json())
      .then((x: RecDetail) => {
        setD(x);
        setTitle(x.title);
        setMacros({ kcal: num(x.kcal), p: num(x.protein_g), c: num(x.carbs_g), f: num(x.fat_g), su: num(x.sugar_g), sa: num(x.salt_g) });
        setIngs(x.ingredients.map((i) => ({ name: i.name, amount: num(i.amount), unit: i.unit || "" })));
        setSteps(x.steps.join("\n"));
        setTagSel(x.tags || []);
        setSlotSel(x.slots?.length ? x.slots : ["B", "M", "A", "S"]);
        // Neues, leeres Rezept beim ersten Öffnen direkt bearbeiten
        if (firstLoad.current && x.kcal == null && x.ingredients.length === 0) setEdit(true);
        firstLoad.current = false;
      })
      .catch(() => setD(null));
  }, [rec.id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    fetch("/api/ingredients").then((r) => r.json()).then(setIngList).catch(() => {});
  }, []);

  const setIng = (i: number, patch: Partial<{ name: string; amount: string; unit: string }>) =>
    setIngs((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    setMsg("");
    const r = await fetch(`/api/recipes/${rec.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        // Zahlen als Text schicken: der Server versteht „12,5“ und „½“
        kcal: macros.kcal || null,
        protein_g: macros.p || null,
        carbs_g: macros.c || null,
        fat_g: macros.f || null,
        sugar_g: macros.su || null,
        salt_g: macros.sa || null,
        ingredients: ings.filter((i) => i.name.trim()).map((i) => ({
          name: i.name.trim(), amount: i.amount || null, unit: i.unit || undefined,
        })),
        steps: steps.split("\n").map((s) => s.trim()).filter(Boolean),
        tags: tagSel,
        slots: slotSel,
      }),
    });
    if (r.ok) {
      setEdit(false);
      setMsg("Gespeichert");
      loadDetail();
      onSaved();
      setTimeout(() => setMsg(""), 2000);
    } else setMsg((await r.json()).error || "Fehler");
  }

  if (!d)
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="text-muted">Lade…</div>
      </div>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-10" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-line bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button onClick={onFav} title="Favorit" className={`text-xl ${rec.favorite ? "text-warn" : "text-muted/40 hover:text-muted"}`}>★</button>
          <h2 className="flex-1 text-lg font-bold">{d.title}</h2>
          {msg && <span className="text-sm text-accent">{msg}</span>}
          {!edit && d.ingredients.length > 0 && (
            <Link href={`/cook/${rec.id}`} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:opacity-90">
              Kochen
            </Link>
          )}
          <button onClick={() => {
              if (edit) loadDetail();
              setEdit(!edit);
            }} className="rounded-lg bg-card2 px-3 py-1.5 text-sm hover:text-accent">{edit ? "Abbrechen" : "Bearbeiten"}</button>
          <button onClick={onDelete} className="rounded-lg bg-card2 px-3 py-1.5 text-sm text-danger hover:opacity-80">Archivieren</button>
          <button onClick={onClose} className="px-2 text-muted hover:text-foreground">✕</button>
        </div>

        {!edit ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
              {([["kcal", d.kcal], ["Protein", d.protein_g], ["KH", d.carbs_g], ["Fett", d.fat_g], ["Zucker", d.sugar_g], ["Salz", d.salt_g]] as const).map(([l, v]) => (
                <div key={l} className="rounded-xl bg-card2 px-2 py-2">
                  <div className="text-xs text-muted">{l}</div>
                  <div className="font-semibold">{v != null ? String(v).replace(".", ",") : "–"}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs uppercase tracking-wide text-muted">Slot:</span>
              {d.slots.map((s) => (
                <span key={s} className="rounded bg-accent/15 px-2 py-0.5 text-xs text-accent">{SLOT_LABEL[s] || s}</span>
              ))}
              {d.tags.map((t) => (
                <span key={t} className="rounded bg-card2 px-2 py-0.5 text-xs text-muted">#{t}</span>
              ))}
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Zutaten (1 Portion)</h3>
              <ul className="space-y-0.5">
                {d.ingredients.map((i) => (
                  <li key={i.id} className="flex justify-between gap-2 text-sm">
                    <span>{i.name} <span className="text-muted">({i.category})</span></span>
                    <span className="shrink-0 text-muted">{i.amount != null ? fmtQty(i.amount, i.unit || "") : "nach Bedarf"}</span>
                  </li>
                ))}
              </ul>
            </div>
            {d.steps.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Zubereitung</h3>
                <ol className="list-inside list-decimal space-y-1 text-sm">
                  {d.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel" className="w-full rounded-lg border border-line bg-background px-3 py-2 outline-none focus:border-accent" />
            <div>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Makros pro Portion</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {([["kcal", "kcal"], ["p", "Protein g"], ["c", "KH g"], ["f", "Fett g"], ["su", "Zucker g"], ["sa", "Salz g"]] as const).map(([k, l]) => (
                  <label key={k} className="text-xs text-muted">
                    {l}
                    <input inputMode="decimal" value={macros[k]} onChange={(e) => setMacros((m) => ({ ...m, [k]: e.target.value }))} className={inputCls + " mt-1 w-full"} />
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Zutaten für 1 Portion</h3>
              <div className="space-y-1.5">
                {ings.map((ing, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input
                      value={ing.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        const known = ingList.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
                        setIng(i, { name, ...(known && !ing.unit ? { unit: known.unit_default } : {}) });
                      }}
                      placeholder="Zutat wählen/anlegen"
                      list="ing-options"
                      className={inputCls + " min-w-0 flex-[2]"}
                    />
                    <input inputMode="decimal" value={ing.amount} onChange={(e) => setIng(i, { amount: e.target.value })} placeholder="Menge" className={inputCls + " w-20"} />
                    <select value={ing.unit} onChange={(e) => setIng(i, { unit: e.target.value })} className={inputCls + " w-24"}>
                      <option value="">–</option>
                      {[...new Set<string>([...UNITS, ...(ing.unit ? [ing.unit] : [])])].map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                    <button onClick={() => setIngs((arr) => arr.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-danger">✕</button>
                  </div>
                ))}
                <button onClick={() => setIngs((arr) => [...arr, { name: "", amount: "", unit: "" }])} className="rounded-lg bg-card2 px-3 py-1 text-sm text-muted hover:text-foreground">+ Zutat</button>
              </div>
              <datalist id="ing-options">{ingList.map((i) => <option key={i.id} value={i.name} />)}</datalist>
              <p className="mt-1 text-xs text-muted">Mengen wie „1,5“, „½“ oder „1/2“ gehen. EL/TL werden auf der Einkaufsliste umgerechnet (Einstellung je Zutat unter „Zutaten“).</p>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Zubereitung (eine Zeile = Schritt)</h3>
              <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={4} className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent" />
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Tags</h3>
              <TagEditor value={tagSel} onChange={setTagSel} all={tags} />
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Slot / Kategorie</h3>
              <div className="flex flex-wrap gap-1.5">
                {["B", "M", "A", "S"].map((k) => (
                  <button key={k} onClick={() => setSlotSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))} className={`rounded-lg px-2.5 py-1 text-sm ${slotSel.includes(k) ? "bg-accent font-semibold text-background" : "bg-card2 text-muted"}`}>
                    {SLOT_LABEL[k]}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">Nichts ausgewählt = Rezept darf in jedem Slot stehen.</p>
            </div>
            <button onClick={save} className="rounded-lg bg-accent px-5 py-2 font-semibold text-background hover:opacity-90">Speichern</button>
          </div>
        )}
      </div>
    </div>
  );
}
