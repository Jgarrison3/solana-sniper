// Data-driven ticket grant engine. Given an earning rule row and the
// member's prior grants for that rule, decide how many tickets to grant.
// All caps live in the earning_rules table; nothing here is rule-specific
// except the unit semantics ("event" vs "dollars_extra").

import {
  ComplianceError,
  type EarningRule,
  type GrantContext,
  type GrantDecision,
  type PriorGrant,
} from "./types.ts";

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function dayKey(d: Date): string {
  return `${monthKey(d)}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function inMonth(grant: PriorGrant, now: Date): boolean {
  return monthKey(new Date(grant.created_at)) === monthKey(now);
}

function inDay(grant: PriorGrant, now: Date): boolean {
  return dayKey(new Date(grant.created_at)) === dayKey(now);
}

export function computeGrant(rule: EarningRule, ctx: GrantContext): GrantDecision {
  // Sweepstakes hard rule: entries may never be purchasable. This is
  // enforced three ways — a DB CHECK constraint, this guard, and a test.
  if (rule.requires_payment_to_app) {
    throw new ComplianceError(
      `Rule "${rule.code}" requires payment to the app; purchasable entries are forbidden.`,
    );
  }

  if (!rule.active) return { qty: 0, reason: "rule_inactive" };

  const priors = ctx.priorGrants;
  const priorsThisMonth = priors.filter((g) => inMonth(g, ctx.now));
  const priorsToday = priors.filter((g) => inDay(g, ctx.now));

  if (rule.once_per_debt) {
    if (!ctx.debtId) return { qty: 0, reason: "debt_required" };
    if (priors.some((g) => g.debt_id === ctx.debtId)) {
      return { qty: 0, reason: "already_granted_for_debt" };
    }
  }

  if (rule.max_debts != null) {
    const distinctDebts = new Set(
      priors.map((g) => g.debt_id).filter((id): id is string => !!id),
    );
    const isNewDebt = !ctx.debtId || !distinctDebts.has(ctx.debtId);
    if (isNewDebt && distinctDebts.size >= rule.max_debts) {
      return { qty: 0, reason: "max_debts_reached" };
    }
  }

  if (rule.max_per_day != null && priorsToday.length >= rule.max_per_day) {
    return { qty: 0, reason: "daily_cap_reached" };
  }

  if (rule.max_per_month != null && priorsThisMonth.length >= rule.max_per_month) {
    return { qty: 0, reason: "monthly_cap_reached" };
  }

  if (rule.max_per_debt_per_month != null) {
    if (!ctx.debtId) return { qty: 0, reason: "debt_required" };
    const debtEventsThisMonth = priorsThisMonth.filter((g) => g.debt_id === ctx.debtId);
    if (debtEventsThisMonth.length >= rule.max_per_debt_per_month) {
      return { qty: 0, reason: "debt_monthly_cap_reached" };
    }
  }

  let qty: number;
  if (rule.unit === "dollars_extra") {
    const extra = ctx.extraAmount ?? 0;
    const unitSize = rule.unit_size ?? 1;
    qty = Math.floor(extra / unitSize) * rule.base_tickets;
    if (qty <= 0) return { qty: 0, reason: "no_qualifying_amount" };
  } else {
    qty = rule.base_tickets;
  }

  if (rule.max_tickets_per_month != null) {
    const ticketsThisMonth = priorsThisMonth.reduce((sum, g) => sum + g.qty, 0);
    const remaining = rule.max_tickets_per_month - ticketsThisMonth;
    if (remaining <= 0) return { qty: 0, reason: "monthly_ticket_cap_reached" };
    if (qty > remaining) return { qty: remaining, reason: "capped_to_monthly_remainder" };
  }

  return { qty };
}
