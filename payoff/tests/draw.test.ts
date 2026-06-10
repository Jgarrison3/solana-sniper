import { describe, expect, it } from "vitest";
import {
  commitSeed,
  selectWinner,
  verifyDraw,
  type SnapshotEntry,
} from "../supabase/functions/_shared/engine/draw.ts";

const entries: SnapshotEntry[] = [
  { ticket_id: "t-aaa", member_id: "m1", qty: 10 },
  { ticket_id: "t-bbb", member_id: "m2", qty: 1 },
  { ticket_id: "t-ccc", member_id: "m1", qty: 39 },
  { ticket_id: "t-ddd", member_id: "m3", qty: 50 },
];

describe("selectWinner determinism", () => {
  it("returns the identical winner for the same seed and snapshot", async () => {
    const a = await selectWinner(entries, "seed-123");
    const b = await selectWinner(entries, "seed-123");
    expect(b).toEqual(a);
  });

  it("is independent of entry order (canonical snapshot)", async () => {
    const shuffled = [entries[2], entries[0], entries[3], entries[1]];
    const a = await selectWinner(entries, "seed-123");
    const b = await selectWinner(shuffled, "seed-123");
    expect(b).toEqual(a);
  });

  it("winning index always lands inside the ticket space", async () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const r = await selectWinner(entries, seed);
      expect(r.total_tickets).toBe(100);
      expect(r.winning_index).toBeGreaterThanOrEqual(0);
      expect(r.winning_index).toBeLessThan(100);
      expect(entries.map((e) => e.ticket_id)).toContain(r.winning_ticket_id);
    }
  });

  it("maps the winning index onto the correct entry's slot range", async () => {
    // canonical order: t-aaa [0,10), t-bbb [10,11), t-ccc [11,50), t-ddd [50,100)
    const r = await selectWinner(entries, "any-seed");
    const ranges: Record<string, [number, number]> = {
      "t-aaa": [0, 10],
      "t-bbb": [10, 11],
      "t-ccc": [11, 50],
      "t-ddd": [50, 100],
    };
    const [lo, hi] = ranges[r.winning_ticket_id];
    expect(r.winning_index).toBeGreaterThanOrEqual(lo);
    expect(r.winning_index).toBeLessThan(hi);
  });

  it("a single-entry snapshot always wins", async () => {
    const r = await selectWinner([{ ticket_id: "only", member_id: "m", qty: 3 }], "s");
    expect(r.winning_ticket_id).toBe("only");
  });

  it("varies across seeds (different members can win)", async () => {
    const winners = new Set<string>();
    for (let i = 0; i < 60; i++) {
      winners.add((await selectWinner(entries, `seed-${i}`)).winning_ticket_id);
    }
    expect(winners.size).toBeGreaterThan(1);
  });

  it("throws when there are no eligible tickets", async () => {
    await expect(selectWinner([], "seed")).rejects.toThrow(/no eligible tickets/i);
  });
});

describe("provable fairness", () => {
  it("verifyDraw accepts the published seed, commitment, and result", async () => {
    const seed = "super-secret-seed";
    const commitment = await commitSeed(seed);
    const result = await selectWinner(entries, seed);
    expect(await verifyDraw(entries, seed, commitment, result)).toBe(true);
  });

  it("verifyDraw rejects a seed that does not match the commitment", async () => {
    const commitment = await commitSeed("the-real-seed");
    const result = await selectWinner(entries, "a-different-seed");
    expect(await verifyDraw(entries, "a-different-seed", commitment, result)).toBe(false);
  });

  it("verifyDraw rejects a tampered winner", async () => {
    const seed = "seed";
    const commitment = await commitSeed(seed);
    const result = await selectWinner(entries, seed);
    const tampered = { ...result, winning_ticket_id: "t-bbb", winning_index: 10 };
    if (result.winning_ticket_id === "t-bbb") {
      tampered.winning_ticket_id = "t-aaa";
      tampered.winning_index = 0;
    }
    expect(await verifyDraw(entries, seed, commitment, tampered)).toBe(false);
  });
});
