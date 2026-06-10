// Drops: featured drawing (gold card, countdown, sponsor), upcoming
// drawings, winners feed, and the required fine print.

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Countdown } from "@/components/Countdown";
import { Body, Card, Money, Pill, SectionTitle } from "@/components/ui";
import { useDrawings, useNextDrawing, useTicketCount, useWinnersFeed } from "@/hooks/queries";
import { formatFullDate } from "@/lib/format";
import {
  DEBT_TYPE_PHRASES,
  FINE_PRINT,
  WINNER_FEED_TEMPLATE,
} from "@/legal/legal_copy";
import { formatMoney } from "@/lib/format";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

export default function Drops() {
  const drawings = useDrawings();
  const { next } = useNextDrawing();
  const tickets = useTicketCount(next?.id);
  const winners = useWinnersFeed();

  const now = Date.now();
  const upcoming = (drawings.data ?? []).filter(
    (d) => d.id !== next?.id && d.status === "open" && new Date(d.closes_at).getTime() > now,
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Payoff Drops</Text>

        {next ? (
          <View style={styles.featured}>
            <Pill label={`Sponsored by ${next.sponsor_name}`} color="#0C322A22" textColor={colors.ink} />
            <Text style={styles.featuredName}>{next.name}</Text>
            <Money amount={Number(next.prize_amount)} size={44} color={colors.ink} />
            <Body style={{ color: colors.ink, opacity: 0.8 }}>
              paid directly to the winner&apos;s creditor
            </Body>
            <View style={styles.countdownRow}>
              <Body style={{ color: colors.ink, fontFamily: fonts.bodySemi }}>Closes in</Body>
              <Countdown closesAt={next.closes_at} color={colors.ink} />
            </View>
            <View style={styles.ticketRow}>
              <Body style={{ color: colors.ink }}>
                Your tickets in this drop:{" "}
                <Text style={{ fontFamily: fonts.bodyBold }}>{tickets.data ?? 0}</Text>
              </Body>
            </View>
            {next.sponsor_blurb ? (
              <Body style={{ color: colors.ink, opacity: 0.7, fontSize: 13 }}>
                {next.sponsor_blurb}
              </Body>
            ) : null}
            {next.rng_seed_commitment ? (
              <Body style={{ color: colors.ink, opacity: 0.55, fontSize: 11 }}>
                Provably fair — seed commitment{" "}
                {next.rng_seed_commitment.slice(0, 16)}… published before close.
              </Body>
            ) : null}
          </View>
        ) : (
          <Card>
            <Body muted>No open drop right now. Check back soon!</Body>
          </Card>
        )}

        {upcoming.length > 0 ? (
          <>
            <SectionTitle>Upcoming</SectionTitle>
            {upcoming.map((d) => (
              <Card key={d.id} style={styles.upcomingCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.upcomingName}>{d.name}</Text>
                  <Body muted style={{ fontSize: 13 }}>
                    Sponsored by {d.sponsor_name} · closes {formatFullDate(d.closes_at)}
                  </Body>
                </View>
                <Money amount={Number(d.prize_amount)} color={colors.moss} />
              </Card>
            ))}
          </>
        ) : null}

        <SectionTitle>Recent winners</SectionTitle>
        {(winners.data ?? []).length === 0 ? (
          <Card>
            <Body muted>Winners appear here after the first drop is paid out.</Body>
          </Card>
        ) : (
          (winners.data ?? []).map((w, i) => (
            <Card key={i}>
              <Body>
                {WINNER_FEED_TEMPLATE(
                  w.first_name ?? "A member",
                  w.last_initial ?? "",
                  w.city ?? "somewhere",
                  formatMoney(Number(w.amount)),
                  DEBT_TYPE_PHRASES[w.debt_type ?? "other"],
                )}
              </Body>
              <Body muted style={{ fontSize: 12, marginTop: 4 }}>
                {w.drawing_name} · sponsored by {w.sponsor_name}
              </Body>
            </Card>
          ))
        )}

        <Text style={styles.finePrint}>{FINE_PRINT}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  title: { fontFamily: fonts.display, fontSize: 32, color: colors.ink },
  featured: {
    backgroundColor: colors.gold,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  featuredName: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  countdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFFFFF55",
    borderRadius: radii.md,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  ticketRow: { marginTop: 2 },
  upcomingCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  upcomingName: { fontFamily: fonts.displaySemi, fontSize: 16, color: colors.ink },
  finePrint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.inkMuted,
    textAlign: "center",
    marginTop: spacing.lg,
    lineHeight: 18,
  },
});
