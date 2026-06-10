// Legal pages. All copy comes from src/legal/legal_copy.ts — one file for
// counsel to review. Everything is DRAFT, NOT LEGAL ADVICE.

import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Button } from "@/components/ui";
import {
  AMOE_INSTRUCTIONS,
  LEGAL_DRAFT_BANNER,
  OFFICIAL_RULES,
  PRIVACY_POLICY,
} from "@/legal/legal_copy";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

const PAGES: Record<string, { title: string; body: string }> = {
  "official-rules": { title: "Official Rules", body: OFFICIAL_RULES },
  amoe: { title: "Free Entry (AMOE)", body: AMOE_INSTRUCTIONS },
  privacy: { title: "Privacy Policy", body: PRIVACY_POLICY },
};

export default function LegalPage() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const page = PAGES[slug ?? ""] ?? PAGES["official-rules"];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{LEGAL_DRAFT_BANNER}</Text>
        </View>
        <Text style={styles.title}>{page.title}</Text>
        <Body style={{ fontSize: 14, lineHeight: 22 }}>{page.body}</Body>
        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  banner: {
    backgroundColor: colors.brick,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  bannerText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.white,
    textAlign: "center",
  },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
});
