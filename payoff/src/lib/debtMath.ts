// Amortization math for payoff projections. Pure functions, monthly
// compounding, simulated month by month (handles the final partial month).

export interface PayoffProjection {
  months: number;
  totalInterest: number;
  payoffDate: Date;
}

/**
 * Project payoff given a fixed monthly payment.
 * Returns null when the payment doesn't cover monthly interest (never pays off).
 */
export function projectPayoff(
  balance: number,
  aprPct: number,
  monthlyPayment: number,
  from: Date = new Date(),
): PayoffProjection | null {
  if (balance <= 0) {
    return { months: 0, totalInterest: 0, payoffDate: from };
  }
  if (monthlyPayment <= 0) return null;

  const r = aprPct / 100 / 12;
  if (r > 0 && monthlyPayment <= balance * r) return null;

  let bal = balance;
  let totalInterest = 0;
  let months = 0;
  const HARD_STOP = 1200; // 100 years — guards float edge cases

  while (bal > 0.005 && months < HARD_STOP) {
    const interest = bal * r;
    totalInterest += interest;
    bal = bal + interest - monthlyPayment;
    months += 1;
  }
  if (months >= HARD_STOP) return null;

  const payoffDate = new Date(from);
  payoffDate.setMonth(payoffDate.getMonth() + months);
  return { months, totalInterest, payoffDate };
}

/** Interest saved by paying `statedPayment` instead of the minimum. */
export function interestSavedVsMinimum(
  balance: number,
  aprPct: number,
  minimumPayment: number,
  statedPayment: number,
): number | null {
  const atMin = projectPayoff(balance, aprPct, minimumPayment);
  const atStated = projectPayoff(balance, aprPct, statedPayment);
  if (!atMin || !atStated) return null;
  return Math.max(0, atMin.totalInterest - atStated.totalInterest);
}

export function percentPaid(original: number | null, current: number): number {
  if (!original || original <= 0) return 0;
  return Math.max(0, Math.min(100, ((original - current) / original) * 100));
}
