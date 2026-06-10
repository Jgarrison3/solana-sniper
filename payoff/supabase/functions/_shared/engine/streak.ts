// Streak bonus: 3 consecutive months in which every logged payment was
// on time (and at least one payment was logged each month).

import { monthKey } from "./rules.ts";

export interface StreakPayment {
  paid_at: string; // ISO date
  on_time: boolean;
}

/** "YYYY-MM" for the month `offset` months before `asOf` (0 = current). */
export function monthKeyBefore(asOf: Date, offset: number): string {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - offset, 1));
  return monthKey(d);
}

function monthIndex(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
}

/**
 * True when the `span` consecutive months ending at `asOf`'s month each have
 * at least one payment and zero late payments.
 */
export function hasOnTimeStreak(
  payments: StreakPayment[],
  asOf: Date,
  span = 3,
): boolean {
  const byMonth = new Map<string, { count: number; allOnTime: boolean }>();
  for (const p of payments) {
    const key = monthKey(new Date(p.paid_at));
    const cur = byMonth.get(key) ?? { count: 0, allOnTime: true };
    cur.count += 1;
    cur.allOnTime = cur.allOnTime && p.on_time;
    byMonth.set(key, cur);
  }
  for (let i = 0; i < span; i++) {
    const m = byMonth.get(monthKeyBefore(asOf, i));
    if (!m || m.count === 0 || !m.allOnTime) return false;
  }
  return true;
}

/**
 * A streak bonus may be granted at most once per `span` months: the previous
 * streak grant must have ended at least `span` months before this one.
 * `priorStreakEndMonths` comes from ledger metadata (streak_end_month).
 */
export function canGrantStreak(
  priorStreakEndMonths: string[],
  endMonth: string,
  span = 3,
): boolean {
  const end = monthIndex(endMonth);
  return priorStreakEndMonths.every((m) => end - monthIndex(m) >= span);
}
