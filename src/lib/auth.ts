// Einfache App-Passwort-Auth (1 Haushalt) + Server-Sessions
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "./db";

const sessions = new Map<string, number>(); // token -> expiry

export function isSetup(): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'auth'").get() as
    | { value: string }
    | undefined;
  return !!row;
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
    | { value: string }
    | undefined;
  if (!row) return false;
  const { salt, hash } = JSON.parse(row.value) as { salt: string; hash: string };
  const got = scrypt(password, salt);
  return got.length === hash.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(hash));
}

export function issueSession(): string {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + 30 * 86400 * 1000);
  return token;
}

export function isAuthed(token?: string | null): boolean {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export async function requireAuth(): Promise<NextResponse | null> {
  const store = await cookies();
  const token = store.get("mp")?.value;
  if (!isAuthed(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
