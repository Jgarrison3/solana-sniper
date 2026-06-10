// Add another debt (post-onboarding), reachable from the Me tab.

import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DebtForm } from "@/components/DebtForm";
import { Button } from "@/components/ui";
import { useAddDebt } from "@/hooks/queries";
import { colors, fonts, spacing } from "@/theme/tokens";

export default function AddDebt() {
  const router = useRouter();
  const addDebt = useAddDebt();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Add a debt</Text>
        <DebtForm
          busy={addDebt.isPending}
          onSubmit={(input) =>
            addDebt.mutate(input, { onSuccess: () => router.back() })
          }
        />
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { flex: 1, padding: spacing.lg, gap: spacing.md },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
});
