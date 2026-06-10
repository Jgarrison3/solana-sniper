// ============================================================
// ALL sweepstakes-related member-facing copy lives in this one
// file so counsel can review it in a single pass.
//
// DRAFT — NOT LEGAL ADVICE. Every string below is placeholder
// scaffolding pending review by a sweepstakes attorney.
// ============================================================

export const LEGAL_DRAFT_BANNER =
  "DRAFT — NOT LEGAL ADVICE. Pending review by counsel.";

export const TAGLINE = "You win, even if you don't.";

/** Required on every screen that shows a drawing. */
export const FINE_PRINT =
  "No purchase necessary. Free entry available. Odds depend on total entries. " +
  "Void where prohibited. See Official Rules.";

export const NO_PURCHASE_EVER =
  "Tickets can never be bought. Every ticket is earned free — by paying down " +
  "debt, learning, or entering free by mail or web.";

export const AMOE_INSTRUCTIONS = `DRAFT — NOT LEGAL ADVICE

Free Alternative Method of Entry (AMOE)

No purchase or account activity is necessary to enter a Payoff Drop. To
receive 5 entries into the current month's drawing at no cost:

1. Visit the public entry form at <YOUR-PROJECT>.supabase.co/functions/v1/amoe-entry
   (or the web form linked from payoff.app/free-entry) and submit your
   email address, full name, and postal address; or
2. Mail a 3x5 card with your full name, postal address, and email address
   to: Pay Off AMOE, [OPERATOR MAILING ADDRESS — TBD].

Limit one AMOE entry per person per calendar month. AMOE entries have
equal odds with all other entries in the same drawing.`;

export const OFFICIAL_RULES = `DRAFT — NOT LEGAL ADVICE

Pay Off "Payoff Drops" — Official Rules (placeholder)

1. NO PURCHASE NECESSARY. A purchase will not increase your chances of
   winning. Nothing sold by Pay Off grants entries; premium features (if
   offered) never include entries.
2. Eligibility: legal residents of [JURISDICTIONS TBD], 18+. Void where
   prohibited.
3. How to enter: earn free entries through in-app debt payoff activities
   (see the Earn tab) or via the free Alternative Method of Entry (AMOE).
   All entries in a drawing have equal odds per ticket.
4. Drawing: at the published close time, a winner is selected at random
   from all eligible entries using a committed-seed algorithm. The SHA-256
   commitment of the random seed is published before entries close and the
   seed is revealed after the draw so any entrant can verify the result.
5. Prize: the stated prize amount is paid directly to the winner's
   creditor on a verified debt account. Prizes are not paid in cash to the
   winner. [TAX TREATMENT — COUNSEL TO ADVISE; 1099 likely required.]
6. Sponsor: each Payoff Drop identifies its sponsor on the drawing card.
7. [REMAINING SECTIONS — COUNSEL TO DRAFT: claims period, affidavit,
   publicity release, disputes, privacy.]`;

export const PRIVACY_POLICY = `DRAFT — NOT LEGAL ADVICE

Pay Off Privacy Policy (placeholder)

We collect the debt information you enter, the payments you log, and your
sweepstakes entries. We never sell your data. Debt balances are visible
only to you. Winners' first name, last initial, and city are published in
the winners feed as required by sweepstakes regulations.

[FULL POLICY — COUNSEL TO DRAFT.]`;

export const WINNER_FEED_TEMPLATE = (
  firstName: string,
  lastInitial: string,
  city: string,
  amount: string,
  debtPhrase: string,
) => `${firstName} ${lastInitial}. · ${city} · ${amount} sent to ${debtPhrase}`;

export const DEBT_TYPE_PHRASES: Record<string, string> = {
  credit_card: "their credit card",
  auto: "their auto loan",
  student: "their student loan",
  personal: "their personal loan",
  medical: "their medical debt",
  other: "their debt",
};
