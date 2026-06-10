// TODO(plaid): post-MVP. Implements DebtProvider against Plaid Liabilities
// so balances sync automatically and payments arrive verified
// (payments.verified = true, payments.source = 'plaid').
//
// Swapping this in must require zero UI changes — that is the contract of
// the DebtProvider interface. Wire-up point: src/providers/index.ts.

import type { DebtProvider } from "./DebtProvider";

export class PlaidDebtProvider implements DebtProvider {
  constructor() {
    throw new Error("PlaidDebtProvider is not implemented in MVP. TODO(plaid)");
  }
  listDebts = (): never => {
    throw new Error("TODO(plaid)");
  };
  addDebt = (): never => {
    throw new Error("TODO(plaid)");
  };
  updateDebt = (): never => {
    throw new Error("TODO(plaid)");
  };
  removeDebt = (): never => {
    throw new Error("TODO(plaid)");
  };
  listPayments = (): never => {
    throw new Error("TODO(plaid)");
  };
  logPayment = (): never => {
    throw new Error("TODO(plaid)");
  };
}
