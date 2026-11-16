import fs from "node:fs";
import path from "node:path";
import { db, DB_PATH } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const c = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const counts = {
    recipes: c("SELECT COUNT(*) AS c FROM recipe"),
    ingredients: c("SELECT COUNT(*) AS c FROM ingredient"),
    aliases: c("SELECT COUNT(*) AS c FROM alias"),
    profiles: c("SELECT COUNT(*) AS c FROM profile"),
    planMeals: c("SELECT COUNT(*) AS c FROM plan_meal"),
  };

  let dbSize = 0;
  try {
    dbSize = fs.statSync(DB_PATH).size;
  } catch {
    // ignorieren
  }

  let lastBackup: { name: string; size: number; mtime: string } | null = null;
  try {
    const dir = path.join(path.dirname(DB_PATH), "backups");
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".db"))
      .sort();
    if (files.length) {
      const name = files[files.length - 1];
      const st = fs.statSync(path.join(dir, name));
      lastBackup = { name, size: st.size, mtime: st.mtime.toISOString() };
    }
  } catch {
    // kein Backup-Verzeichnis
  }

  return Response.json({ ok: true, counts, dbSize, lastBackup });
}
