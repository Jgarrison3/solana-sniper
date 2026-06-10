// Admin console (bare minimum, intended for web: `npx expo start --web`).
// Guarded by profiles.is_admin — and every query here is additionally
// protected by RLS admin policies, so the guard is defense-in-depth, not
// the security boundary.
//
// Capabilities: create/edit drawings, run a draw manually, advance payout
// statuses (concierge payout), and inspect the ticket ledger.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Button, Card, Pill, SectionTitle } from "@/components/ui";
import { useProfile } from "@/hooks/queries";
import { formatMoney } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing, tabularNums } from "@/theme/tokens";

interface AdminDrawing {
  id: string;
  name: string;
  prize_amount: number;
  sponsor_name: string;
  sponsor_blurb: string | null;
  opens_at: string;
  closes_at: string;
  status: string;
  rng_seed_commitment: string | null;
}

interface AdminPayout {
  id: string;
  drawing_id: string;
  member_id: string;
  amount: number;
  creditor_name: string | null;
  account_reference: string | null;
  status: "pending_claim" | "claimed" | "payment_sent" | "confirmed";
}

function useAdminDrawings() {
  return useQuery({
    queryKey: ["admin", "drawings"],
    queryFn: async (): Promise<AdminDrawing[]> => {
      const { data, error } = await supabase
        .from("drawings")
        .select("id, name, prize_amount, sponsor_name, sponsor_blurb, opens_at, closes_at, status, rng_seed_commitment")
        .order("closes_at", { ascending: false });
      if (error) throw error;
      return data as AdminDrawing[];
    },
  });
}

