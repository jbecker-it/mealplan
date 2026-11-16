"use client";

import { useState } from "react";

interface Ing {
  raw: string;
  amount?: number;
  unit?: string;
  name: string;
  match: "existing" | "alias" | "fuzzy" | "new";
  matchedId?: number;
  suggestion?: { id: number; name: string };
  acceptSuggestion?: boolean;
  newName?: string;
}
interface PreviewRec {
  title: string;
  macros?: { kcal?: number; p?: number; c?: number; f?: number; sugar?: number; salt?: number };
  ingredients: Ing[];
  steps: string[];
  tags: string[];
  slots: string[];
  warnings: string[];
}

const SLOT_LABEL: Record<string, string> = { B: "Frühstück", M: "Mittag", A: "Abend", S: "Snack" };

const MATCH_LABEL: Record<string, [string, string]> = {
  existing: ["Bestehende Entität", "border-accent/40 bg-accent/10"],
  alias: ["Alias → bestehend", "border-accent/40 bg-accent/10"],
  fuzzy: ["Vorschlag prüfen", "border-warn/40 bg-warn/10"],
  new: ["Neue Entität", "border-danger/40 bg-danger/10"],
};

const SAMPLE = `# Protein-Overnight-Oats
Makros: 520 kcal | 38 g Protein | 52 g KH | 12 g Fett
Slot: Frühstück
Zutaten:
- 60 g Haferflocken
- 25 g Sojadrink
- 20 g Sojaproteinpulver
- 1 Banane
Zubereitung:
1. Alles mischen
2. Über Nacht in den Kühlschrank
---
# Tofu-Bowl Reis
Makros: 610 kcal | 32 g Protein | 74 g KH | 18 g Fett
Slot: Mittag, Abend
Zutaten:
- 80 g Reis
- 150 g Tofu
- 100 g Paprika
Zubereitung:
1. Reis kochen
2. Tofu anbraten
`;

