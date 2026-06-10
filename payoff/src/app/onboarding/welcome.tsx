import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Button } from "@/components/ui";
import { DRAWINGS_ENABLED } from "@/lib/featureFlags";
import { NO_PURCHASE_EVER, TAGLINE } from "@/legal/legal_copy";
import { colors, fonts, spacing } from "@/theme/tokens";

export default function Welcome() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={{ flex: 1, justifyContent: "center", gap: spacing.md }}>
          <Text style={styles.title}>Pay Off</Text>
          <Text style={styles.tagline}>{TAGLINE}</Text>
          <Body>
            Track your debts, watch them drain, and celebrate every payment.
          </Body>
          {DRAWINGS_ENABLED ? (
            <>
              <Body>
                Healthy payoff moves earn free tickets into sponsor-funded
                Payoff Drops — drawings whose prize is paid straight to the
                winner&apos;s creditor.
              </Body>
              <Body muted>{NO_PURCHASE_EVER}</Body>
            </>
          ) : null}
        </View>
        <Button title="Add your first debt" onPress={() => router.push("/onboarding/add-debt")} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { flex: 1, padding: spacing.lg },
  title: { fontFamily: fonts.display, fontSize: 40, color: colors.ink },
  tagline: { fontFamily: fonts.displaySemi, fontSize: 20, color: colors.moss },
});
