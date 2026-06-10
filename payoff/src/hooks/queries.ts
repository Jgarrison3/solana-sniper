// TanStack Query hooks — the only place screens fetch data from.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DRAWINGS_ENABLED } from "@/lib/featureFlags";
import { supabase } from "@/lib/supabase";
import {
  debtProvider,
  type LogPaymentInput,
  type NewDebtInput,
} from "@/providers";

// ---------------------------------------------------------- profile

export interface Profile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_initial: string | null;
  city: string | null;
  is_admin: boolean;
  monthly_budget: number | null;
}

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async (): Promise<Profile | null> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });
}

// ---------------------------------------------------------- debts & payments

export function useDebts() {
  return useQuery({ queryKey: ["debts"], queryFn: () => debtProvider.listDebts() });
}

export function usePayments(debtId?: string) {
  return useQuery({
    queryKey: ["payments", debtId ?? "all"],
    queryFn: () => debtProvider.listPayments(debtId),
  });
}

export function useAddDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewDebtInput) => debtProvider.addDebt(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["debts"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
    },
  });
}

export function useUpdateDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<NewDebtInput> }) =>
      debtProvider.updateDebt(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["debts"] }),
  });
}

export function useRemoveDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => debtProvider.removeDebt(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["debts"] }),
  });
}

export function useLogPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LogPaymentInput) => debtProvider.logPayment(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["debts"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
    },
  });
}

// ---------------------------------------------------------- drawings & tickets

export interface Drawing {
  id: string;
  name: string;
  prize_amount: number;
  sponsor_name: string;
  sponsor_blurb: string | null;
  opens_at: string;
  closes_at: string;
  drawn_at: string | null;
  status: "open" | "closed" | "drawn" | "paid";
  winning_ticket_id: string | null;
  rng_seed_commitment: string | null;
  rng_seed: string | null;
  rng_proof: Record<string, unknown> | null;
}

export function useDrawings() {
  return useQuery({
    queryKey: ["drawings"],
    enabled: DRAWINGS_ENABLED,
    queryFn: async (): Promise<Drawing[]> => {
      const { data, error } = await supabase
        .from("drawings_public")
        .select("*")
        .order("closes_at", { ascending: true });
      if (error) throw error;
      return data as Drawing[];
    },
  });
}

export function useNextDrawing() {
  const drawings = useDrawings();
  const now = Date.now();
  const next = (drawings.data ?? [])
    .filter(
      (d) =>
        d.status === "open" &&
        new Date(d.opens_at).getTime() <= now &&
        new Date(d.closes_at).getTime() > now,
    )
    .sort((a, b) => a.closes_at.localeCompare(b.closes_at))[0];
  return { ...drawings, next };
}

/** Member's ticket count in a given drawing (default: next open). */
export function useTicketCount(drawingId: string | undefined) {
  return useQuery({
    queryKey: ["tickets", drawingId ?? "none"],
    enabled: DRAWINGS_ENABLED && !!drawingId,
    queryFn: async (): Promise<number> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return 0;
      const { data, error } = await supabase
        .from("ticket_ledger")
        .select("qty")
        .eq("member_id", auth.user.id)
        .eq("drawing_id", drawingId!);
      if (error) throw error;
      return (data ?? []).reduce((sum, r) => sum + r.qty, 0);
    },
  });
}

export interface LedgerRow {
  id: string;
  qty: number;
  created_at: string;
  drawing_id: string | null;
  metadata: Record<string, unknown>;
  earning_rules: { code: string; name: string } | null;
}

