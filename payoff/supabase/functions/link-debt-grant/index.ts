// POST /functions/v1/link-debt-grant
// Body: { debt_id }
// Grants the debt_linked tickets (5, once per debt, max 5 debts) after a
// member adds a debt. Idempotent: re-calling for the same debt grants 0.

import { z } from "npm:zod@3";
import { computeGrant } from "../_shared/engine/rules.ts";
import {
  appendGrant,
  authedUser,
  handleOptions,
  json,
  loadActiveRules,
  nextOpenDrawingId,
  priorGrantsFor,
  serviceClient,
} from "../_shared/http.ts";

const BodySchema = z.object({ debt_id: z.string().uuid() });

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const user = await authedUser(req);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const db = serviceClient();
  const { data: debt } = await db
    .from("debts")
    .select("id")
    .eq("id", parsed.data.debt_id)
    .eq("member_id", user.id)
    .maybeSingle();
  if (!debt) return json({ error: "Debt not found" }, 404);

  const rules = await loadActiveRules(db);
  const rule = rules.get("debt_linked");
  if (!rule) return json({ granted: 0, reason: "rule_missing" });

  const priors = await priorGrantsFor(db, user.id, rule.id);
  const decision = computeGrant(rule, {
    now: new Date(),
    debtId: debt.id,
    priorGrants: priors,
  });
  if (decision.qty > 0) {
    const drawingId = await nextOpenDrawingId(db);
    await appendGrant(db, user.id, rule, decision.qty, drawingId, {
      debt_id: debt.id,
    });
  }
  return json({ granted: decision.qty, reason: decision.reason });
});
