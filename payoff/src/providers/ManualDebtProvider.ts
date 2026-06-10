// MVP provider: members enter debts and self-report payments.
// Payment logging routes through the log-payment edge function so the
// ticket engine runs server-side with caps enforced.

import { supabase } from "@/lib/supabase";
import type {
  AddDebtResult,
  Debt,
  DebtProvider,
  LogPaymentInput,
  LogPaymentResult,
  NewDebtInput,
  Payment,
} from "./DebtProvider";

async function memberId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Not signed in");
  return data.user.id;
}

export class ManualDebtProvider implements DebtProvider {
  async listDebts(): Promise<Debt[]> {
    const { data, error } = await supabase
      .from("debts")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data as Debt[];
  }

  async addDebt(input: NewDebtInput): Promise<AddDebtResult> {
    const uid = await memberId();
    const { data, error } = await supabase
      .from("debts")
      .insert({
        ...input,
        // Milestones measure against the balance at link time when no
        // original balance is provided.
        original_balance: input.original_balance ?? input.current_balance,
        member_id: uid,
      })
      .select()
      .single();
    if (error) throw error;
    const debt = data as Debt;

    // debt_linked grant (5 tickets, once per debt, max 5 debts) runs
    // server-side via the grant-on-link RPC-less path: the edge function
    // approach is used for payments; for linking we call the same engine
    // through the log of the ledger by invoking the function below.
    const { data: grantData } = await supabase.functions.invoke("link-debt-grant", {
      body: { debt_id: debt.id },
    });
    const tickets =
      (grantData as { granted?: number } | null)?.granted ?? 0;
    return { debt, tickets_granted: tickets };
  }

  async updateDebt(id: string, patch: Partial<NewDebtInput>): Promise<Debt> {
    const { data, error } = await supabase
      .from("debts")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as Debt;
  }

  async removeDebt(id: string): Promise<void> {
    const { error } = await supabase.from("debts").delete().eq("id", id);
    if (error) throw error;
  }

  async listPayments(debtId?: string): Promise<Payment[]> {
    let q = supabase.from("payments").select("*").order("paid_at", { ascending: false });
    if (debtId) q = q.eq("debt_id", debtId);
    const { data, error } = await q;
    if (error) throw error;
    return data as Payment[];
  }

  async logPayment(input: LogPaymentInput): Promise<LogPaymentResult> {
    const { data, error } = await supabase.functions.invoke("log-payment", {
      body: input,
    });
    if (error) throw error;
    return data as LogPaymentResult;
  }
}

export const debtProvider: DebtProvider = new ManualDebtProvider();
