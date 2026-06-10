// POST /functions/v1/complete-lesson
// Body: { lesson_id }
// Marks today's lesson complete (DB unique constraint: one per member per
// day) and grants the daily_lesson tickets.

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

const BodySchema = z.object({ lesson_id: z.string().uuid() });

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
  const { data: lesson } = await db
    .from("lessons")
    .select("id")
    .eq("id", parsed.data.lesson_id)
    .eq("active", true)
    .maybeSingle();
  if (!lesson) return json({ error: "Lesson not found" }, 404);

  const { error: insertErr } = await db.from("lesson_completions").insert({
    member_id: user.id,
    lesson_id: lesson.id,
  });
  if (insertErr) {
    // 23505 = unique_violation: already completed a lesson today.
    if (insertErr.code === "23505") {
      return json({ granted: 0, reason: "daily_cap_reached" });
    }
    return json({ error: insertErr.message }, 500);
  }

  const rules = await loadActiveRules(db);
  const rule = rules.get("daily_lesson");
  if (!rule) return json({ granted: 0, reason: "rule_missing" });

  const priors = await priorGrantsFor(db, user.id, rule.id);
  const decision = computeGrant(rule, { now: new Date(), priorGrants: priors });
  if (decision.qty > 0) {
    const drawingId = await nextOpenDrawingId(db);
    await appendGrant(db, user.id, rule, decision.qty, drawingId, {
      lesson_id: lesson.id,
    });
  }
  return json({ granted: decision.qty, reason: decision.reason });
});
