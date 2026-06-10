// Entry router: signed out → sign-in; signed in with no debts →
// onboarding; otherwise the tabs.

import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/hooks/useAuth";
import { useDebts } from "@/hooks/queries";
import { colors } from "@/theme/tokens";

function Splash() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.mint }}>
      <ActivityIndicator color={colors.moss} />
    </View>
  );
}

function SignedInGate() {
  const debts = useDebts();
  if (debts.isLoading) return <Splash />;
  if ((debts.data ?? []).length === 0) return <Redirect href="/onboarding/welcome" />;
  return <Redirect href="/home" />;
}

export default function Index() {
  const { session, loading } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Redirect href="/sign-in" />;
  return <SignedInGate />;
}
