import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppendOnlyLedger } from "../supabase/functions/_shared/engine/ledger.ts";
import type { LedgerEntry } from "../supabase/functions/_shared/engine/types.ts";

const entry = (id: string, qty = 5): LedgerEntry => ({
  id,
  member_id: "m1",
  rule_id: "r1",
  qty,
  drawing_id: null,
  metadata: { debt_id: "d1" },
  created_at: new Date().toISOString(),
});

describe("AppendOnlyLedger (in-memory model)", () => {
  it("appends and totals", () => {
    const ledger = new AppendOnlyLedger();
    ledger.append(entry("a", 5));
    ledger.append(entry("b", 10));
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.totalFor("m1")).toBe(15);
  });

  it("rejects non-positive quantities", () => {
    const ledger = new AppendOnlyLedger();
    expect(() => ledger.append(entry("a", 0))).toThrow(/positive/);
    expect(() => ledger.append(entry("a", -3))).toThrow(/positive/);
  });

  it("exposes no update or delete API", () => {
    const ledger = new AppendOnlyLedger() as unknown as Record<string, unknown>;
    expect(ledger.update).toBeUndefined();
    expect(ledger.delete).toBeUndefined();
    expect(ledger.remove).toBeUndefined();
  });

  it("freezes rows — mutation attempts throw or are ignored", () => {
    const ledger = new AppendOnlyLedger();
    const row = ledger.append(entry("a", 5));
    expect(() => {
      (row as { qty: number }).qty = 999;
    }).toThrow();
    expect(() => {
      (ledger.rows as LedgerEntry[]).pop();
    }).toThrow();
    expect(ledger.rows[0].qty).toBe(5);
  });
});

describe("database enforces the same contract", () => {
  const schema = readFileSync(
    join(__dirname, "../supabase/migrations/20260610000100_schema.sql"),
    "utf8",
  );

  it("ticket_ledger has an append-only trigger for UPDATE and DELETE", () => {
    expect(schema).toMatch(
      /create trigger ticket_ledger_append_only\s+before update or delete on ticket_ledger/,
    );
    expect(schema).toContain("raise_append_only");
  });

  it("audit_log is append-only too", () => {
    expect(schema).toMatch(
      /create trigger audit_log_append_only\s+before update or delete on audit_log/,
    );
  });

  it("ledger quantities must be positive at the DB level", () => {
    expect(schema).toMatch(/qty\s+integer not null check \(qty > 0\)/);
  });
});
