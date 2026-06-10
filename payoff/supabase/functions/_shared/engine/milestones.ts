// Milestone detection: 25/50/75/100% of a debt paid.
// Rule codes mirror the earning_rules reference data.

export const MILESTONES = [
  { pct: 25, code: "milestone_25" },
  { pct: 50, code: "milestone_50" },
  { pct: 75, code: "milestone_75" },
  { pct: 100, code: "milestone_100" },
] as const;

export type MilestoneCode = (typeof MILESTONES)[number]["code"];

export function percentPaid(originalBalance: number, currentBalance: number): number {
  if (originalBalance <= 0) return 0;
  const paid = originalBalance - currentBalance;
  return Math.max(0, Math.min(100, (paid / originalBalance) * 100));
}

/**
 * Milestone codes newly crossed for a debt, excluding ones already granted.
 * Crossing several at once (e.g. a payoff jumping 20% → 100%) returns all of
 * them so each milestone is granted exactly once over the life of a debt.
 */
export function detectMilestones(
  originalBalance: number,
  currentBalance: number,
  alreadyGranted: Iterable<string>,
): MilestoneCode[] {
  const granted = new Set(alreadyGranted);
  const pct = percentPaid(originalBalance, currentBalance);
  return MILESTONES.filter((m) => pct >= m.pct && !granted.has(m.code)).map(
    (m) => m.code,
  );
}
