import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { signIn } from 'aws-amplify/auth';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { StateMessage } from '@/components/StateMessage';
import { isConfigured } from '@/lib/amplify';
import { hasSession, loginErrorMessage } from '@/lib/session';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@/theme';

// REQ-001: con sesión vigente abre el catálogo sin pedir credenciales (E3); si no, pide correo y
// contraseña y, si son inválidas, muestra "Correo o contraseña incorrectos" sin salir de aquí (E2).
export default function LoginScreen() {
  const [checking, setChecking] = useState(isConfigured);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    let active = true;
    void hasSession().then((found) => {
      if (!active) return;
      // Sin `router.replace` aquí: al abrir la app la sesión puede resolverse antes de que el navegador
      // raíz esté montado ("Can't perform a React state update on a component that hasn't mounted yet").
      // `<Redirect>` navega recién cuando esta pantalla tiene foco dentro del navegador.
      if (found) setSignedIn(true);
      else setChecking(false);
    });
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      // USER_PASSWORD_AUTH en vez de SRP: SRP necesita el módulo nativo AmplifyRTNCore, ausente en Expo Go.
      const { isSignedIn, nextStep } = await signIn({
        username: email.trim(),
        password,
        options: { authFlowType: 'USER_PASSWORD_AUTH' },
      });
      if (isSignedIn) router.replace('/catalog');
      else setError(`Paso pendiente: ${nextStep.signInStep}`);
    } catch (e) {
      // Puede quedar una sesión que la comprobación inicial no vio (p. ej. un token recién renovado).
      if (e instanceof Error && e.name === 'UserAlreadyAuthenticatedException') router.replace('/catalog');
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

  if (signedIn) return <Redirect href="/catalog" />;

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
        {/* S-16: marca neutra de la demo. */}
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
