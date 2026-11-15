"use client";

import { useCallback, useEffect, useState } from "react";

interface Profile {
  id: number;
  name: string;
  kcal_target: number;
  p_target: number;
  c_target: number;
  f_target: number;
  slot_split: Record<string, number> | null;
  tag_include: number[];
  tag_exclude: number[];
}
interface Tag {
  id: number;
  name: string;
}

const SLOTS = [
  ["B", "Frühstück"],
  ["M", "Mittag"],
  ["A", "Abend"],
  ["S", "Snack"],
] as const;

export default function ProfilesClient() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newTag, setNewTag] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((d) => {
        setProfiles(d.profiles);
        setTags(d.tags);
      })
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  async function save(p: Profile) {
    await fetch("/api/profiles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: p.id,
        name: p.name,
        kcal_target: Number(p.kcal_target),
        p_target: Number(p.p_target),
        c_target: Number(p.c_target),
        f_target: Number(p.f_target),
        split: p.slot_split,
        tag_include: p.tag_include,
        tag_exclude: p.tag_exclude,
      }),
    });
    setSavedId(p.id);
    setTimeout(() => setSavedId(null), 2000);
  }

  async function addTag() {
    if (!newTag.trim()) return;
    await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTag }),
    });
    setNewTag("");
    load();
  }

  const sumSplit = (p: Profile) => {
    const s = p.slot_split || {};
    return (s.B || 0) + (s.M || 0) + (s.A || 0) + (s.S || 0);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Profile & Ziele</h1>
        <span className="text-sm text-muted">Makros händisch pflegen — pro Person</span>
      </div>

      <div className="mb-5 flex items-end gap-2 rounded-2xl border border-line bg-card p-4">
        <div>
          <div className="mb-1 text-xs uppercase text-muted">Tags verwalten</div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span key={t.id} className="rounded-lg bg-card2 px-2.5 py-1 text-sm">{t.name}</span>
            ))}
          </div>
        </div>
        <span className="flex-1" />
        <input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTag()}
          placeholder="Neues Tag"
          className="rounded-lg border border-line bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button onClick={addTag} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:opacity-90">+</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {profiles.map((p) => {
          const splitSum = sumSplit(p);
          const splitOk = splitSum > 0 && Math.abs(splitSum - p.kcal_target) / p.kcal_target < 0.05;
          return (
            <div key={p.id} className="rounded-2xl border border-line bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <input
                  value={p.name}
                  onChange={(e) => setProfiles((arr) => arr.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))}
                  className="flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-bold outline-none hover:border-line focus:border-accent"
                />
                {savedId === p.id && <span className="text-sm text-accent">✓ Gespeichert</span>}
              </div>

              <div className="mb-3 grid grid-cols-4 gap-2">
                {([["kcal_target", "kcal"], ["p_target", "Protein g"], ["c_target", "KH g"], ["f_target", "Fett g"]] as const).map(([k, l]) => (
                  <label key={k} className="text-xs text-muted">
                    {l}
                    <input
                      type="number"
                      value={p[k]}
                      onChange={(e) => setProfiles((arr) => arr.map((x) => (x.id === p.id ? { ...x, [k]: Number(e.target.value) } : x)))}
                      className="mt-1 w-full rounded-lg border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                    />
                  </label>
                ))}
              </div>

              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Slot-Aufteilung (kcal)</h3>
                <span className={`text-xs ${splitOk ? "text-accent" : "text-warn"}`}>
                  {splitSum} / {p.kcal_target} kcal
                </span>
              </div>
              <div className="mb-4 grid grid-cols-4 gap-2">
                {SLOTS.map(([k, l]) => (
                  <label key={k} className="text-xs text-muted">
                    {l}
                    <input
                      type="number"
                      value={p.slot_split?.[k] ?? 0}
                      onChange={(e) =>
                        setProfiles((arr) =>
                          arr.map((x) =>
                            x.id === p.id
                              ? { ...x, slot_split: { ...(x.slot_split || {}), [k]: Number(e.target.value) } }
                              : x
                          )
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                    />
                  </label>
                ))}
              </div>

              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                Tags nur einschließen
              </h3>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    onClick={() =>
                      setProfiles((arr) =>
                        arr.map((x) =>
                          x.id === p.id
                            ? { ...x, tag_include: x.tag_include.includes(t.id) ? x.tag_include.filter((i) => i !== t.id) : [...x.tag_include, t.id] }
                            : x
                        )
                      )
                    }
                    className={`rounded-lg px-2.5 py-1 text-sm ${p.tag_include.includes(t.id) ? "bg-accent font-semibold text-background" : "bg-card2 text-muted"}`}
                  >
                    {t.name}
                  </button>
                ))}
                {tags.length === 0 && <span className="text-xs text-muted">Keine Tags — oben anlegen.</span>}
              </div>

              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Tags ausschließen</h3>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    onClick={() =>
                      setProfiles((arr) =>
                        arr.map((x) =>
                          x.id === p.id
                            ? { ...x, tag_exclude: x.tag_exclude.includes(t.id) ? x.tag_exclude.filter((i) => i !== t.id) : [...x.tag_exclude, t.id] }
                            : x
                        )
                      )
                    }
                    className={`rounded-lg px-2.5 py-1 text-sm ${p.tag_exclude.includes(t.id) ? "bg-danger font-semibold text-background" : "bg-card2 text-muted"}`}
                  >
                    {t.name}
                  </button>
                ))}
                {tags.length === 0 && <span className="text-xs text-muted">Keine Tags — oben anlegen.</span>}
              </div>

              <button
                onClick={() => save(p)}
                className="rounded-lg bg-accent px-5 py-2 font-semibold text-background hover:opacity-90"
              >
                Speichern
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
