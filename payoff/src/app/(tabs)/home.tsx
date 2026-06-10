// Home: total debt remaining with the drain-down bar, tickets in the next
// drawing, on-time streak, and the per-debt list.

import { Link, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DebtBar } from "@/components/DebtBar";
import { GoldenTicket } from "@/components/GoldenTicket";
import { Body, Button, Card, Money, Pill, SectionTitle } from "@/components/ui";
import {
  useDebts,
  useMyPayouts,
  useNextDrawing,
  useStreak,
  useTicketCount,
} from "@/hooks/queries";
import { DRAWINGS_ENABLED } from "@/lib/featureFlags";
import { percentPaid, projectPayoff } from "@/lib/debtMath";
import { formatDate } from "@/lib/format";
import { DEBT_TYPE_LABELS } from "@/providers";
import { colors, fonts, spacing, tabularNums } from "@/theme/tokens";

export default function Home() {
  const router = useRouter();
  const debts = useDebts();
  const { next } = useNextDrawing();
  const tickets = useTicketCount(next?.id);
  const { streak } = useStreak();
  const payouts = useMyPayouts();

  const list = debts.data ?? [];
  const totalRemaining = list.reduce((s, d) => s + Number(d.current_balance), 0);
  const totalOriginal = list.reduce(
    (s, d) => s + Number(d.original_balance ?? d.current_balance),
    0,
  );
  const totalPct = percentPaid(totalOriginal, totalRemaining);
  const pendingWin = (payouts.data ?? []).find((p) => p.status === "pending_claim");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.container}>
        {pendingWin ? (
          <Pressable onPress={() => router.push(`/claim/${pendingWin.id}`)}>
            <Card style={{ backgroundColor: colors.gold }}>
              <Text style={styles.winTitle}>🎉 You won a Payoff Drop!</Text>
              <Body>
                Tap to claim — we&apos;ll send{" "}
                <Money amount={Number(pendingWin.amount)} size={15} /> straight to
                your creditor.
              </Body>
            </Card>
          </Pressable>
        ) : null}

        <Text style={styles.kicker}>Debt remaining</Text>
        <Text style={[styles.bigNumber, tabularNums]}>
          {new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(totalRemaining)}
        </Text>
        <DebtBar percentPaid={totalPct} height={14} />
        <View style={styles.statsRow}>
          <Body muted>{totalPct.toFixed(0)}% paid off</Body>
          {streak > 0 ? (
            <Pill label={`🔥 ${streak}-month on-time streak`} color={colors.goldSoft} textColor={colors.ink} />
          ) : null}
        </View>

        {DRAWINGS_ENABLED && next ? (
          <Link href="/drops" asChild>
            <Pressable>
              <GoldenTicket
                qty={tickets.data ?? 0}
                sublabel={`entered in ${next.name}`}
              />
            </Pressable>
          </Link>
        ) : null}

        <Button title="Log a payment" onPress={() => router.push("/log-payment")} />

        <SectionTitle>Your debts</SectionTitle>
        {list.map((debt) => {
          const original = Number(debt.original_balance ?? debt.current_balance);
          const pct = percentPaid(original, Number(debt.current_balance));
          const payment = Number(debt.monthly_payment ?? debt.minimum_payment);
          const projection = projectPayoff(Number(debt.current_balance), Number(debt.apr), payment);
          return (
            <Card key={debt.id} style={{ gap: spacing.sm }}>
              <View style={styles.debtHeader}>
                <View>
                  <Text style={styles.debtName}>{debt.nickname}</Text>
                  <Body muted style={{ fontSize: 13 }}>
                    {DEBT_TYPE_LABELS[debt.type]} · {debt.creditor_name} ·{" "}
                    {Number(debt.apr).toFixed(1)}% APR
                  </Body>
                </View>
                <Money amount={Number(debt.current_balance)} color={colors.brick} size={20} />
              </View>
              <DebtBar percentPaid={pct} />
              <View style={styles.debtFooter}>
                <Body muted style={{ fontSize: 13 }}>{pct.toFixed(0)}% paid</Body>
                <Body muted style={{ fontSize: 13 }}>
                  {projection
                    ? `Paid off ${formatDate(projection.payoffDate)}`
                    : "Payment won't cover interest"}
                </Body>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  kicker: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.moss },
  bigNumber: {
    fontFamily: fonts.display,
    fontSize: 52,
    color: colors.brick,
    marginTop: -spacing.sm,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  winTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, marginBottom: 4 },
  debtHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  debtName: { fontFamily: fonts.displaySemi, fontSize: 17, color: colors.ink },
  debtFooter: { flexDirection: "row", justifyContent: "space-between" },
});
