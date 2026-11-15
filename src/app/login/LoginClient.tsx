"use client";

import { useEffect, useState } from "react";

export default function LoginClient() {
  const [setup, setSetup] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (d.authed) window.location.href = "/plan";
        setSetup(!!d.setup);
      });
  }, []);

  async function submit() {
    setErr("");
    setBusy(true);
    if (setup === false && pw !== pw2) {
      setErr("Passwörter stimmen nicht überein");
      setBusy(false);
      return;
    }
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (r.ok) window.location.href = "/plan";
    else {
      const d = await r.json().catch(() => ({}));
      setErr(d.error || "Fehler");
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-8">
        <h1 className="mb-1 text-2xl font-bold text-accent">Mealplan</h1>
        <p className="mb-6 text-sm text-muted">
          {setup === false ? "Erstmaliges Einrichten — App-Passwort wählen:" : "App-Passwort"}
        </p>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Passwort"
          className="mb-3 w-full rounded-lg border border-line bg-background px-3 py-2 outline-none focus:border-accent"
        />
        {setup === false && (
          <input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Wiederholen"
            className="mb-3 w-full rounded-lg border border-line bg-background px-3 py-2 outline-none focus:border-accent"
          />
        )}
        {err && <p className="mb-3 text-sm text-danger">{err}</p>}
        <button
          onClick={submit}
          disabled={busy || !pw}
          className="w-full rounded-lg bg-accent px-4 py-2 font-semibold text-background transition hover:opacity-90 disabled:opacity-40"
        >
          {setup === false ? "Einrichten & Anmelden" : "Anmelden"}
        </button>
      </div>
    </div>
  );
}
