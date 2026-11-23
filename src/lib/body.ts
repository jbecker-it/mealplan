import { NextResponse, type NextRequest } from "next/server";

/**
 * JSON-Body sicher lesen: ungültiges JSON liefert null (→ 400) statt
 * einen unhandled SyntaxError zu werfen, der den Node-Prozess abwürgt.
 */
export async function readJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (!text.trim()) return {};
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return null;
  }
}

// Funktion statt Konstante: eine Response darf nur EINMAL zurückgegeben
// werden (der Body-Stream ist danach verbraucht).
export const badJson = () =>
  NextResponse.json({ error: "Ungültiges JSON" }, { status: 400 });
