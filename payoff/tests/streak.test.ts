import { describe, expect, it } from "vitest";
import {
  canGrantStreak,
  hasOnTimeStreak,
  monthKeyBefore,
} from "../supabase/functions/_shared/engine/streak.ts";

const ASOF = new Date("2026-06-15T12:00:00Z");
const pay = (date: string, on_time = true) => ({ paid_at: date, on_time });

describe("hasOnTimeStreak", () => {
  it("true for 3 consecutive on-time months", () => {
    const payments = [pay("2026-04-05"), pay("2026-05-05"), pay("2026-06-05")];
    expect(hasOnTimeStreak(payments, ASOF)).toBe(true);
  });

  it("false when a month has no payments", () => {
    const payments = [pay("2026-04-05"), pay("2026-06-05")];
    expect(hasOnTimeStreak(payments, ASOF)).toBe(false);
  });

  it("false when any payment in the window was late", () => {
    const payments = [pay("2026-04-05"), pay("2026-05-05", false), pay("2026-06-05")];
    expect(hasOnTimeStreak(payments, ASOF)).toBe(false);
  });

  it("handles year boundaries", () => {
    const janAsOf = new Date("2026-01-20T00:00:00Z");
    const payments = [pay("2025-11-10"), pay("2025-12-10"), pay("2026-01-10")];
    expect(hasOnTimeStreak(payments, janAsOf)).toBe(true);
  });
});

describe("canGrantStreak — once per 3-month window", () => {
  it("grants when there is no prior streak grant", () => {
    expect(canGrantStreak([], "2026-06")).toBe(true);
  });

  it("blocks a re-grant within 3 months of the last streak end", () => {
    expect(canGrantStreak(["2026-05"], "2026-06")).toBe(false);
    expect(canGrantStreak(["2026-04"], "2026-06")).toBe(false);
  });

  it("allows a new streak 3+ months after the last one", () => {
    expect(canGrantStreak(["2026-03"], "2026-06")).toBe(true);
  });
});

describe("monthKeyBefore", () => {
  it("walks back across years", () => {
    expect(monthKeyBefore(new Date("2026-01-15T00:00:00Z"), 2)).toBe("2025-11");
  });
});
