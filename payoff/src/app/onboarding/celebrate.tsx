import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TicketCelebration } from "@/components/TicketCelebration";
import { Body, Button } from "@/components/ui";
import { useDebts } from "@/hooks/queries";
import { DRAWINGS_ENABLED } from "@/lib/featureFlags";
import { projectPayoff } from "@/lib/debtMath";
import { formatDate } from "@/lib/format";
import { colors, fonts, spacing } from "@/theme/tokens";

export default function Celebrate() {
  const router = useRouter();
  const { tickets, debtId } = useLocalSearchParams<{ tickets?: string; debtId?: string }>();
  const debts = useDebts();

  const debt = (debts.data ?? []).find((d) => d.id === debtId) ?? (debts.data ?? [])[0];
  const payment = debt?.monthly_payment ?? debt?.minimum_payment ?? 0;
  const projection = debt ? projectPayoff(debt.current_balance, debt.apr, payment) : null;
  const qty = Number(tickets ?? 0) || 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={{ flex: 1, justifyContent: "center", gap: spacing.lg }}>
          {debt && projection ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={styles.kicker}>Stick with your plan and</Text>
              <Text style={styles.headline}>
                {debt.nickname} is gone by {formatDate(projection.payoffDate)}
              </Text>
            </View>
          ) : (
            <Text style={styles.headline}>Your payoff plan starts now</Text>
          )}

          {DRAWINGS_ENABLED && qty > 0 ? (
            <>
              <TicketCelebration qty={qty} sublabel="for linking your first debt" />
              <Body muted style={{ textAlign: "center" }}>
                Your first {qty} tickets are already entered in the next Payoff
                Drop. Every healthy payoff move earns more — for free, always.
              </Body>
            </>
          ) : null}
        </View>
        <Button title="Let's go" variant="gold" onPress={() => router.replace("/home")} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { flex: 1, padding: spacing.lg },
  kicker: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.moss },
  headline: { fontFamily: fonts.display, fontSize: 30, color: colors.ink },
});