export default function ImportClient() {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewRec[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function parse() {
    setBusy(true);
    setErr("");
    setPreview(null);
    const r = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const d = await r.json();
    if (!r.ok) setErr(d.error || "Fehler");
    else setPreview(d.preview);
    setBusy(false);
  }

  function toggleSlot(recIdx: number, k: string) {
    setPreview((p) =>
      p
        ? p.map((rec, ri) =>
            ri !== recIdx
              ? rec
              : { ...rec, slots: rec.slots?.includes(k) ? rec.slots.filter((x) => x !== k) : [...(rec.slots ?? []), k] }
          )
        : p
    );
  }

  function setIng(recIdx: number, ingIdx: number, patch: Partial<Ing>) {
    setPreview((p) =>
      p
        ? p.map((rec, ri) =>
            ri !== recIdx
              ? rec
              : { ...rec, ingredients: rec.ingredients.map((ing, ii) => (ii === ingIdx ? { ...ing, ...patch } : ing)) }
          )
        : p
    );
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    setErr("");
    setMsg("");
    // Fuzzy ohne Entscheidung → Blocker: nur bestehende/alias/akzeptierte/neue speichern
    const unresolved = preview.filter((r) =>
      r.ingredients.some((i) => i.match === "fuzzy" && !i.acceptSuggestion)
    );
    if (unresolved.length) {
      setErr(`${unresolved.length} Rezept(e) mit ungeklärten Vorschlägen — „Übernehmen“ anklicken oder Name eingeben.`);
      setBusy(false);
      return;
    }
    const resolutions = preview.map((rec) => ({
      title: rec.title,
      ingredients: rec.ingredients.map((i) => ({
        name: i.name,
        amount: i.amount,
        unit: i.unit,
        match: i.match === "fuzzy" ? (i.acceptSuggestion ? "fuzzy" : "new") : i.match,
        matchedId: i.matchedId,
        suggestion: i.suggestion,
        acceptSuggestion: i.acceptSuggestion,
        newName: i.newName,
      })),
    }));
    const r = await fetch("/api/import/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preview, resolutions }),
    });
    const d = await r.json();
    if (r.ok) {
      setMsg(`${d.saved.length} Rezepte gespeichert${d.created.length ? `, ${d.created.length} neue Zutat-Entitäten angelegt` : ""}`);
      setPreview(null);
      setText("");
    } else setErr(d.error || "Fehler");
    setBusy(false);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Rezepte importieren</h1>
        <span className="flex-1" />
        <button onClick={() => setText(SAMPLE)} className="rounded-lg bg-card px-3 py-1.5 text-sm text-muted hover:text-foreground">
          Beispiel laden
        </button>
        <button onClick={parse} disabled={busy || !text.trim()} className="rounded-lg bg-accent px-4 py-1.5 font-semibold text-background hover:opacity-90 disabled:opacity-40">
          Auswerten
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        placeholder={"Text einfügen. Blöcke mit --- trennen.\n\nFormat:\n# Titel\nMakros: 500 kcal | 35 g Protein | 55 g KH | 10 g Fett\nSlot: Frühstück, Mittag, Abend, Snack (optional)\nZutaten:\n- 50 g Haferflocken\n- 300 ml Sojadrink\nZubereitung:\n1. …"}
        className="w-full rounded-2xl border border-line bg-card p-4 font-mono text-sm outline-none focus:border-accent"
      />

      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
      {msg && <p className="mt-3 text-sm text-accent">{msg}</p>}

      {preview && (
        <div className="mt-5">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="font-semibold">{preview.length} Rezept(e) erkannt</h2>
            <span className="flex-1" />
            <button onClick={save} disabled={busy} className="rounded-lg bg-accent px-4 py-2 font-semibold text-background hover:opacity-90 disabled:opacity-40">
              {busy ? "Speichere…" : "Speichern"}
            </button>
          </div>
          <div className="space-y-4">
            {preview.map((rec, ri) => (
              <div key={ri} className="rounded-2xl border border-line bg-card">
                <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                  <span className="font-semibold">{rec.title}</span>
                  {rec.macros?.kcal != null ? (
                    <span className="text-sm text-muted">
                      {rec.macros.kcal} kcal · P {rec.macros.p} · C {rec.macros.c} · F {rec.macros.f}
                      {rec.macros.sugar != null && <> · Zucker {rec.macros.sugar} g</>}
                      {rec.macros.salt != null && <> · Salz {rec.macros.salt} g</>}
                    </span>
                  ) : (
                    <span className="rounded bg-danger/20 px-2 py-0.5 text-xs text-danger">Makros fehlen — wird übersprungen</span>
                  )}
                  {rec.tags.map((t) => (
                    <span key={t} className="rounded bg-card2 px-2 py-0.5 text-xs text-muted">{t}</span>
                  ))}
                  {rec.slots && (
                    <span className="flex items-center gap-1">
                      {["B", "M", "A", "S"].map((k) => (
                        <button
                          key={k}
                          onClick={() => toggleSlot(ri, k)}
                          title="Slot umschalten"
                          className={`rounded px-1.5 py-0.5 text-xs ${rec.slots.includes(k) ? "bg-accent font-semibold text-background" : "bg-card2 text-muted"}`}
                        >
                          {SLOT_LABEL[k]}
                        </button>
                      ))}
                    </span>
                  )}
                  {rec.warnings.map((w, i) => (
                    <span key={i} className="rounded bg-warn/20 px-2 py-0.5 text-xs text-warn">{w}</span>
                  ))}
                </div>
                <div className="divide-y divide-line">
                  {rec.ingredients.map((ing, ii) => {
                    const [label, cls] = MATCH_LABEL[ing.match];
                    return (
                      <div key={ii} className={`flex flex-wrap items-center gap-2 px-4 py-2 ${cls}`}>
                        <span className="w-24 text-xs text-muted">{label}</span>
                        <span className="flex-1 text-sm">
                          {ing.amount != null && (
                            <b className="mr-1">{ing.amount} {ing.unit}</b>
                          )}
                          {ing.match === "fuzzy" && ing.suggestion ? (
                            <span className="text-warn">{ing.suggestion.name}</span>
                          ) : (
                            ing.name
                          )}
                        </span>
                        {ing.match === "fuzzy" && ing.suggestion && (
                          <>
                            <button
                              onClick={() => setIng(ri, ii, { acceptSuggestion: true })}
                              className={`rounded px-2 py-1 text-xs ${ing.acceptSuggestion ? "bg-accent font-semibold text-background" : "bg-card2 hover:text-foreground"}`}
                            >
                              ✓ {ing.suggestion.name}
                            </button>
                            <input
                              value={ing.newName || ""}
                              onChange={(e) => setIng(ri, ii, { newName: e.target.value, acceptSuggestion: false })}
                              placeholder="oder neuer Name"
                              className="rounded border border-line bg-background px-2 py-1 text-xs outline-none focus:border-accent"
                            />
                          </>
                        )}
                        {ing.match === "new" && (
                          <span className="text-xs text-muted">→ neue Entität „{ing.name}“</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
