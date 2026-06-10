// POST /functions/v1/log-payment
// Body: { debt_id, amount, paid_at?, on_time? }
//
// Records a self-reported payment, drains the debt balance, and runs the
// ticket engine atomically on the server: on-time grant, extra-payment
// grant, milestone grants, and streak bonus — all cap-checked against the
// member's ledger. Tickets attach to the next open drawing.

import { z } from "npm:zod@3";
import { computeGrant } from "../_shared/engine/rules.ts";
import { detectMilestones } from "../_shared/engine/milestones.ts";
import {
  canGrantStreak,
  hasOnTimeStreak,
} from "../_shared/engine/streak.ts";
import { monthKey } from "../_shared/engine/rules.ts";
import {
  appendGrant,
  authedUser,
  handleOptions,
  json,
  loadActiveRules,
  nextOpenDrawingId,
  priorGrantsFor,
  serviceClient,
  type GrantRecord,
} from "../_shared/http.ts";

const BodySchema = z.object({
  debt_id: z.string().uuid(),
  amount: z.number().positive().max(1_000_000),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  on_time: z.boolean().default(true),
});

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const user = await authedUser(req);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  const body = parsed.data;
  const now = new Date();
  const db = serviceClient();

  const { data: debt, error: debtErr } = await db
    .from("debts")
    .select("*")
    .eq("id", body.debt_id)
    .eq("member_id", user.id)
    .maybeSingle();
  if (debtErr) return json({ error: debtErr.message }, 500);
  if (!debt) return json({ error: "Debt not found" }, 404);

  // 1. Record the payment (self-reported; verified=false until Plaid).
  const { data: payment, error: payErr } = await db
    .from("payments")
    .insert({
      member_id: user.id,
      debt_id: debt.id,
      amount: body.amount,
      paid_at: body.paid_at ?? now.toISOString().slice(0, 10),
      on_time: body.on_time,
      source: "self_reported",
      verified: false,
    })
    .select()
    .single();
  if (payErr) return json({ error: payErr.message }, 500);

  // 2. Drain the balance.
  const newBalance = Math.max(0, Number(debt.current_balance) - body.amount);
  await db.from("debts").update({ current_balance: newBalance }).eq("id", debt.id);

  // 3. Ticket engine.
  const rules = await loadActiveRules(db);
  const drawingId = await nextOpenDrawingId(db);
  const grants: GrantRecord[] = [];

  const tryGrant = async (
    code: string,
    ctx: { debtId?: string; extraAmount?: number },
    metadata: Record<string, unknown>,
  ) => {
    const rule = rules.get(code);
    if (!rule) return;
    const priors = await priorGrantsFor(db, user.id, rule.id);
    const decision = computeGrant(rule, { now, priorGrants: priors, ...ctx });
    if (decision.qty > 0) {
      await appendGrant(db, user.id, rule, decision.qty, drawingId, metadata);
    }
    grants.push({ code, qty: decision.qty, reason: decision.reason });
  };

  if (body.on_time) {
    await tryGrant("on_time_payment", { debtId: debt.id }, {
      debt_id: debt.id,
      payment_id: payment.id,
    });
  }

  const extra = body.amount - Number(debt.minimum_payment);
  if (extra > 0) {
    await tryGrant("extra_payment", { debtId: debt.id, extraAmount: extra }, {
      debt_id: debt.id,
      payment_id: payment.id,
      extra_amount: extra,
    });
  }

  // Milestones: measured against the original balance recorded at link time.
  const originalBalance = Number(debt.original_balance ?? debt.current_balance);
  if (originalBalance > 0) {
    const milestoneRules = ["milestone_25", "milestone_50", "milestone_75", "milestone_100"];
    const alreadyGranted: string[] = [];
    for (const code of milestoneRules) {
      const rule = rules.get(code);
      if (!rule) continue;
      const priors = await priorGrantsFor(db, user.id, rule.id);
      if (priors.some((g) => g.debt_id === debt.id)) alreadyGranted.push(code);
    }
    for (const code of detectMilestones(originalBalance, newBalance, alreadyGranted)) {
      await tryGrant(code, { debtId: debt.id }, {
        debt_id: debt.id,
        payment_id: payment.id,
      });
    }
  }

  // Streak bonus: 3 consecutive months, every payment on time.
  const streakRule = rules.get("streak_3mo");
  if (streakRule && body.on_time) {
    const { data: history } = await db
      .from("payments")
      .select("paid_at, on_time")
      .eq("member_id", user.id);
    if (history && hasOnTimeStreak(history, now)) {
      const priors = await priorGrantsFor(db, user.id, streakRule.id);
      const { data: streakGrants } = await db
        .from("ticket_ledger")
        .select("metadata")
        .eq("member_id", user.id)
        .eq("rule_id", streakRule.id);
      const priorEnds = (streakGrants ?? [])
        .map((g) => (g.metadata as Record<string, unknown>)?.streak_end_month as string)
        .filter(Boolean);
      const endMonth = monthKey(now);
      if (canGrantStreak(priorEnds, endMonth)) {
        const decision = computeGrant(streakRule, { now, priorGrants: priors });
        if (decision.qty > 0) {
          await appendGrant(db, user.id, streakRule, decision.qty, drawingId, {
            streak_end_month: endMonth,
          });
          grants.push({ code: "streak_3mo", qty: decision.qty });
        }
      }
    }
  }

  return json({
    payment_id: payment.id,
    new_balance: newBalance,
    drawing_id: drawingId,
    grants,
    tickets_granted: grants.reduce((s, g) => s + g.qty, 0),
  });
});
