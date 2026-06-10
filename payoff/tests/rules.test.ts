import { describe, expect, it } from "vitest";
import { computeGrant } from "../supabase/functions/_shared/engine/rules.ts";
import type { PriorGrant } from "../supabase/functions/_shared/engine/types.ts";
import { RULES } from "./fixtures.ts";

const NOW = new Date("2026-06-10T12:00:00Z");
const thisMonth = (debt_id?: string, qty = 1): PriorGrant => ({
  qty,
  created_at: "2026-06-05T08:00:00Z",
  debt_id,
});
const lastMonth = (debt_id?: string, qty = 1): PriorGrant => ({
  qty,
  created_at: "2026-05-20T08:00:00Z",
  debt_id,
});

describe("debt_linked: 5 tickets, once per debt, max 5 debts", () => {
  it("grants 5 for a new debt", () => {
    expect(computeGrant(RULES.debt_linked, { now: NOW, debtId: "d1", priorGrants: [] }))
      .toEqual({ qty: 5 });
  });

  it("does not grant twice for the same debt", () => {
    const res = computeGrant(RULES.debt_linked, {
      now: NOW,
      debtId: "d1",
      priorGrants: [lastMonth("d1")],
    });
    expect(res.qty).toBe(0);
    expect(res.reason).toBe("already_granted_for_debt");
  });

  it("stops at 5 debts", () => {
    const priors = ["d1", "d2", "d3", "d4", "d5"].map((d) => lastMonth(d));
    const res = computeGrant(RULES.debt_linked, { now: NOW, debtId: "d6", priorGrants: priors });
    expect(res.qty).toBe(0);
    expect(res.reason).toBe("max_debts_reached");
  });
});

describe("on_time_payment: 10 tickets, max 1 per debt per month", () => {
  it("grants 10 on first on-time payment of the month", () => {
    expect(computeGrant(RULES.on_time_payment, { now: NOW, debtId: "d1", priorGrants: [] }))
      .toEqual({ qty: 10 });
  });

  it("blocks a second grant for the same debt in the same month", () => {
    const res = computeGrant(RULES.on_time_payment, {
      now: NOW,
      debtId: "d1",
      priorGrants: [thisMonth("d1", 10)],
    });
    expect(res.qty).toBe(0);
    expect(res.reason).toBe("debt_monthly_cap_reached");
  });

  it("still grants for a different debt in the same month", () => {
    const res = computeGrant(RULES.on_time_payment, {
      now: NOW,
      debtId: "d2",
      priorGrants: [thisMonth("d1", 10)],
    });
    expect(res.qty).toBe(10);
  });

  it("resets across months", () => {
    const res = computeGrant(RULES.on_time_payment, {
      now: NOW,
      debtId: "d1",
      priorGrants: [lastMonth("d1", 10)],
    });
    expect(res.qty).toBe(10);
  });
});

describe("extra_payment: 1 ticket per $10 extra, capped at 50/month", () => {
  it("floors to whole $10 units", () => {
    expect(
      computeGrant(RULES.extra_payment, { now: NOW, debtId: "d1", extraAmount: 47, priorGrants: [] }).qty,
    ).toBe(4);
  });

  it("grants nothing under $10 extra", () => {
    const res = computeGrant(RULES.extra_payment, {
      now: NOW, debtId: "d1", extraAmount: 9.99, priorGrants: [],
    });
    expect(res.qty).toBe(0);
    expect(res.reason).toBe("no_qualifying_amount");
  });

  it("caps the month at 50 tickets total", () => {
    const res = computeGrant(RULES.extra_payment, {
      now: NOW,
      debtId: "d1",
      extraAmount: 1000, // would be 100 tickets uncapped
      priorGrants: [thisMonth("d1", 30)],
    });
    expect(res.qty).toBe(20);
    expect(res.reason).toBe("capped_to_monthly_remainder");
  });

  it("grants zero once the monthly cap is exhausted", () => {
    const res = computeGrant(RULES.extra_payment, {
      now: NOW,
      debtId: "d1",
      extraAmount: 500,
      priorGrants: [thisMonth("d1", 50)],
    });
    expect(res.qty).toBe(0);
    expect(res.reason).toBe("monthly_ticket_cap_reached");
  });

  it("cap resets the next month", () => {
    const res = computeGrant(RULES.extra_payment, {
      now: NOW,
      debtId: "d1",
      extraAmount: 100,
      priorGrants: [lastMonth("d1", 50)],
    });
    expect(res.qty).toBe(10);
  });
});

describe("daily_lesson: 3 tickets, max 1/day", () => {
  it("grants 3 on the first lesson of the day", () => {
    expect(computeGrant(RULES.daily_lesson, { now: NOW, priorGrants: [] }).qty).toBe(3);
  });

  it("blocks a second lesson the same day", () => {
    const res = computeGrant(RULES.daily_lesson, {
      now: NOW,
      priorGrants: [{ qty: 3, created_at: "2026-06-10T01:00:00Z" }],
    });
    expect(res.qty).toBe(0);
    expect(res.reason).toBe("daily_cap_reached");
  });

  it("grants again the next day", () => {
    const res = computeGrant(RULES.daily_lesson, {
      now: NOW,
      priorGrants: [{ qty: 3, created_at: "2026-06-09T23:59:00Z" }],
    });
    expect(res.qty).toBe(3);
  });
});

describe("amoe: 5 tickets, max 1/month", () => {
  it("grants 5 once per month", () => {
    expect(computeGrant(RULES.amoe, { now: NOW, priorGrants: [] }).qty).toBe(5);
    const res = computeGrant(RULES.amoe, { now: NOW, priorGrants: [thisMonth(undefined, 5)] });
    expect(res.qty).toBe(0);
    expect(res.reason).toBe("monthly_cap_reached");
  });
});

describe("inactive rules", () => {
  it("never grant", () => {
    const res = computeGrant({ ...RULES.daily_lesson, active: false }, { now: NOW, priorGrants: [] });
    expect(res.qty).toBe(0);
    expect(res.reason).toBe("rule_inactive");
  });
});
