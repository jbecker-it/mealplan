"use client";

import { useCallback, useEffect, useState } from "react";

interface Rec {
  id: number;
  title: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  favorite: number;
  tags: string[];
  slots: string[];
}

const SLOT_LABEL: Record<string, string> = { B: "Frühstück", M: "Mittag", A: "Abend", S: "Snack" };
interface Ing {
  id: number;
  name: string;
  category: string;
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
  tagIds: number[];
}
interface Tag {
  id: number;
  name: string;
}

export default function RecipesClient() {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState<number | "">("");
  const [favOnly, setFavOnly] = useState(false);
  const [sel, setSel] = useState<Rec | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (tagFilter !== "") p.set("tag", String(tagFilter));
    if (favOnly) p.set("fav", "1");
    fetch(`/api/recipes?${p}`).then((r) => r.json()).then(setRecs).catch(() => {});
    fetch("/api/tags").then((r) => r.json()).then(setTags).catch(() => {});
  }, [q, tagFilter, favOnly]);

  useEffect(load, [load]);

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
    if (sel?.id === r.id) setSel({ ...sel, favorite: !sel.favorite ? 1 : 0 });
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
      setSel({ id: d.id, title: newTitle, kcal: null, protein_g: null, carbs_g: null, fat_g: null, favorite: 0, tags: [], slots: ["B", "M", "A", "S"] });
      load();
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">Rezepte</h1>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suche…"
          className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value ? Number(e.target.value) : "")}
          className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm"
        >
          <option value="">Alle Tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} className="accent-[var(--accent)]" />
          Favoriten
        </label>
        <span className="flex-1" />
        <span className="text-sm text-muted">{recs.length} Rezepte</span>
        <button onClick={() => setShowForm(true)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:opacity-90">
          + Neu
        </button>
      </div>

      {showForm && (
        <div className="mb-4 flex gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Neuer Rezept-Titel"
            className="flex-1 rounded-lg border border-line bg-card px-3 py-2 outline-none focus:border-accent"
          />
          <button onClick={create} className="rounded-lg bg-accent px-4 py-2 font-semibold text-background hover:opacity-90">Anlegen</button>
          <button onClick={() => setShowForm(false)} className="rounded-lg bg-card px-3 py-2 text-muted">Abbrechen</button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {recs.map((r) => (
          <button
            key={r.id}
            onClick={() => setSel({ ...r })}
            className={`rounded-2xl border p-4 text-left transition hover:border-accent ${
              sel?.id === r.id ? "border-accent bg-card2" : "border-line bg-card"
            }`}
          >
            <div className="mb-1 flex items-start gap-2">
              <span className={`text-lg ${r.favorite ? "text-warn" : "text-muted/40"}`}>★</span>
              <span className="font-semibold">{r.title}</span>
            </div>
            {r.kcal != null ? (
              <div className="text-xs text-muted">
                {r.kcal} kcal · P {r.protein_g} · C {r.carbs_g} · F {r.fat_g}
              </div>
            ) : (
              <div className="text-xs text-warn">Makros fehlen</div>
            )}
            {r.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {r.tags.map((t) => (
                  <span key={t} className="rounded bg-card2 px-1.5 py-0.5 text-[11px] text-muted">{t}</span>
                ))}
              </div>
            )}
            {r.slots && r.slots.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {r.slots.map((s) => (
                  <span key={s} className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent">{SLOT_LABEL[s] || s}</span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>

      {sel && (
        <Detail
          rec={sel}
          tags={tags}
          onClose={() => setSel(null)}
          onFav={() => toggleFav(sel)}
          onDelete={() => remove(sel.id)}
          onSaved={() => { load(); }}
        />
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
  const [macros, setMacros] = useState({ kcal: "", p: "", c: "", f: "" });
  const [ings, setIngs] = useState<Array<{ name: string; amount: string; unit: string }>>([]);
  const [steps, setSteps] = useState("");
  const [tagSel, setTagSel] = useState<number[]>([]);
  const [slotSel, setSlotSel] = useState<string[]>(["B", "M", "A", "S"]);
  const [ingList, setIngList] = useState<Ing[]>([]);
  const [msg, setMsg] = useState("");

  const loadDetail = useCallback(() => {
    fetch(`/api/recipes/${rec.id}`)
      .then((r) => r.json())
      .then((x: RecDetail) => {
        setD(x);
        setTitle(x.title);
        setMacros({ kcal: x.kcal != null ? String(x.kcal) : "", p: x.protein_g != null ? String(x.protein_g) : "", c: x.carbs_g != null ? String(x.carbs_g) : "", f: x.fat_g != null ? String(x.fat_g) : "" });
        setIngs(x.ingredients.map((i) => ({ name: i.name, amount: i.amount?.toString() ?? "", unit: i.unit || "" })));
        setSteps(x.steps.join("\n"));
        setTagSel(x.tagIds || []);
        setSlotSel(x.slots?.length ? x.slots : ["B", "M", "A", "S"]);
      })
      .catch(() => setD(null));
  }, [rec.id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    fetch("/api/ingredients").then((r) => r.json()).then(setIngList).catch(() => {});
  }, []);

  async function save() {
    setMsg("");
    const r = await fetch(`/api/recipes/${rec.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        kcal: macros.kcal ? Number(macros.kcal) : null,
        protein_g: macros.p ? Number(macros.p) : null,
        carbs_g: macros.c ? Number(macros.c) : null,
        fat_g: macros.f ? Number(macros.f) : null,
        ingredients: ings.filter((i) => i.name.trim()).map((i) => ({
          name: i.name, amount: i.amount ? Number(i.amount) : null, unit: i.unit || undefined,
        })),
        steps: steps.split("\n").map((s) => s.trim()).filter(Boolean),
        tags: tagSel.map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean),
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
        <div className="mb-3 flex items-center gap-2">
          <button onClick={onFav} title="Favorit" className={`text-xl ${rec.favorite ? "text-warn" : "text-muted/40 hover:text-muted"}`}>★</button>
          <h2 className="flex-1 text-lg font-bold">{rec.title}</h2>
          {msg && <span className="text-sm text-accent">{msg}</span>}
          <button onClick={() => setEdit(!edit)} className="rounded-lg bg-card2 px-3 py-1.5 text-sm hover:text-accent">{edit ? "Abbrechen" : "Bearbeiten"}</button>
          <button onClick={onDelete} className="rounded-lg bg-card2 px-3 py-1.5 text-sm text-danger hover:opacity-80">Archivieren</button>
          <button onClick={onClose} className="px-2 text-muted hover:text-foreground">✕</button>
        </div>

        {!edit ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2 text-center">
              {([["kcal", d.kcal], ["Protein", d.protein_g], ["KH", d.carbs_g], ["Fett", d.fat_g]] as const).map(([l, v]) => (
                <div key={l} className="rounded-xl bg-card2 px-2 py-2">
                  <div className="text-xs text-muted">{l}</div>
                  <div className="font-semibold">{v ?? "–"}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs uppercase tracking-wide text-muted">Slot:</span>
              {d.slots && d.slots.length > 0 ? (
                d.slots.map((s) => (
                  <span key={s} className="rounded bg-accent/15 px-2 py-0.5 text-xs text-accent">{SLOT_LABEL[s] || s}</span>
                ))
              ) : (
                <span className="text-xs text-muted">überall</span>
              )}
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Zutaten</h3>
              <ul className="space-y-0.5">
                {d.ingredients.map((i) => (
                  <li key={i.id} className="flex justify-between text-sm">
                    <span>{i.name} <span className="text-muted">({i.category})</span></span>
                    <span className="text-muted">{i.amount ? `${i.amount} ${i.unit}` : "–"}</span>
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
            {d.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {d.tags.map((t) => <span key={t} className="rounded bg-card2 px-2 py-0.5 text-xs text-muted">{t}</span>)}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel" className="w-full rounded-lg border border-line bg-background px-3 py-2 outline-none focus:border-accent" />
            <div className="grid grid-cols-4 gap-2">
              {([["kcal", "kcal"], ["p", "Protein g"], ["c", "KH g"], ["f", "Fett g"]] as const).map(([k, l]) => (
                <label key={k} className="text-xs text-muted">
                  {l}
                  <input value={(macros as Record<string, string>)[k]} onChange={(e) => setMacros((m) => ({ ...m, [k]: e.target.value }))} className="mt-1 w-full rounded-lg border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent" />
                </label>
              ))}
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Zutaten (Entitäten)</h3>
              <div className="space-y-1.5">
                {ings.map((ing, i) => (
                  <div key={i} className="flex gap-1.5">
                    <div className="flex-[2]">
                      <input
                        value={ing.name}
                        onChange={(e) => setIngs((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                        placeholder="Zutat wählen/anlegen"
                        list="ing-options"
                        className="w-full rounded-lg border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                      />
                    </div>
                    <input value={ing.amount} onChange={(e) => setIngs((arr) => arr.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder="Menge" className="w-20 rounded-lg border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent" />
                    <input value={ing.unit} onChange={(e) => setIngs((arr) => arr.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} placeholder="g/ml" className="w-16 rounded-lg border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent" />
                    <button onClick={() => setIngs((arr) => arr.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-danger">✕</button>
                  </div>
                ))}
                <button onClick={() => setIngs((arr) => [...arr, { name: "", amount: "", unit: "" }])} className="rounded-lg bg-card2 px-3 py-1 text-sm text-muted hover:text-foreground">+ Zutat</button>
              </div>
              <datalist id="ing-options">{ingList.map((i) => <option key={i.id} value={i.name} />)}</datalist>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Zubereitung (eine Zeile = Schritt)</h3>
              <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={4} className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent" />
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button key={t.id} onClick={() => setTagSel((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]))} className={`rounded-lg px-2.5 py-1 text-sm ${tagSel.includes(t.id) ? "bg-accent font-semibold text-background" : "bg-card2 text-muted"}`}>
                    {t.name}
                  </button>
                ))}
              </div>
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
              <p className="mt-1 text-xs text-muted">Nichts ausgewählt = Rezept darf in jedem Slot stehen. Die Engine respektiert die Auswahl.</p>
            </div>
            <button onClick={save} className="rounded-lg bg-accent px-5 py-2 font-semibold text-background hover:opacity-90">Speichern</button>
          </div>
        )}
      </div>
    </div>
  );
}
