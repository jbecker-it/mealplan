import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Download der aktuellen Datenbank (konsistente Kopie über db.backup,
// sicher auch bei laufenden Schreibzugriffen).
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `mealplan-backup-${stamp}.db`;
  const tmp = path.join(os.tmpdir(), name);
  await db.backup(tmp);

  const stream = fs.createReadStream(tmp);
  stream.on("close", () => {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignorieren
    }
  });

  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
