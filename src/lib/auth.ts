// Einfache App-Passwort-Auth (1 Haushalt) + Server-Sessions
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "./db";

// Sessions liegen in der DB (Nicht in-memory): Das Root-Layout läuft in
// einem separaten Modul-Kontext von den API-Routen — in-memory-State
// (Map) ist dort nie sichtbar. DB-Datei wird dagegen von beiden geteilt.
const SESSION_TTL = 30 * 86400 * 1000; // 30 Tage

const insSession = db.prepare(
  "INSERT INTO session (token, expiry) VALUES (?, ?)"
);
const selSession = db.prepare(
  "SELECT expiry FROM session WHERE token = ?"
);
const delSession = db.prepare("DELETE FROM session WHERE token = ?");

export function issueSession(): string {
  const token = crypto.randomBytes(24).toString("hex");
  insSession.run(token, Date.now() + SESSION_TTL);
  return token;
}

export function isAuthed(token?: string | null): boolean {
  if (!token) return false;
  const row = selSession.get(token) as { expiry: number } | undefined;
  if (!row) return false;
  if (row.expiry < Date.now()) {
    delSession.run(token);
    return false;
  }
  return true;
}

export function deleteSession(token: string | null | undefined): void {
  if (token) delSession.run(token);
}

export function isSetup(): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'auth'").get() as
    | { value: string | null }
    | undefined;
  return !!row && typeof row.value === "string" && row.value.length > 0;
}

function scrypt(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export function setupPassword(password: string): void {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = scrypt(password, salt);
  const upsert = db.prepare(
    "INSERT INTO settings(key, value) VALUES ('auth', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  upsert.run(JSON.stringify({ salt, hash }));
}

export function checkPassword(password: string): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'auth'").get() as
    | { value: string | null }
    | undefined;
  if (!row || !row.value) return false;
  let data: { salt?: string; hash?: string };
  try {
    data = JSON.parse(row.value);
  } catch {
    return false;
  }
  if (!data.salt || !data.hash) return false;
  const { salt, hash } = data;
  const got = scrypt(password, salt);
  return got.length === hash.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(hash));
}

export async function requireAuth(): Promise<NextResponse | null> {
  const store = await cookies();
  const token = store.get("mp")?.value;
  if (!isAuthed(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
