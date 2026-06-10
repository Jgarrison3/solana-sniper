// Feature flags. DRAWINGS_ENABLED gates the entire sweepstakes surface so
// the app can ship as a pure debt tracker while the Official Rules are
// finalized with counsel. When off: no Drops tab, no ticket counts, no
// drawing references anywhere in the UI. (The server-side counterpart is
// the DRAWINGS_ENABLED env var read by the edge functions.)

export const DRAWINGS_ENABLED =
  (process.env.EXPO_PUBLIC_DRAWINGS_ENABLED ?? "true").toLowerCase() !== "false";
