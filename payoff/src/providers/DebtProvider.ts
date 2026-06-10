// Balance/payment data access lives behind this interface so a
// PlaidDebtProvider can replace ManualDebtProvider later without touching
// any UI code. Screens and hooks depend only on DebtProvider.

export type DebtType =
  | "credit_card"
  | "auto"
  | "student"
  | "personal"
  | "medical"
  | "other";

export interface Debt {
  id: string;
  member_id: string;
  nickname: string;
  type: DebtType;
  creditor_name: string;
  current_balance: number;
  original_balance: number | null;
  apr: number;
  minimum_payment: number;
  due_day: number;
  monthly_payment: number | null;
  created_at: string;
}

export interface NewDebtInput {
  nickname: string;
  type: DebtType;
  creditor_name: string;
  current_balance: number;
  original_balance?: number;
  apr: number;
  minimum_payment: number;
  due_day: number;
  monthly_payment?: number;
}

export interface Payment {
  id: string;
  debt_id: string;
  amount: number;
  paid_at: string;
  on_time: boolean;
  verified: boolean;
  source: "self_reported" | "plaid";
}

export interface LogPaymentInput {
  debt_id: string;
  amount: number;
  paid_at?: string; // YYYY-MM-DD
  on_time?: boolean;
}

export interface LogPaymentResult {
  payment_id: string;
  new_balance: number;
  tickets_granted: number;
  grants: { code: string; qty: number; reason?: string }[];
}

export interface AddDebtResult {
  debt: Debt;
  tickets_granted: number;
}

export interface DebtProvider {
  listDebts(): Promise<Debt[]>;
  addDebt(input: NewDebtInput): Promise<AddDebtResult>;
  updateDebt(id: string, patch: Partial<NewDebtInput>): Promise<Debt>;
  removeDebt(id: string): Promise<void>;
  listPayments(debtId?: string): Promise<Payment[]>;
  logPayment(input: LogPaymentInput): Promise<LogPaymentResult>;
}

export const DEBT_TYPE_LABELS: Record<DebtType, string> = {
  credit_card: "Credit card",
  auto: "Auto loan",
  student: "Student loan",
  personal: "Personal loan",
  medical: "Medical",
  other: "Other",
};