export function useLedger() {
  return useQuery({
    queryKey: ["ledger"],
    queryFn: async (): Promise<LedgerRow[]> => {
      const { data, error } = await supabase
        .from("ticket_ledger")
        .select("id, qty, created_at, drawing_id, metadata, earning_rules(code, name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as LedgerRow[];
    },
  });
}

export interface WinnerRow {
  first_name: string | null;
  last_initial: string | null;
  city: string | null;
  amount: number;
  debt_type: string | null;
  drawing_name: string;
  sponsor_name: string;
  confirmed_at: string;
}

export function useWinnersFeed() {
  return useQuery({
    queryKey: ["winners"],
    enabled: DRAWINGS_ENABLED,
    queryFn: async (): Promise<WinnerRow[]> => {
      const { data, error } = await supabase
        .from("winners_feed")
        .select("*")
        .order("confirmed_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as WinnerRow[];
    },
  });
}

// ---------------------------------------------------------- earning rules

export interface EarningRuleRow {
  id: string;
  code: string;
  name: string;
  description: string;
  base_tickets: number;
  unit: "event" | "dollars_extra";
  unit_size: number | null;
  max_per_day: number | null;
  max_per_month: number | null;
  max_per_debt_per_month: number | null;
  max_tickets_per_month: number | null;
  once_per_debt: boolean;
  max_debts: number | null;
  active: boolean;
}

export function useEarningRules() {
  return useQuery({
    queryKey: ["earning_rules"],
    queryFn: async (): Promise<EarningRuleRow[]> => {
      const { data, error } = await supabase
        .from("earning_rules")
        .select("*")
        .eq("active", true)
        .order("base_tickets", { ascending: false });
      if (error) throw error;
      return data as EarningRuleRow[];
    },
  });
}

// ---------------------------------------------------------- lessons

export interface Lesson {
  id: string;
  slug: string;
  title: string;
  body: string;
}

export function useDailyLesson() {
  return useQuery({
    queryKey: ["lesson", new Date().toISOString().slice(0, 10)],
    queryFn: async (): Promise<{ lesson: Lesson | null; completedToday: boolean }> => {
      const { data: lessons, error } = await supabase
        .from("lessons")
        .select("id, slug, title, body")
        .eq("active", true)
        .order("sort");
      if (error) throw error;
      if (!lessons?.length) return { lesson: null, completedToday: false };

      const today = new Date().toISOString().slice(0, 10);
      const { data: completions } = await supabase
        .from("lesson_completions")
        .select("lesson_id, completed_on");
      const completedToday = (completions ?? []).some(
        (c) => c.completed_on === today,
      );
      const doneIds = new Set((completions ?? []).map((c) => c.lesson_id));
      // rotate: first lesson not yet completed, else cycle by day of year
      const fresh = lessons.find((l) => !doneIds.has(l.id));
      const dayOfYear = Math.floor(
        (Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000,
      );
      const lesson = fresh ?? lessons[dayOfYear % lessons.length];
      return { lesson, completedToday };
    },
  });
}

export function useCompleteLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lessonId: string) => {
      const { data, error } = await supabase.functions.invoke("complete-lesson", {
        body: { lesson_id: lessonId },
      });
      if (error) throw error;
      return data as { granted: number; reason?: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lesson"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
    },
  });
}

// ---------------------------------------------------------- payouts (winner claim)

export interface Payout {
  id: string;
  drawing_id: string;
  member_id: string;
  amount: number;
  creditor_name: string | null;
  account_reference: string | null;
  debt_id: string | null;
  debt_type: string | null;
  status: "pending_claim" | "claimed" | "payment_sent" | "confirmed";
  created_at: string;
}

export function useMyPayouts() {
  return useQuery({
    queryKey: ["payouts"],
    enabled: DRAWINGS_ENABLED,
    queryFn: async (): Promise<Payout[]> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return [];
      const { data, error } = await supabase
        .from("payouts")
        .select("*")
        .eq("member_id", auth.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Payout[];
    },
  });
}

export function useClaimPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      creditor_name: string;
      account_reference: string;
      debt_id?: string;
      debt_type?: string;
    }) => {
      const { id, ...fields } = input;
      const { error } = await supabase
        .from("payouts")
        .update({ ...fields, status: "claimed" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payouts"] }),
  });
}

// ---------------------------------------------------------- streak

/** Consecutive months (ending this month) where every logged payment was on time. */
export function useStreak() {
  const payments = usePayments();
  const byMonth = new Map<string, boolean>();
  for (const p of payments.data ?? []) {
    const key = p.paid_at.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? true) && p.on_time);
  }
  let streak = 0;
  const cursor = new Date();
  for (;;) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
    if (byMonth.get(key)) {
      streak += 1;
      cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    } else {
      break;
    }
  }
  return { ...payments, streak };
}
