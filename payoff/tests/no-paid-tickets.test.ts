// COMPLIANCE TEST — sweepstakes, never a lottery.
// Nothing purchasable may ever grant tickets. This test fails the build if
// any earning rule (in fixtures or in the SQL reference data) carries a
// requires_payment_to_app path, and asserts both the DB constraint and the
// engine guard exist.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeGrant } from "../supabase/functions/_shared/engine/rules.ts";
import { ComplianceError } from "../supabase/functions/_shared/engine/types.ts";
import { RULES } from "./fixtures.ts";

describe("no earning rule may require payment to the app", () => {
  it("every rule fixture has requires_payment_to_app = false", () => {
    for (const rule of Object.values(RULES)) {
      expect(rule.requires_payment_to_app, `rule ${rule.code}`).toBe(false);
    }
  });

  it("the engine refuses to grant for a pay-to-enter rule", () => {
    const poisoned = { ...RULES.daily_lesson, requires_payment_to_app: true };
    expect(() =>
      computeGrant(poisoned, { now: new Date(), priorGrants: [] }),
    ).toThrow(ComplianceError);
  });

  it("the database makes pay-to-enter rules unrepresentable (CHECK constraint)", () => {
    const schema = readFileSync(
      join(__dirname, "../supabase/migrations/20260610000100_schema.sql"),
      "utf8",
    );
    expect(schema).toMatch(
      /constraint no_pay_to_play check \(requires_payment_to_app = false\)/,
    );
  });

  it("the SQL reference data never sets requires_payment_to_app", () => {
    const refData = readFileSync(
      join(__dirname, "../supabase/migrations/20260610000300_reference_data.sql"),
      "utf8",
    );
    const insertBlock = refData.slice(refData.indexOf("insert into earning_rules"));
    expect(insertBlock).not.toMatch(/requires_payment_to_app/);
    expect(insertBlock).not.toMatch(/\btrue\b.*pay/i);
  });
});