function useAdminPayouts() {
  return useQuery({
    queryKey: ["admin", "payouts"],
    queryFn: async (): Promise<AdminPayout[]> => {
      const { data, error } = await supabase
        .from("payouts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AdminPayout[];
    },
  });
}

function useAdminLedger() {
  return useQuery({
    queryKey: ["admin", "ledger"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_ledger")
        .select("id, member_id, qty, drawing_id, created_at, earning_rules(code)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
}

const NEXT_PAYOUT_STATUS: Record<string, AdminPayout["status"] | undefined> = {
  claimed: "payment_sent",
  payment_sent: "confirmed",
};

export default function Admin() {
  const router = useRouter();
  const qc = useQueryClient();
  const profile = useProfile();
  const drawings = useAdminDrawings();
  const payouts = useAdminPayouts();
  const ledger = useAdminLedger();

  const [name, setName] = useState("");
  const [prize, setPrize] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [blurb, setBlurb] = useState("");
  const [daysOpen, setDaysOpen] = useState("14");
  const [message, setMessage] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin"] });

  const createDrawing = useMutation({
    mutationFn: async () => {
      const days = parseInt(daysOpen, 10) || 14;
      const { error } = await supabase.from("drawings").insert({
        name,
        prize_amount: parseFloat(prize),
        sponsor_name: sponsor,
        sponsor_blurb: blurb || null,
        opens_at: new Date().toISOString(),
        closes_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage("Drawing created — seed committed automatically.");
      setName(""); setPrize(""); setSponsor(""); setBlurb("");
      invalidate();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : "Create failed"),
  });

  const runDraw = useMutation({
    mutationFn: async (drawingId: string) => {
      const { data, error } = await supabase.functions.invoke("run-draw", {
        body: { drawing_id: drawingId, force: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setMessage(`Draw complete: ${JSON.stringify(data)}`);
      invalidate();
      qc.invalidateQueries({ queryKey: ["drawings"] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : "Draw failed"),
  });

  const advancePayout = useMutation({
    mutationFn: async (p: AdminPayout) => {
      const next = NEXT_PAYOUT_STATUS[p.status];
      if (!next) throw new Error("No further transition");
      const { error } = await supabase
        .from("payouts")
        .update({ status: next })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e) => setMessage(e instanceof Error ? e.message : "Update failed"),
  });

  if (profile.isLoading) return null;
  if (!profile.data?.is_admin) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={[styles.container, { justifyContent: "center" }]}>
          <Body muted>Admins only.</Body>
          <Button title="Back" variant="ghost" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Pay Off admin</Text>
        {message ? <Card><Body style={{ fontSize: 13 }}>{message}</Body></Card> : null}

        <SectionTitle>Create a drawing</SectionTitle>
        <Card style={{ gap: spacing.sm }}>
          <TextInput style={styles.input} placeholder="Name (e.g. June Payoff Drop)" placeholderTextColor={colors.inkMuted} value={name} onChangeText={setName} />
          <TextInput style={styles.input} placeholder="Prize amount ($)" placeholderTextColor={colors.inkMuted} value={prize} onChangeText={setPrize} keyboardType="decimal-pad" />
          <TextInput style={styles.input} placeholder="Sponsor name" placeholderTextColor={colors.inkMuted} value={sponsor} onChangeText={setSponsor} />
          <TextInput style={styles.input} placeholder="Sponsor blurb (optional)" placeholderTextColor={colors.inkMuted} value={blurb} onChangeText={setBlurb} />
          <TextInput style={styles.input} placeholder="Days open" placeholderTextColor={colors.inkMuted} value={daysOpen} onChangeText={setDaysOpen} keyboardType="number-pad" />
          <Button
            title="Create drawing"
            onPress={() => createDrawing.mutate()}
            loading={createDrawing.isPending}
            disabled={!name || !prize || !sponsor}
          />
        </Card>

        <SectionTitle>Drawings</SectionTitle>
        {(drawings.data ?? []).map((d) => (
          <Card key={d.id} style={{ gap: spacing.sm }}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemName}>{d.name}</Text>
              <Pill label={d.status} color={d.status === "open" ? colors.mossSoft : colors.goldSoft}
                textColor={d.status === "open" ? colors.moss : colors.ink} />
            </View>
            <Body muted style={{ fontSize: 13 }}>
              {formatMoney(Number(d.prize_amount))} · {d.sponsor_name} · closes{" "}
              {new Date(d.closes_at).toLocaleString()}
            </Body>
            {d.rng_seed_commitment ? (
              <Body muted style={{ fontSize: 11 }}>commitment {d.rng_seed_commitment.slice(0, 24)}…</Body>
            ) : null}
            {d.status === "open" ? (
              <Button
                title="Run draw now"
                variant="gold"
                onPress={() => runDraw.mutate(d.id)}
                loading={runDraw.isPending}
              />
            ) : null}
          </Card>
        ))}

        <SectionTitle>Payouts (concierge)</SectionTitle>
        {(payouts.data ?? []).length === 0 ? (
          <Card><Body muted>No payouts yet.</Body></Card>
        ) : (
          (payouts.data ?? []).map((p) => (
            <Card key={p.id} style={{ gap: spacing.sm }}>
              <View style={styles.rowBetween}>
                <Text style={styles.itemName}>{formatMoney(Number(p.amount))}</Text>
                <Pill label={p.status} />
              </View>
              <Body muted style={{ fontSize: 13 }}>
                {p.creditor_name
                  ? `${p.creditor_name} · ref ${p.account_reference ?? "—"}`
                  : "Awaiting winner's claim details"}
              </Body>
              {NEXT_PAYOUT_STATUS[p.status] ? (
                <Button
                  title={`Mark ${NEXT_PAYOUT_STATUS[p.status]!.replace("_", " ")}`}
                  onPress={() => advancePayout.mutate(p)}
                  loading={advancePayout.isPending}
                />
              ) : null}
            </Card>
          ))
        )}

        <SectionTitle>Ticket ledger (latest 100)</SectionTitle>
        {(ledger.data ?? []).map((row) => (
          <View key={row.id as string} style={styles.ledgerRow}>
            <Text style={[styles.ledgerText, tabularNums]}>
              +{row.qty as number}
            </Text>
            <Text style={styles.ledgerText} numberOfLines={1}>
              {(row.earning_rules as { code?: string } | null)?.code ?? "?"} ·{" "}
              {(row.member_id as string).slice(0, 8)} ·{" "}
              {new Date(row.created_at as string).toLocaleString()}
            </Text>
          </View>
        ))}

        <Button title="Back to app" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl, maxWidth: 720, width: "100%", alignSelf: "center" },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.ink },
  input: {
    backgroundColor: colors.mint,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.sm,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
  },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  ledgerRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: 4 },
  ledgerText: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
});
