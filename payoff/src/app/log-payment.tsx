// Log-a-payment modal: pick a debt, enter the amount, confirm on-time.
// On success, shows the tickets earned with the golden ticket.

import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TicketCelebration } from "@/components/TicketCelebration";
import { Body, Button, Card, Money } from "@/components/ui";
import { useDebts, useLogPayment } from "@/hooks/queries";
import { DRAWINGS_ENABLED } from "@/lib/featureFlags";
import type { LogPaymentResult } from "@/providers";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

export default function LogPayment() {
  const router = useRouter();
  const debts = useDebts();
  const logPayment = useLogPayment();

  const [debtId, setDebtId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [onTime, setOnTime] = useState(true);
  const [result, setResult] = useState<LogPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = debts.data ?? [];
  const selected = list.find((d) => d.id === (debtId ?? list[0]?.id)) ?? list[0];

  if (result) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={[styles.container, { justifyContent: "center", gap: spacing.lg }]}>
          <Text style={styles.title}>Payment logged 🎉</Text>
          <Body>
            New balance:{" "}
            <Money amount={result.new_balance} size={18} color={colors.brick} />
          </Body>
          {DRAWINGS_ENABLED && result.tickets_granted > 0 ? (
            <>
              <TicketCelebration qty={result.tickets_granted} sublabel="earned with this payment" />
              <View style={{ gap: 4 }}>
                {result.grants
                  .filter((g) => g.qty > 0)
                  .map((g) => (
                    <Body key={g.code} muted style={{ fontSize: 13 }}>
                      +{g.qty} · {g.code.replace(/_/g, " ")}
                    </Body>
                  ))}
              </View>
            </>
          ) : (
            <Body muted>Keep it up — the bar just drained a little more.</Body>
          )}
          <Button title="Done" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const submit = () => {
    const amt = parseFloat(amount);
    if (!selected) return setError("Add a debt first.");
    if (!(amt > 0)) return setError("Enter the payment amount.");
    setError(null);
    logPayment.mutate(
      { debt_id: selected.id, amount: amt, on_time: onTime },
      {
        onSuccess: setResult,
        onError: (e) => setError(e instanceof Error ? e.message : "Could not log payment"),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Log a payment</Text>

        <Text style={styles.label}>Which debt?</Text>
        <View style={{ gap: spacing.sm }}>
          {list.map((d) => (
            <Pressable key={d.id} onPress={() => setDebtId(d.id)}>
              <Card
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderColor: selected?.id === d.id ? colors.moss : colors.cardBorder,
                  borderWidth: selected?.id === d.id ? 2 : 1,
                }}
              >
                <View>
                  <Text style={styles.debtName}>{d.nickname}</Text>
                  <Body muted style={{ fontSize: 13 }}>
                    min <Money amount={Number(d.minimum_payment)} size={13} />/mo
                  </Body>
                </View>
                <Money amount={Number(d.current_balance)} color={colors.brick} size={16} />
              </Card>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Amount paid ($)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder={selected ? String(selected.minimum_payment) : "0"}
          placeholderTextColor={colors.inkMuted}
        />
        {DRAWINGS_ENABLED && selected && parseFloat(amount) > Number(selected.minimum_payment) ? (
          <Body style={{ color: colors.moss, fontSize: 13 }}>
            ${(parseFloat(amount) - Number(selected.minimum_payment)).toFixed(0)} above
            minimum → extra tickets (1 per $10, up to the monthly cap)
          </Body>
        ) : null}

        <View style={styles.switchRow}>
          <Body>Paid on or before the due date</Body>
          <Switch
            value={onTime}
            onValueChange={setOnTime}
            trackColor={{ true: colors.moss, false: colors.cardBorder }}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Log payment" onPress={submit} loading={logPayment.isPending} />
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
        <Body muted style={{ fontSize: 12 }}>
          Self-reported for now — payments will verify automatically once bank
          linking arrives.
        </Body>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  label: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.moss },
  debtName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  input: {
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    fontFamily: fonts.body,
    fontSize: 22,
    color: colors.ink,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  error: { fontFamily: fonts.bodyMedium, color: colors.brick, fontSize: 14 },
});
