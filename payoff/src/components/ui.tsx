// Small shared UI primitives. Bigger signature components (GoldenTicket,
// DebtBar, TicketCelebration) live in their own files.

import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { colors, fonts, radii, spacing, tabularNums } from "@/theme/tokens";

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Body({
  children,
  muted,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: TextStyle;
}) {
  return (
    <Text style={[styles.body, muted && { color: colors.inkMuted }, style]}>
      {children}
    </Text>
  );
}

export function Money({
  amount,
  size = 18,
  color = colors.ink,
  cents = false,
}: {
  amount: number;
  size?: number;
  color?: string;
  cents?: boolean;
}) {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(amount);
  return (
    <Text
      style={[
        { fontFamily: fonts.displaySemi, fontSize: size, color },
        tabularNums,
      ]}
    >
      {formatted}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "gold" | "ghost";
  disabled?: boolean;
  loading?: boolean;
}) {
  const bg =
    variant === "primary" ? colors.moss : variant === "gold" ? colors.gold : "transparent";
  const fg = variant === "gold" ? colors.ink : variant === "ghost" ? colors.moss : colors.white;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === "ghost" && { borderWidth: 1.5, borderColor: colors.moss },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Pill({ label, color = colors.mossSoft, textColor = colors.moss }: {
  label: string;
  color?: string;
  textColor?: string;
}) {
  return (
    <View style={[styles.pill, { backgroundColor: color }]}>
      <Text style={[styles.pillText, { color: textColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  sectionTitle: {
    fontFamily: fonts.displaySemi,
    fontSize: 18,
    color: colors.ink,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    lineHeight: 22,
  },
  button: {
    borderRadius: radii.pill,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  buttonText: {
    fontFamily: fonts.bodySemi,
    fontSize: 16,
  },
  pill: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  pillText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
  },
});
