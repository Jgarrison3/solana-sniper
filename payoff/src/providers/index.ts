// Single wire-up point for the active DebtProvider.
// TODO(plaid): switch to PlaidDebtProvider (behind a per-member flag) here.

export { debtProvider } from "./ManualDebtProvider";
export * from "./DebtProvider";
