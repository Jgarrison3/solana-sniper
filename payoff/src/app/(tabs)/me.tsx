// Me: profile, linked debt management, ticket ledger history, legal pages.

import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Button, Card, Money, SectionTitle } from "@/components/ui";
import {
  useDebts,
  useLedger,
  useProfile,
  useRemoveDebt,
} from "@/hooks/queries";
import { useQueryClient } from "@tanstack/react-query";
import { DRAWINGS_ENABLED } from "@/lib/featureFlags";
import { formatFullDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { DEBT_TYPE_LABELS } from "@/providers";
import { colors, fonts, radii, spacing, tabularNums } from "@/theme/tokens";

export default function Me() {
  const router = useRouter();
  const qc = useQueryClient();
  const profile = useProfile();
  const debts = useDebts();
  const ledger = useLedger();
  const removeDebt = useRemoveDebt();

  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastInitial, setLastInitial] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const p = profile.data;
  const totalTickets = (ledger.data ?? []).reduce((s, r) => s + r.qty, 0);

  const saveProfile = async () => {
    if (!p) return;
    setSaving(true);
    await supabase
      .from("profiles")
      .update({
        first_name: firstName ?? p.first_name,
        last_initial: (lastInitial ?? p.last_initial ?? "").slice(0, 1) || null,
        city: city ?? p.city,
      })
      .eq("id", p.id);
    await qc.invalidateQueries({ queryKey: ["profile"] });
    setSaving(false);
  };

  const confirmRemove = (id: string, nickname: string) => {
    const doIt = () => removeDebt.mutate(id);
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (confirm(`Remove ${nickname}? Its payment history stays.`)) doIt();
    } else {
      Alert.alert("Remove debt", `Remove ${nickname}?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: doIt },
      ]);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Me</Text>

        <SectionTitle>Profile</SectionTitle>
        <Card style={{ gap: spacing.sm }}>
          <Body muted style={{ fontSize: 13 }}>
            First name, last initial, and city appear in the winners feed if
            you win (e.g. “Jess T. · Tulsa”).
          </Body>
          <TextInput
            style={styles.input}
            placeholder="First name"
            placeholderTextColor={colors.inkMuted}
            defaultValue={p?.first_name ?? ""}
            onChangeText={setFirstName}
          />
          <TextInput
            style={styles.input}
            placeholder="Last initial"
            placeholderTextColor={colors.inkMuted}
            maxLength={1}
            defaultValue={p?.last_initial ?? ""}
            onChangeText={setLastInitial}
          />
          <TextInput
            style={styles.input}
            placeholder="City"
            placeholderTextColor={colors.inkMuted}
            defaultValue={p?.city ?? ""}
            onChangeText={setCity}
          />
          <Button title="Save profile" onPress={saveProfile} loading={saving} variant="ghost" />
        </Card>

        <SectionTitle>Linked debts</SectionTitle>
        {(debts.data ?? []).map((d) => (
          <Card key={d.id} style={styles.debtRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.debtName}>{d.nickname}</Text>
              <Body muted style={{ fontSize: 13 }}>
                {DEBT_TYPE_LABELS[d.type]} · {d.creditor_name}
              </Body>
            </View>
            <Money amount={Number(d.current_balance)} color={colors.brick} size={16} />
            <Pressable onPress={() => confirmRemove(d.id, d.nickname)} hitSlop={8}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </Card>
        ))}
        <Button title="Add another debt" variant="ghost" onPress={() => router.push("/add-debt")} />

        {DRAWINGS_ENABLED ? (
          <>
            <SectionTitle>Ticket history</SectionTitle>
            <Card>
              <Body style={{ fontFamily: fonts.bodySemi }}>
                {totalTickets.toLocaleString("en-US")} tickets earned all-time
              </Body>
            </Card>
            {(ledger.data ?? []).slice(0, 30).map((row) => (
              <Card key={row.id} style={styles.ledgerRow}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 14 }}>{row.earning_rules?.name ?? "Tickets"}</Body>
                  <Body muted style={{ fontSize: 12 }}>
                    {formatFullDate(row.created_at)}
                    {row.drawing_id ? "" : " · not attached to a drawing"}
                  </Body>
                </View>
                <Text style={[styles.qty, tabularNums]}>+{row.qty}</Text>
              </Card>
            ))}
          </>
        ) : null}

        <SectionTitle>Legal</SectionTitle>
        <Card style={{ gap: spacing.md }}>
          {DRAWINGS_ENABLED ? (
            <>
              <Link href="/legal/official-rules" style={styles.link}>Official Rules (DRAFT)</Link>
              <Link href="/legal/amoe" style={styles.link}>Free Entry / AMOE instructions (DRAFT)</Link>
            </>
          ) : null}
          <Link href="/legal/privacy" style={styles.link}>Privacy Policy (DRAFT)</Link>
        </Card>

        {p?.is_admin ? (
          <Button title="Admin console" variant="ghost" onPress={() => router.push("/admin")} />
        ) : null}

        <Button
          title="Sign out"
          variant="ghost"
          onPress={async () => {
            await supabase.auth.signOut();
            qc.clear();
            router.replace("/sign-in");
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  title: { fontFamily: fonts.display, fontSize: 32, color: colors.ink },
  input: {
    backgroundColor: colors.mint,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.sm,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  debtRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  debtName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  remove: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.brick },
  ledgerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  qty: { fontFamily: fonts.displaySemi, fontSize: 16, color: colors.moss },
  link: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.moss },
});
