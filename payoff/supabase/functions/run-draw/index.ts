// POST /functions/v1/run-draw
// Body: { drawing_id?, force? }
//
// The drawing engine. Intended to run on a cron schedule (see README for
// the pg_cron setup) and manually from the admin page.
//
// For each due drawing:
//   1. open → closed (status guard trigger writes an audit row)
//   2. snapshot eligible ticket_ledger entries for the drawing
//   3. select the winner deterministically from the committed seed
//      (sha256(seed:snapshot_hash) mod total_tickets — see engine/draw.ts)
//   4. closed → drawn with winning_ticket_id, rng_proof, drawn_at;
//      the seed is now revealed via drawings_public for verification
//   5. create the payout row (pending_claim) — concierge payout, no money
//      movement in MVP
//
// Auth: service-role bearer (cron) or an authenticated admin user.

import { z } from "npm:zod@3";
import { selectWinner, type SnapshotEntry } from "../_shared/engine/draw.ts";
import {
  authedUser,
  drawingsEnabled,
  handleOptions,
  isServiceRequest,
  json,
  serviceClient,
} from "../_shared/http.ts";

const BodySchema = z.object({
  drawing_id: z.string().uuid().optional(),
  force: z.boolean().default(false),
});

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  if (!drawingsEnabled()) {
    return json({ error: "Drawings are disabled (DRAWINGS_ENABLED=false)" }, 503);
  }

  const db = serviceClient();

  let actor: string | null = null;
  if (!isServiceRequest(req)) {
    const user = await authedUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await db
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.is_admin) return json({ error: "Admin only" }, 403);
    actor = user.id;
  }

  const parsed = BodySchema.safeParse(
    await req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  const { drawing_id, force } = parsed.data;
  const nowIso = new Date().toISOString();

  let query = db.from("drawings").select("*").eq("status", "open");
  query = drawing_id ? query.eq("id", drawing_id) : query.lte("closes_at", nowIso);
  const { data: due, error: dueErr } = await query;
  if (dueErr) return json({ error: dueErr.message }, 500);

  const results: Record<string, unknown>[] = [];

  for (const drawing of due ?? []) {
    if (!force && drawing.closes_at > nowIso) {
      results.push({ drawing_id: drawing.id, skipped: "not yet closed" });
      continue;
    }

    // 1. Close entries.
    const { error: closeErr } = await db
      .from("drawings")
      .update({ status: "closed" })
      .eq("id", drawing.id)
      .eq("status", "open");
    if (closeErr) {
      results.push({ drawing_id: drawing.id, error: closeErr.message });
      continue;
    }

    // 2. Snapshot eligible entries.
    const { data: ledger, error: ledgerErr } = await db
      .from("ticket_ledger")
      .select("id, member_id, qty")
      .eq("drawing_id", drawing.id);
    if (ledgerErr) {
      results.push({ drawing_id: drawing.id, error: ledgerErr.message });
      continue;
    }
    const entries: SnapshotEntry[] = (ledger ?? []).map((r) => ({
      ticket_id: r.id,
      member_id: r.member_id,
      qty: r.qty,
    }));

    if (entries.length === 0) {
      await db.from("audit_log").insert({
        actor,
        entity_type: "drawing",
        entity_id: drawing.id,
        action: "draw_skipped_no_entries",
      });
      results.push({ drawing_id: drawing.id, skipped: "no entries" });
      continue;
    }

    // 3. Deterministic winner from the committed seed.
    const result = await selectWinner(entries, drawing.rng_seed);

    // 4. Reveal: closed → drawn.
    const { error: drawErr } = await db
      .from("drawings")
      .update({
        status: "drawn",
        drawn_at: nowIso,
        winning_ticket_id: result.winning_ticket_id,
        rng_proof: result,
      })
      .eq("id", drawing.id)
      .eq("status", "closed");
    if (drawErr) {
      results.push({ drawing_id: drawing.id, error: drawErr.message });
      continue;
    }

    // 5. Concierge payout, pending the winner's claim.
    await db.from("payouts").insert({
      drawing_id: drawing.id,
      member_id: result.member_id,
      amount: drawing.prize_amount,
    });

    await db.from("audit_log").insert({
      actor,
      entity_type: "drawing",
      entity_id: drawing.id,
      action: "draw_executed",
      metadata: result,
    });

    // TODO(post-MVP): push notification to the winner. MVP surfaces the
    // win in-app via the payouts query (claim screen).

    results.push({
      drawing_id: drawing.id,
      winner_member_id: result.member_id,
      winning_ticket_id: result.winning_ticket_id,
      total_tickets: result.total_tickets,
    });
  }

  return json({ ran_at: nowIso, results });
});
