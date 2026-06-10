// Pay Off design tokens. Every screen pulls from here — no inline hexes.

import type { TextStyle } from "react-native";

export const colors = {
  ink: "#0C322A", // primary text, big numbers
  moss: "#1D5C46", // secondary brand, buttons
  mint: "#EAF2EC", // app background
  gold: "#E9B43D", // tickets, drawings, celebration
  brick: "#C2502E", // debt amounts owed
  white: "#FFFFFF",
  // derived tints
  mossSoft: "#1D5C4622",
  goldSoft: "#F7E5BC",
  inkMuted: "#0C322A99",
  cardBorder: "#0C322A14",
} as const;

export const fonts = {
  display: "BricolageGrotesque_700Bold",
  displaySemi: "BricolageGrotesque_600SemiBold",
  body: "PublicSans_400Regular",
  bodyMedium: "PublicSans_500Medium",
  bodySemi: "PublicSans_600SemiBold",
  bodyBold: "PublicSans_700Bold",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

/** All money is set in tabular numerals. */
export const tabularNums: TextStyle = { fontVariant: ["tabular-nums"] };
