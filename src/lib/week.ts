// ISO-Wochen-Helper: "2026-W46". Template A/B ist NICHT mehr wochenabhängig —
// beide Templates liegen in derselben Woche, das aktive Template wählt die UI
// (persistiert in settings.active_template, s. db.ts).
export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function currentWeekKey(now = new Date()): string {
  return isoWeekKey(now);
}

export function weekNum(weekKey: string): number {
  return parseInt(weekKey.split("-W")[1] || "1", 10);
}

export function shiftWeek(weekKey: string, delta: number): string {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(weekKey);
  if (!m) return weekKey;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const d = new Date(jan4.getTime());
  d.setUTCDate(d.getUTCDate() + (1 - (d.getUTCDay() || 7))); // Montag Woche 1
  d.setUTCDate(d.getUTCDate() + (week - 1 + delta) * 7);
  return isoWeekKey(d);
}

export const DOW_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
