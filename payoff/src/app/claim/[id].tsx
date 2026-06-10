// Winner claim screen: collects creditor payment details. No money moves
// in the app — the operator pays the creditor manually (concierge payout)
// and advances the status from the admin console.

import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Button, Card, Money, Pill } from "@/components/ui";
import { useClaimPayout, useDebts, useMyPayouts } from "@/hooks/queries";
import { DEBT_TYPE_LABELS } from "@/providers";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

const STATUS_LABELS: Record<string, string> = {
  pending_claim: "Waiting for your details",
  claimed: "Details received — payment being arranged",
  payment_sent: "Payment sent to your creditor",
  confirmed: "Confirmed — congratulations!",
};

export default function Claim() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const payouts = useMyPayouts();
  const debts = useDebts();
  const claim = useClaimPayout();

  const payout = (payouts.data ?? []).find((p) => p.id === id);
  const [creditor, setCreditor] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [debtId, setDebtId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!payout) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={[styles.container, { justifyContent: "center" }]}>
          <Body muted>Payout not found.</Body>
          <Button title="Back" variant="ghost" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const selectedDebt = (debts.data ?? []).find((d) => d.id === debtId);

  const submit = () => {
    const creditorName = creditor.trim() || selectedDebt?.creditor_name || "";
    if (!creditorName) return setError("Enter the creditor name.");
    if (!accountRef.trim()) return setError("Enter your account reference.");
    setError(null);
    claim.mutate(
      {
        id: payout.id,
        creditor_name: creditorName,
        account_reference: accountRef.trim(),
        debt_id: selectedDebt?.id,
        debt_type: selectedDebt?.type,
      },
      { onError: (e) => setError(e instanceof Error ? e.message : "Claim failed") },
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>🎉 You won!</Text>
        <View style={styles.prizeBox}>
          <Money amount={Number(payout.amount)} size={44} color={colors.ink} />
          <Body style={{ color: colors.ink }}>goes straight to your creditor</Body>
        </View>
        <Pill
          label={STATUS_LABELS[payout.status]}
          color={payout.status === "confirmed" ? colors.goldSoft : colors.mossSoft}
          textColor={payout.status === "confirmed" ? colors.ink : colors.moss}
        />

        {payout.status === "pending_claim" ? (
          <>
            <Body>
              Tell us where to send it. Our team handles the payment personally
              and you&apos;ll see status updates here.
            </Body>

            <Text style={styles.label}>Which debt should we pay?</Text>
            <View style={{ gap: spacing.sm }}>
              {(debts.data ?? []).map((d) => (
                <Pressable key={d.id} onPress={() => { setDebtId(d.id); setCreditor(d.creditor_name); }}>
                  <Card
                    style={{
                      borderColor: debtId === d.id ? colors.moss : colors.cardBorder,
                      borderWidth: debtId === d.id ? 2 : 1,
                    }}
                  >
                    <Text style={styles.debtName}>{d.nickname}</Text>
                    <Body muted style={{ fontSize: 13 }}>
                      {DEBT_TYPE_LABELS[d.type]} · {d.creditor_name}
                    </Body>
                  </Card>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Creditor name</Text>
            <TextInput
              style={styles.input}
              value={creditor}
              onChangeText={setCreditor}
              placeholder="e.g. Chase Card Services"
              placeholderTextColor={colors.inkMuted}
            />
            <Text style={styles.label}>Account reference (last 4 digits or payment address)</Text>
            <TextInput
              style={styles.input}
              value={accountRef}
              onChangeText={setAccountRef}
              placeholder="•••• 4321"
              placeholderTextColor={colors.inkMuted}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title="Claim my prize" variant="gold" onPress={submit} loading={claim.isPending} />
          </>
        ) : (
          <Body muted>
            We have your details. Status updates appear here as the payment
            moves: claimed → payment sent → confirmed.
          </Body>
        )}
        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  title: { fontFamily: fonts.display, fontSize: 32, color: colors.ink },
  prizeBox: {
    backgroundColor: colors.gold,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: "center",
    gap: 4,
  },
  label: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.moss },
  debtName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  input: {
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  error: { fontFamily: fonts.bodyMedium, color: colors.brick, fontSize: 14 },
});
