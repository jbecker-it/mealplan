import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { db, DB_PATH } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readJson } from "@/lib/body";

export const dynamic = "force-dynamic";

// Kompletter Reset auf eine BLANKE Umgebung: alle Rezepte, Zutaten,
// Aliase, Tags, Schritte, Pläne und Einkaufslisten-Abhaken werden
// gelöscht — danach ist nichts mehr angelegt (keine Seed-Daten).
// Behalten bleiben: Profile (deine manuellen Makro-Ziele), das
// Passwort (settings.auth) und die aktuelle Session (Login bleibt).
// Sicherheitsbestätigung: Body muss { "confirm": "RESET" } enthalten.
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await readJson(req);
  if (body?.confirm !== "RESET")
    return Response.json(
      {
        ok: false,
        error: "Sicherheitsbestätigung fehlt — im Request body confirm='RESET' setzen.",
      },
      { status: 400 }
    );

  // Vor dem Löschen automatisch sichern, damit der Stand zurückholbar ist.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `pre-reset-${stamp}.db`);
  await db.backup(backupPath);

  // Aktuelle Session bleibt gültig (User bleibt nach dem Reset eingeloggt)
  const store = await cookies();
  const token = store.get("mp")?.value ?? null;

  db.transaction(() => {
    if (token) db.prepare("DELETE FROM session WHERE token != ?").run(token);
    else db.exec("DELETE FROM session");
    db.exec(`
      DELETE FROM plan_meal;
      DELETE FROM check_state;
      DELETE FROM recipe_tag;
      DELETE FROM recipe_ingredient;
      DELETE FROM step;
      DELETE FROM recipe;
      DELETE FROM tag;
      DELETE FROM alias;
      DELETE FROM ingredient;
    `);
  })();

  const recipes = (
    db.prepare("SELECT COUNT(*) AS c FROM recipe").get() as { c: number }
  ).c;
  const ingredients = (
    db.prepare("SELECT COUNT(*) AS c FROM ingredient").get() as { c: number }
  ).c;
  const profiles = (
    db.prepare("SELECT COUNT(*) AS c FROM profile").get() as { c: number }
  ).c;

  return Response.json({
    ok: true,
    backup: backupPath,
    recipes,
    ingredients,
    profiles,
    note: "Alles blank: alle Rezepte, Zutaten, Aliase, Tags, Pläne und Listen-Auswahl gelöscht (Profile mit deinen Makro-Zielen und Passwort bleiben erhalten). Der vorherige Stand wurde automatisch gesichert.",
  });
}
