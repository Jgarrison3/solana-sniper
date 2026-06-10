// Rule fixtures mirroring supabase/migrations/20260610000300_reference_data.sql.
// If you change the economy there, update these to match — the tests assert
// engine behavior against the same numbers members see.

import type { EarningRule } from "../supabase/functions/_shared/engine/types.ts";

const base = {
  description: "",
  unit: "event" as const,
  unit_size: null,
  max_per_day: null,
  max_per_month: null,
  max_per_debt_per_month: null,
  max_tickets_per_month: null,
  once_per_debt: false,
  max_debts: null,
  active: true,
  requires_payment_to_app: false,
  config: {},
};

export const RULES: Record<string, EarningRule> = {
  debt_linked: {
    ...base,
    id: "r-debt-linked",
    code: "debt_linked",
    name: "Add a debt",
    base_tickets: 5,
    once_per_debt: true,
    max_debts: 5,
  },
  on_time_payment: {
    ...base,
    id: "r-on-time",
    code: "on_time_payment",
    name: "On-time payment",
    base_tickets: 10,
    max_per_debt_per_month: 1,
  },
  extra_payment: {
    ...base,
    id: "r-extra",
    code: "extra_payment",
    name: "Extra payment",
    base_tickets: 1,
    unit: "dollars_extra",
    unit_size: 10,
    max_tickets_per_month: 50,
  },
  milestone_25: {
    ...base,
    id: "r-m25",
    code: "milestone_25",
    name: "25% paid off",
    base_tickets: 100,
    once_per_debt: true,
  },
  milestone_100: {
    ...base,
    id: "r-m100",
    code: "milestone_100",
    name: "Debt paid off!",
    base_tickets: 500,
    once_per_debt: true,
  },
  daily_lesson: {
    ...base,
    id: "r-lesson",
    code: "daily_lesson",
    name: "Daily lesson",
    base_tickets: 3,
    max_per_day: 1,
  },
  amoe: {
    ...base,
    id: "r-amoe",
    code: "amoe",
    name: "Free entry",
    base_tickets: 5,
    max_per_month: 1,
  },
  streak_3mo: {
    ...base,
    id: "r-streak",
    code: "streak_3mo",
    name: "3-month streak",
    base_tickets: 50,
    config: { streak_months: 3 },
  },
};
