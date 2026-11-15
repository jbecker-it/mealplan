import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  checkPassword,
  isAuthed,
  isSetup,
  issueSession,
  setupPassword,
} from "@/lib/auth";
import { readJson, badJson } from "@/lib/body";

export async function GET() {
  const store = await cookies();
  return NextResponse.json({
    setup: isSetup(),
    authed: isAuthed(store.get("mp")?.value),
  });
}

export async function POST(req: NextRequest) {
  const raw = await readJson(req);
  if (raw === null) return badJson;
  const { password } = raw as { password?: string };
  if (!password || password.length < 4)
    return NextResponse.json({ error: "Passwort zu kurz (min. 4 Zeichen)" }, { status: 400 });
  if (!isSetup()) {
    setupPassword(password);
  } else if (!checkPassword(password)) {
    return NextResponse.json({ error: "Falsches Passwort" }, { status: 401 });
  }
  const token = issueSession();
  const store = await cookies();
  store.set("mp", token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 30 * 86400,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const store = await cookies();
  store.delete("mp");
  return NextResponse.json({ ok: true });
}
