// Shared HTTP + Supabase plumbing for edge functions (Deno runtime).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { EarningRule, PriorGrant } from "./engine/types.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function handleOptions(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

/** Service-role client: bypasses RLS. Ledger writes happen only here. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export async function authedUser(
  req: Request,
): Promise<{ id: string; email?: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}

/** True when the request carries the service-role key (cron/system calls). */
export function isServiceRequest(req: Request): boolean {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return !!serviceKey && token === serviceKey;
}

/**
 * Feature flag — DRAWINGS_ENABLED=false ships the app as a pure debt
 * tracker: tickets still accrue but attach to no drawing.
 */
export function drawingsEnabled(): boolean {
  return (Deno.env.get("DRAWINGS_ENABLED") ?? "true").toLowerCase() !== "false";
}

export async function loadActiveRules(
  db: SupabaseClient,
): Promise<Map<string, EarningRule>> {
  const { data, error } = await db.from("earning_rules").select("*").eq("active", true);
  if (error) throw error;
  return new Map((data as EarningRule[]).map((r) => [r.code, r]));
}

export async function priorGrantsFor(
  db: SupabaseClient,
  memberId: string,
  ruleId: string,
): Promise<PriorGrant[]> {
  const { data, error } = await db
    .from("ticket_ledger")
    .select("qty, created_at, metadata")
    .eq("member_id", memberId)
    .eq("rule_id", ruleId);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    qty: r.qty as number,
    created_at: r.created_at as string,
    debt_id: (r.metadata as Record<string, unknown> | null)?.debt_id as
      | string
      | null
      | undefined,
  }));
}

/** Tickets attach to the next open drawing at grant time (or null). */
export async function nextOpenDrawingId(db: SupabaseClient): Promise<string | null> {
  if (!drawingsEnabled()) return null;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("drawings")
    .select("id")
    .eq("status", "open")
    .lte("opens_at", now)
    .gt("closes_at", now)
    .order("closes_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export interface GrantRecord {
  code: string;
  qty: number;
  reason?: string;
}

/** Append a grant to the ledger (the DB trigger forbids later mutation). */
export async function appendGrant(
  db: SupabaseClient,
  memberId: string,
  rule: EarningRule,
  qty: number,
  drawingId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("ticket_ledger").insert({
    member_id: memberId,
    rule_id: rule.id,
    qty,
    drawing_id: drawingId,
    metadata,
  });
  if (error) throw error;
}
