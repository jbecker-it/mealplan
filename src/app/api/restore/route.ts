import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { db, DB_PATH, closeDb } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Upload einer .db-Datei (Feld: file) → Validierung → Sicherheitsbackup
// des aktuellen Stands → Datei-Tausch → DB-Handle wird beim nächsten
// Zugriff automatisch neu geöffnet.
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { ok: false, error: "Kein gültiges Formular (multipart) erhalten." },
      { status: 400 }
    );
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0)
    return Response.json(
      { ok: false, error: "Keine Datei erhalten (Feldname: file)." },
      { status: 400 }
    );

  const buf = Buffer.from(await file.arrayBuffer());
  if (
    buf.length < 512 ||
    !buf.subarray(0, 15).toString("latin1").startsWith("SQLite format 3")
  )
    return Response.json(
      { ok: false, error: "Die Datei ist keine SQLite-Datenbank (Header fehlt)." },
      { status: 400 }
    );

  const incoming = path.join(path.dirname(DB_PATH), `incoming-${Date.now()}.db`);
  fs.writeFileSync(incoming, buf);

  const validate = (): string | null => {
    let v: InstanceType<typeof Database> | null = null;
    try {
      v = new Database(incoming, { readonly: true, fileMustExist: true });
      if (v.pragma("integrity_check", { simple: true }) !== "ok")
        return "Integritätscheck der Datei ist fehlgeschlagen.";
      const tables = new Set(
        (
          v
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .all() as { name: string }[]
        ).map((r) => r.name)
      );
      const missing = [
        "profile",
        "recipe",
        "ingredient",
        "plan_meal",
        "settings",
      ].filter((t) => !tables.has(t));
      if (missing.length)
        return `Fehlende Tabellen: ${missing.join(", ")} — keine Mealplan-Datenbank.`;
      return null;
    } catch (e) {
      return `Datei konnte nicht gelesen werden: ${(e as Error).message}`;
    } finally {
      try {
        v?.close();
      } catch {
        // ignorieren
      }
    }
  };

  const err = validate();
  if (err) {
    try {
      fs.unlinkSync(incoming);
    } catch {
      // ignorieren
    }
    return Response.json({ ok: false, error: err }, { status: 400 });
  }

  // Sicherheitsbackup des aktuellen Stands
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `pre-restore-${stamp}.db`);
  await db.backup(backupPath);

  // Live-Handle schließen, Datei tauschen
  closeDb();
  for (const sfx of ["-wal", "-shm"]) {
    try {
      fs.unlinkSync(DB_PATH + sfx);
    } catch {
      // ignorieren
    }
  }
  fs.renameSync(incoming, DB_PATH);
  for (const sfx of ["-wal", "-shm"]) {
    try {
      fs.unlinkSync(DB_PATH + sfx);
    } catch {
      // ignorieren
    }
  }

  return Response.json({
    ok: true,
    backup: backupPath,
    note: "Wiederherstellung abgeschlossen. Der vorherige Stand wurde automatisch gesichert.",
  });
}
