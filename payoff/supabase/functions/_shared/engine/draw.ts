// Provably fair drawing engine.
//
// Protocol:
//  1. At drawing creation the server generates a random seed and publishes
//     only its SHA-256 commitment (rng_seed_commitment).
//  2. At close, eligible ledger entries are snapshotted and canonically
//     hashed (snapshot_hash).
//  3. winning_index = SHA256(seed + ":" + snapshot_hash) mod total_tickets.
//     Each ticket in each ledger entry is one slot, ordered by ticket id.
//  4. After the draw the seed is revealed; anyone can recompute the result
//     and check the commitment. `verifyDraw` does exactly that.

import { sha256Hex } from "./crypto.ts";

export interface SnapshotEntry {
  ticket_id: string;
  member_id: string;
  qty: number;
}

export interface DrawResult {
  winning_ticket_id: string;
  member_id: string;
  winning_index: number;
  total_tickets: number;
  snapshot_hash: string;
  algorithm: string;
}

export const DRAW_ALGORITHM = "sha256(seed:snapshot_hash) mod total_tickets, entries ordered by ticket_id";

export function commitSeed(seed: string): Promise<string> {
  return sha256Hex(seed);
}

function canonical(entries: SnapshotEntry[]): SnapshotEntry[] {
  return [...entries].sort((a, b) => (a.ticket_id < b.ticket_id ? -1 : 1));
}

export function snapshotHash(entries: SnapshotEntry[]): Promise<string> {
  const canon = canonical(entries).map((e) => [e.ticket_id, e.qty]);
  return sha256Hex(JSON.stringify(canon));
}

export async function selectWinner(
  entries: SnapshotEntry[],
  seed: string,
): Promise<DrawResult> {
  const canon = canonical(entries).filter((e) => e.qty > 0);
  const total = canon.reduce((sum, e) => sum + e.qty, 0);
  if (total <= 0) throw new Error("No eligible tickets in drawing snapshot");

  const snapHash = await snapshotHash(entries);
  const h = await sha256Hex(`${seed}:${snapHash}`);
  const winningIndex = Number(BigInt(`0x${h}`) % BigInt(total));

  let cursor = 0;
  for (const entry of canon) {
    cursor += entry.qty;
    if (winningIndex < cursor) {
      return {
        winning_ticket_id: entry.ticket_id,
        member_id: entry.member_id,
        winning_index: winningIndex,
        total_tickets: total,
        snapshot_hash: snapHash,
        algorithm: DRAW_ALGORITHM,
      };
    }
  }
  // Unreachable: winningIndex < total by construction.
  throw new Error("Winner selection failed to land on an entry");
}

/** Recompute the draw from public data and check the seed commitment. */
export async function verifyDraw(
  entries: SnapshotEntry[],
  seed: string,
  commitment: string,
  result: DrawResult,
): Promise<boolean> {
  if ((await commitSeed(seed)) !== commitment) return false;
  const recomputed = await selectWinner(entries, seed);
  return (
    recomputed.winning_ticket_id === result.winning_ticket_id &&
    recomputed.winning_index === result.winning_index &&
    recomputed.snapshot_hash === result.snapshot_hash &&
    recomputed.total_tickets === result.total_tickets
  );
}
