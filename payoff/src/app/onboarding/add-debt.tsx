import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DebtForm } from "@/components/DebtForm";
import { useAddDebt } from "@/hooks/queries";
import { colors, fonts, spacing } from "@/theme/tokens";

export default function AddFirstDebt() {
  const router = useRouter();
  const addDebt = useAddDebt();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Add your first debt</Text>
        <Text style={styles.sub}>Takes about a minute. You can add more later.</Text>
        <DebtForm
          busy={addDebt.isPending}
          submitLabel="Add debt"
          onSubmit={(input) =>
            addDebt.mutate(input, {
              onSuccess: ({ debt, tickets_granted }) =>
                router.replace({
                  pathname: "/onboarding/celebrate",
                  params: {
                    tickets: String(tickets_granted),
                    debtId: debt.id,
                  },
                }),
            })
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  sub: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.inkMuted,
    marginBottom: spacing.sm,
  },
});
