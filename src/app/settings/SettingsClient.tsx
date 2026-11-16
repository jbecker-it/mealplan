"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Info {
  counts: {
    recipes: number;
    ingredients: number;
    aliases: number;
    profiles: number;
    planMeals: number;
  };
  dbSize: number;
  lastBackup: { name: string; size: number; mtime: string } | null;
}

function fmtSize(n: number): string {
  if (!n) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SettingsClient() {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [resetWord, setResetWord] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const flash = (msg: string, ok = true) => {
    setStatus({ msg, ok });
    window.setTimeout(() => setStatus(null), 6000);
  };

  const load = useCallback(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setInfo(d);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function doRestore() {
    if (!file) return;
    const ok = window.confirm(
      "WIRKLICH WIEDERHERSTELLEN?\n\n" +
        "Die aktuelle Datenbank wird durch die gewählte Datei ersetzt. " +
        "Der aktuelle Stand wird vorher automatisch in data/backups/ gesichert."
    );
    if (!ok) return;
    setBusy("restore");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/restore", { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok) {
        flash(d.note ?? "Wiederherstellung abgeschlossen.");
        if (fileInput.current) fileInput.current.value = "";
        setFile(null);
        load();
      } else flash(d.error ?? "Fehler bei der Wiederherstellung", false);
    } catch {
      flash("Keine Verbindung zum Server", false);
    } finally {
      setBusy(null);
    }
  }

  async function doReset() {
    if (resetWord.trim().toUpperCase() !== "RESET") {
      flash("Bitte „RESET“ eingeben, um den Reset zu bestätigen.", false);
      return;
    }
    const ok = window.confirm(
      "ZURÜCKSETZEN AUF AUSLIEFERUNGSZUSTAND?\n\n" +
        "Alle Rezepte, Zutaten, Pläne und Listen werden gelöscht und die " +
        "Auslieferungszustand-Daten (Demo-Rezepte + 2 Profile) neu angelegt. " +
        "Dein Passwort bleibt erhalten. Der vorherige Stand wird automatisch " +
        "in data/backups/ gesichert."
    );
    if (!ok) return;
    setBusy("reset");
    try {
      const r = await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESET" }),
      });
      const d = await r.json();
      if (r.ok) {
        flash(d.note ?? "Reset abgeschlossen.");
        setResetWord("");
        load();
      } else flash(d.error ?? "Fehler beim Reset", false);
    } catch {
      flash("Keine Verbindung zum Server", false);
    } finally {
      setBusy(null);
    }
  }

  const btn =
    "rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50";
  const dangerBtn =
    "rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50";

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-4 text-xl font-bold">Einstellungen</h1>

      {status && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            status.ok
              ? "border-line bg-card text-foreground"
              : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          {status.msg}
        </div>
      )}

      {/* Status */}
      <section className="mb-6 rounded-xl border border-line bg-card/50 p-4">
        <p className="mb-3 text-sm font-semibold">Status</p>
        {info ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            <div>Rezepte</div>
            <div className="text-right font-mono">{info.counts.recipes}</div>
            <div className="text-right text-muted">
              {fmtSize(info.dbSize)} DB
            </div>
            <div>Zutaten</div>
            <div className="text-right font-mono">{info.counts.ingredients}</div>
            <div />
            <div>Aliase</div>
            <div className="text-right font-mono">{info.counts.aliases}</div>
            <div />
            <div>Profile</div>
            <div className="text-right font-mono">{info.counts.profiles}</div>
            <div />
            <div>Pläne (Einträge)</div>
            <div className="text-right font-mono">{info.counts.planMeals}</div>
            <div />
          </div>
        ) : (
          <p className="text-sm text-muted">Status wird geladen…</p>
        )}
        {info?.lastBackup && (
          <p className="mt-3 text-xs text-muted">
            Letztes automatisches Backup: {info.lastBackup.name} (
            {fmtSize(info.lastBackup.size)})
          </p>
        )}
      </section>

      {/* Backup */}
      <section className="mb-6 rounded-xl border border-line bg-card/50 p-4">
        <p className="mb-1 text-sm font-semibold">Backup</p>
        <p className="mb-3 text-sm text-muted">
          Lädt die komplette Datenbank (Rezepte, Zutaten, Profile, Pläne,
          Passwort) als einzelne Datei herunter.
        </p>
        <a
          href="/api/backup"
          className={`inline-block ${btn}`}
          onClick={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          Backup herunterladen
        </a>
      </section>

      {/* Restore */}
      <section className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
        <p className="mb-1 text-sm font-semibold text-amber-300">
          Wiederherstellen (Restore)
        </p>
        <p className="mb-3 text-sm text-muted">
          Setzt eine zuvor heruntergeladene Backup-Datei (.db) wieder ein und
          ersetzt die aktuelle Datenbank. Der aktuelle Stand wird vorher
          automatisch in <code className="text-xs">data/backups/</code> gesichert.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".db,.sqlite,application/octet-stream"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="min-w-40 flex-1 rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-accent/20 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-accent"
          />
          <button
            onClick={doRestore}
            disabled={!file || busy === "restore"}
            className={btn}
          >
            {busy === "restore" ? "Wiederherstelle…" : "Wiederherstellen"}
          </button>
        </div>
      </section>

      {/* Reset */}
      <section className="rounded-xl border border-red-500/40 bg-red-500/5 p-4">
        <p className="mb-1 text-sm font-semibold text-red-300">
          Zurücksetzen (Gefahrenzone)
        </p>
        <p className="mb-3 text-sm text-muted">
          Löscht alle Rezepte, Zutaten, Aliase, Pläne und Listen und legt den
          Auslieferungszustand an (Demo-Rezepte + 2 Profile). Dein Passwort
          bleibt erhalten. Vorheriges Backup empfohlen.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={resetWord}
            onChange={(e) => setResetWord(e.target.value)}
            placeholder="RESET eingeben"
            className="w-36 rounded-lg border border-line bg-card px-3 py-1.5 text-sm outline-none focus:border-red-500"
          />
          <button
            onClick={doReset}
            disabled={busy === "reset"}
            className={dangerBtn}
          >
            {busy === "reset" ? "Setze zurück…" : "Zurücksetzen"}
          </button>
        </div>
      </section>
    </main>
  );
}
