import { describe, expect, it } from "vitest";
import {
  detectMilestones,
  percentPaid,
} from "../supabase/functions/_shared/engine/milestones.ts";

describe("percentPaid", () => {
  it("computes percent of original balance paid", () => {
    expect(percentPaid(1000, 750)).toBe(25);
    expect(percentPaid(1000, 0)).toBe(100);
    expect(percentPaid(1000, 1000)).toBe(0);
  });

  it("clamps to 0..100 and handles zero original balance", () => {
    expect(percentPaid(0, 0)).toBe(0);
    expect(percentPaid(1000, 1200)).toBe(0); // balance grew (interest) — no negative progress
    expect(percentPaid(1000, -50)).toBe(100);
  });
});

describe("detectMilestones", () => {
  it("detects a single newly crossed milestone", () => {
    expect(detectMilestones(1000, 740, [])).toEqual(["milestone_25"]);
  });

  it("returns nothing before 25%", () => {
    expect(detectMilestones(1000, 800, [])).toEqual([]);
  });

  it("excludes milestones already granted", () => {
    expect(detectMilestones(1000, 740, ["milestone_25"])).toEqual([]);
  });

  it("returns every milestone crossed by a big payment at once", () => {
    // 20% paid → 100% paid in one payment
    expect(detectMilestones(1000, 0, [])).toEqual([
      "milestone_25",
      "milestone_50",
      "milestone_75",
      "milestone_100",
    ]);
  });

  it("grants each milestone exactly once across the life of a debt", () => {
    const granted: string[] = [];
    // payment 1: down to 60% remaining → 25 crossed
    granted.push(...detectMilestones(1000, 600, granted));
    expect(granted).toEqual(["milestone_25"]);
    // payment 2: down to 30% remaining → 50 crossed (25 not re-granted)
    granted.push(...detectMilestones(1000, 300, granted));
    expect(granted).toEqual(["milestone_25", "milestone_50"]);
    // payment 3: paid off → 75 and 100 crossed
    granted.push(...detectMilestones(1000, 0, granted));
    expect(granted).toEqual([
      "milestone_25",
      "milestone_50",
      "milestone_75",
      "milestone_100",
    ]);
  });

  it("exact threshold counts as crossed", () => {
    expect(detectMilestones(1000, 750, [])).toEqual(["milestone_25"]);
  });
});
