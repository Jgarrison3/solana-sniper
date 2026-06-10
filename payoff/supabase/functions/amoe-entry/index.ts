// POST /functions/v1/amoe-entry — PUBLIC (verify_jwt = false in config.toml)
//
// AMOE: free Alternative Method Of Entry, legally required for the
// sweepstakes. Anyone may enter once per calendar month with no app
// account and no activity requirement. Grants 5 tickets.
//
// MVP behavior:
//  * The entry is always recorded in amoe_entries (one per email per month).
//  * If the email belongs to an existing member, tickets are granted to
//    their ledger and attached to the next open drawing.
//  * If not, the entry row itself is the record of eligibility; the
//    operator includes unmatched AMOE entries when administering the draw.
//    TODO(post-MVP): auto-provision a lightweight entrant identity so
//    unmatched AMOE entries flow into the same ledger/draw snapshot
//    automatically.
//
// See the AMOE legal page in-app and the Official Rules stub for the
// member-facing description of this endpoint.

import { z } from "npm:zod@3";
import { computeGrant } from "../_shared/engine/rules.ts";
import {
  appendGrant,
  handleOptions,
  json,
  loadActiveRules,
  nextOpenDrawingId,
  priorGrantsFor,
  serviceClient,
} from "../_shared/http.ts";

const BodySchema = z.object({
  email: z.string().email().max(320),
  full_name: z.string().min(1).max(200),
  postal_address: z.string().min(1).max(500),
});

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  const { email, full_name, postal_address } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  const db = serviceClient();
  const now = new Date();
  const entryMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

  // Look for a member with this email so tickets land in their ledger.
  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  const { error: entryErr } = await db.from("amoe_entries").insert({
    email: normalizedEmail,
    full_name,
    postal_address,
    entry_month: entryMonth,
    member_id: profile?.id ?? null,
  });
  if (entryErr) {
    if (entryErr.code === "23505") {
      // Same response shape as success — don't leak whether an email entered.
      return json({ ok: true, message: "Entry received for this month." });
    }
    return json({ error: "Could not record entry" }, 500);
  }

  if (profile) {
    const rules = await loadActiveRules(db);
    const rule = rules.get("amoe");
    if (rule) {
      const priors = await priorGrantsFor(db, profile.id, rule.id);
      const decision = computeGrant(rule, { now, priorGrants: priors });
      if (decision.qty > 0) {
        const drawingId = await nextOpenDrawingId(db);
        await appendGrant(db, profile.id, rule, decision.qty, drawingId, {
          amoe: true,
          entry_month: entryMonth,
        });
      }
    }
  }

  return json({ ok: true, message: "Entry received for this month." });
});
