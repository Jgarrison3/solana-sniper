import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Button } from "@/components/ui";
import { TAGLINE } from "@/legal/legal_copy";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setMessage(null);
    try {
      const msg = await fn();
      if (msg) setMessage(msg);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const signIn = () =>
    run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/");
      return null;
    });

  const signUp = () =>
    run(async () => {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      router.replace("/");
      return null;
    });

  const magicLink = () =>
    run(async () => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: "payoff://" },
      });
      if (error) throw error;
      return "Magic link sent — check your email.";
    });

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <Text style={styles.logo}>Pay Off</Text>
        <Text style={styles.tagline}>{TAGLINE}</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.inkMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.inkMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Button title="Sign in" onPress={signIn} loading={busy} />
          <Button title="Create account" onPress={signUp} variant="ghost" disabled={busy} />
          <Button title="Email me a magic link" onPress={magicLink} variant="ghost" disabled={busy || !email} />
          {message ? <Body style={{ textAlign: "center" }}>{message}</Body> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mint },
  container: { flex: 1, justifyContent: "center", padding: spacing.lg },
  logo: {
    fontFamily: fonts.display,
    fontSize: 44,
    color: colors.ink,
    textAlign: "center",
  },
  tagline: {
    fontFamily: fonts.bodyMedium,
    fontSize: 16,
    color: colors.moss,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  form: { gap: spacing.sm },
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
});
