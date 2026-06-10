// In-memory model of the ticket ledger with the same append-only contract
// the database enforces via trigger (see 20260610000100_schema.sql).
// Used by the engine tests; edge functions write to Postgres directly.

import type { LedgerEntry } from "./types.ts";

export class AppendOnlyLedger {
  #rows: ReadonlyArray<Readonly<LedgerEntry>> = [];

  append(entry: LedgerEntry): Readonly<LedgerEntry> {
    if (entry.qty <= 0) throw new Error("ledger qty must be positive");
    const frozen = Object.freeze({
      ...entry,
      metadata: Object.freeze({ ...entry.metadata }),
    });
    this.#rows = Object.freeze([...this.#rows, frozen]);
    return frozen;
  }

  /** Rows are frozen; there is deliberately no update or delete API. */
  get rows(): ReadonlyArray<Readonly<LedgerEntry>> {
    return this.#rows;
  }

  totalFor(memberId: string, drawingId?: string): number {
    return this.#rows
      .filter(
        (r) =>
          r.member_id === memberId &&
          (drawingId === undefined || r.drawing_id === drawingId),
      )
      .reduce((sum, r) => sum + r.qty, 0);
  }
}
