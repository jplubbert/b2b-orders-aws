import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { signIn } from 'aws-amplify/auth';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { StateMessage } from '@/components/StateMessage';
import { isConfigured } from '@/lib/amplify';
import { currentSession, type Home, loginErrorMessage, NO_ACCESS, rejectSession } from '@/lib/session';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@/theme';

// REQ-001: with a live session it opens the role's screen without asking for credentials (E3, REQ-009 E4);
// otherwise it asks for email and password and, if they're invalid, shows "Correo o contraseña incorrectos"
// without leaving (E2). REQ-009: almaceneros → catalog, distribuidores → "Pedidos" panel; no group → NO_ACCESS,
// session closed and it stays on the login screen (E3).
export default function LoginScreen() {
  const [checking, setChecking] = useState(isConfigured);
  const [home, setHome] = useState<Home | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    let active = true;
    void (async () => {
      const session = await currentSession();
      if (session && !session.home) await rejectSession();
      if (!active) return;
      // No `router.replace` here: when the app opens, the session may resolve before the root navigator
      // is mounted ("Can't perform a React state update on a component that hasn't mounted yet").
      // `<Redirect>` navigates only once this screen has focus inside the navigator.
      if (session?.home) return setHome(session.home);
      if (session) setError(NO_ACCESS);
      setChecking(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // After signing in, the role comes from the groups of the freshly issued token (REQ-009 E1–E3).
  async function enter() {
    const target = (await currentSession())?.home;
    if (target) return router.replace(target);
    await rejectSession();
    setError(NO_ACCESS);
  }

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      // USER_PASSWORD_AUTH instead of SRP: SRP needs the AmplifyRTNCore native module, missing in Expo Go.
      const { isSignedIn, nextStep } = await signIn({
        username: email.trim(),
        password,
        options: { authFlowType: 'USER_PASSWORD_AUTH' },
      });
      if (isSignedIn) await enter();
      else setError(`Paso pendiente: ${nextStep.signInStep}`);
    } catch (e) {
      // There may be a session the initial check didn't see (e.g. a freshly renewed token).
      if (e instanceof Error && e.name === 'UserAlreadyAuthenticatedException') await enter();
      else setError(loginErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!isConfigured) {
    return (
      <Screen style={styles.centered}>
        <StateMessage kind="error" message="Falta configuración: ejecuta `npm run deploy:dev` (escribe .env.dev)." />
      </Screen>
    );
  }

  if (home) return <Redirect href={home} />;

  if (checking) {
    return (
      <Screen style={styles.centered}>
        <StateMessage kind="loading" label="Comprobando sesión" />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* S-16: the demo's neutral brand. */}
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>B2B</Text>
          </View>
          <Text style={styles.brandName} accessibilityRole="header">
            Pedidos B2B
          </Text>
          <Text style={styles.tagline}>Catálogo y pedidos para tu almacén</Text>
        </View>
        <Card style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Correo"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error && <StateMessage kind="error" message={error} />}
          <Button title="Ingresar" loading={busy} disabled={!email || !password} onPress={onSubmit} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.xl },
  brand: { alignItems: 'center', gap: spacing.sm },
  logo: {
    width: spacing.xxl * 2,
    height: spacing.xxl * 2,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.onPrimary },
  brandName: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  tagline: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  form: { gap: spacing.md },
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
});
