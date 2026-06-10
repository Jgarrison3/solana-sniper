// Shared domain types for the Pay Off ticket + drawing engine.
// This module is pure TypeScript (no Deno- or Node-specific APIs) so it
// runs identically in Supabase Edge Functions and in the vitest suite.

export type RuleUnit = "event" | "dollars_extra";

export interface EarningRule {
  id: string;
  code: string;
  name: string;
  description: string;
  base_tickets: number;
  unit: RuleUnit;
  /** For unit === "dollars_extra": dollars per base_tickets grant (e.g. $10 → 1 ticket). */
  unit_size: number | null;
  max_per_day: number | null;
  max_per_month: number | null;
  max_per_debt_per_month: number | null;
  /** Cap on total tickets (not events) granted by this rule per calendar month. */
  max_tickets_per_month: number | null;
  once_per_debt: boolean;
  max_debts: number | null;
  active: boolean;
  /** HARD COMPLIANCE RULE: must always be false. The engine throws if true. */
  requires_payment_to_app: boolean;
  config: Record<string, unknown>;
}

/** A prior ledger grant for the same member + rule, as the engine needs it. */
export interface PriorGrant {
  qty: number;
  /** ISO timestamp of the grant. */
  created_at: string;
  /** Debt the grant related to, when applicable (from ledger metadata). */
  debt_id?: string | null;
}

export interface GrantContext {
  now: Date;
  debtId?: string;
  /** Dollars paid above the minimum payment (extra_payment rule). */
  extraAmount?: number;
  /** This member's existing ledger entries for THIS rule. */
  priorGrants: PriorGrant[];
}

export interface GrantDecision {
  /** Tickets to grant; 0 means a cap or eligibility check blocked it. */
  qty: number;
  /** Machine-readable reason when qty is 0 or reduced. */
  reason?: string;
}

export interface LedgerEntry {
  id: string;
  member_id: string;
  rule_id: string;
  qty: number;
  drawing_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export class ComplianceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComplianceError";
  }
}
