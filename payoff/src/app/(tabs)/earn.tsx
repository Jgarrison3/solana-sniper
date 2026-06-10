// Earn: the actionable list of earning rules with this month's progress
// against caps, the log-a-payment entry point, and the daily lesson card.

import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Button, Card, Pill, SectionTitle } from "@/components/ui";
import {
  useCompleteLesson,
  useDailyLesson,
  useEarningRules,
  useLedger,
  type EarningRuleRow,
  type LedgerRow,
} from "@/hooks/queries";
import { colors, fonts, spacing } from "@/theme/tokens";

function monthUsage(ledger: LedgerRow[], code: string) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const rows = ledger.filter(
    (r) => r.earning_rules?.code === code && r.created_at.slice(0, 7) === thisMonth,
  );
  return {
    events: rows.length,
    tickets: rows.reduce((s, r) => s + r.qty, 0),
  };
}

function progressLabel(rule: EarningRuleRow, usage: { events: number; tickets: number }) {
  if (rule.max_tickets_per_month != null) {
    return `${usage.tickets}/${rule.max_tickets_per_month} tickets this month`;
  }
  if (rule.max_per_day != null) {
    return usage.events > 0 ? "done today ✓" : "available today";
  }
  if (rule.max_per_month != null) {
    return `${usage.events}/${rule.max_per_month} this month`;
  }
  if (rule.max_per_debt_per_month != null) {
    return `${usage.events} logged this month`;
  }
  if (rule.once_per_debt) {
    return `${usage.events ? `earned ${usage.tickets} this month` : "once per debt"}`;
  }
  return "";
}

export default function Earn() {
  const router = useRouter();
  const rules = useEarningRules();
  const ledger = useLedger();
  const daily = useDailyLesson();
  const complete = useCompleteLesson();

  const visibleRules = (rules.data ?? []).filter((r) => r.code !== "amoe");
  const amoeRule = (rules.data ?? []).find((r) => r.code === "amoe");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Earn tickets</Text>
        <Body muted>
          Every ticket is free. Earn them by doing the things that get you out
          of debt anyway.
        </Body>

        <Button title="Log a payment" onPress={() => router.push("/log-payment")} />

        <SectionTitle>Today&apos;s lesson</SectionTitle>
        {daily.data?.lesson ? (
          <Card style={{ gap: spacing.sm }}>
            <View style={styles.lessonHeader}>
              <Text style={styles.lessonTitle}>{daily.data.lesson.title}</Text>
              <Pill
                label="+3 tickets"
                color={colors.goldSoft}
                textColor={colors.ink}
              />
            </View>
            <Body>{daily.data.lesson.body}</Body>
            {daily.data.completedToday ? (
              <Body muted>Lesson done today ✓ — come back tomorrow.</Body>
            ) : (
              <Button
                title="I read it — collect 3 tickets"
                variant="gold"
                loading={complete.isPending}
                onPress={() => complete.mutate(daily.data!.lesson!.id)}
              />
            )}
          </Card>
        ) : null}

        <SectionTitle>Ways to earn</SectionTitle>
        {visibleRules.map((rule) => {
          const usage = monthUsage(ledger.data ?? [], rule.code);
          return (
            <Card key={rule.id} style={styles.ruleCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ruleName}>{rule.name}</Text>
                <Body muted style={{ fontSize: 13 }}>{rule.description}</Body>
                {progressLabel(rule, usage) ? (
                  <Body style={{ fontSize: 12, color: colors.moss, marginTop: 4 }}>
                    {progressLabel(rule, usage)}
                  </Body>
                ) : null}
              </View>
              <Pill
                label={
                  rule.unit === "dollars_extra"
                    ? `+${rule.base_tickets}/$${rule.unit_size}`
                    : `+${rule.base_tickets}`
                }
                color={colors.goldSoft}
                textColor={colors.ink}
              />
            </Card>
          );
        })}

        {amoeRule ? (
          <Card style={{ backgroundColor: "transparent", borderStyle: "dashed" }}>
            <Body muted style={{ fontSize: 13 }}>
              Prefer not to use the app? A free alternative method of entry is
              always available — see Me → Free Entry (AMOE) for instructions.
            </Body>
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  title: { fontFamily: fonts.display, fontSize: 32, color: colors.ink },
  lessonHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  lessonTitle: { fontFamily: fonts.displaySemi, fontSize: 17, color: colors.ink, flex: 1 },
  ruleCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ruleName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
});
