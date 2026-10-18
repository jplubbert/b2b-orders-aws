import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { signIn } from 'aws-amplify/auth';
import { isConfigured } from '@/lib/amplify';

// T-01: inicio de sesión mínimo. Sesión persistente y mensajes de REQ-001 E2/E3 llegan en T-07.
export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!isConfigured) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Falta configuración: ejecuta `npm run deploy:dev` (escribe .env.dev).</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Correo"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Contraseña"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.button, (busy || !email || !password) && styles.disabled]}
        disabled={busy || !email || !password}
        onPress={onSubmit}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Ingresar</Text>}
      </Pressable>
    </View>
  );
}

// Amplify envuelve fallos de red o de módulos nativos en "An unknown error has occurred";
// la causa real va en `underlyingError`, así que se muestra completa.
function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const { recoverySuggestion, underlyingError } = e as Error & {
    recoverySuggestion?: string;
    underlyingError?: unknown;
  };
  const parts = [`${e.name}: ${e.message}`];
  if (underlyingError) {
    parts.push(
      underlyingError instanceof Error
        ? `Causa: ${underlyingError.name}: ${underlyingError.message}`
        : `Causa: ${String(underlyingError)}`,
    );
  }
  if (recoverySuggestion) parts.push(recoverySuggestion);
  return parts.join('\n');
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center', backgroundColor: '#fff' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  button: { backgroundColor: '#1f6feb', borderRadius: 8, padding: 14, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#b00020' },
});
