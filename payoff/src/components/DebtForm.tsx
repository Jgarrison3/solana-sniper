// Debt entry form, shared by onboarding and the Me tab.

import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button } from "@/components/ui";
import {
  DEBT_TYPE_LABELS,
  type DebtType,
  type NewDebtInput,
} from "@/providers";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

const TYPES = Object.keys(DEBT_TYPE_LABELS) as DebtType[];

function Field({
  label,
  value,
  onChange,
  keyboardType = "default",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboardType?: "default" | "decimal-pad" | "number-pad";
  placeholder?: string;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
      />
    </View>
  );
}

export function DebtForm({
  onSubmit,
  busy,
  submitLabel = "Add debt",
  initial,
}: {
  onSubmit: (input: NewDebtInput) => void;
  busy?: boolean;
  submitLabel?: string;
  initial?: Partial<NewDebtInput>;
}) {
  const [nickname, setNickname] = useState(initial?.nickname ?? "");
  const [type, setType] = useState<DebtType>(initial?.type ?? "credit_card");
  const [creditor, setCreditor] = useState(initial?.creditor_name ?? "");
  const [balance, setBalance] = useState(initial?.current_balance?.toString() ?? "");
  const [original, setOriginal] = useState(initial?.original_balance?.toString() ?? "");
  const [apr, setApr] = useState(initial?.apr?.toString() ?? "");
  const [minPayment, setMinPayment] = useState(initial?.minimum_payment?.toString() ?? "");
  const [dueDay, setDueDay] = useState(initial?.due_day?.toString() ?? "");
  const [monthly, setMonthly] = useState(initial?.monthly_payment?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const bal = parseFloat(balance);
    const aprNum = parseFloat(apr);
    const minNum = parseFloat(minPayment);
    const dueNum = parseInt(dueDay, 10);
    if (!nickname.trim()) return setError("Give this debt a nickname.");
    if (!creditor.trim()) return setError("Who is the creditor?");
    if (!(bal > 0)) return setError("Enter the current balance.");
    if (!(aprNum >= 0 && aprNum <= 100)) return setError("APR must be 0–100.");
    if (!(minNum >= 0)) return setError("Enter the minimum payment.");
    if (!(dueNum >= 1 && dueNum <= 31)) return setError("Due day must be 1–31.");
    setError(null);
    onSubmit({
      nickname: nickname.trim(),
      type,
      creditor_name: creditor.trim(),
      current_balance: bal,
      original_balance: original ? parseFloat(original) : undefined,
      apr: aprNum,
      minimum_payment: minNum,
      due_day: dueNum,
      monthly_payment: monthly ? parseFloat(monthly) : undefined,
    });
  };

  return (
    <ScrollView contentContainerStyle={{ gap: spacing.md }} keyboardShouldPersistTaps="handled">
      <Field label="Nickname" value={nickname} onChange={setNickname} placeholder="The Visa" />
      <View style={{ gap: 4 }}>
        <Text style={styles.label}>Type</Text>
        <View style={styles.chips}>
          {TYPES.map((t) => (
            <Pressable
              key={t}
              onPress={() => setType(t)}
              style={[styles.chip, type === t && styles.chipActive]}
            >
              <Text style={[styles.chipText, type === t && styles.chipTextActive]}>
                {DEBT_TYPE_LABELS[t]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Field label="Creditor name" value={creditor} onChange={setCreditor} placeholder="Chase" />
      <Field label="Current balance ($)" value={balance} onChange={setBalance} keyboardType="decimal-pad" placeholder="4,200" />
      <Field label="Original balance ($, optional)" value={original} onChange={setOriginal} keyboardType="decimal-pad" placeholder="Defaults to current" />
      <Field label="APR (%)" value={apr} onChange={setApr} keyboardType="decimal-pad" placeholder="22.9" />
      <Field label="Minimum payment ($/mo)" value={minPayment} onChange={setMinPayment} keyboardType="decimal-pad" placeholder="105" />
      <Field label="Due day of month" value={dueDay} onChange={setDueDay} keyboardType="number-pad" placeholder="15" />
      <Field label="What you plan to pay ($/mo, optional)" value={monthly} onChange={setMonthly} keyboardType="decimal-pad" placeholder="200" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={submitLabel} onPress={submit} loading={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.moss,
  },
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipActive: { backgroundColor: colors.moss, borderColor: colors.moss },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  chipTextActive: { color: colors.white },
  error: { fontFamily: fonts.bodyMedium, color: colors.brick, fontSize: 14 },
});
