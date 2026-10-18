import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { signIn } from 'aws-amplify/auth';
import { isConfigured } from '@/lib/amplify';
import { hasSession, loginErrorMessage } from '@/lib/session';

// REQ-001: con sesión vigente abre el catálogo sin pedir credenciales (E3); si no, pide correo y
// contraseña y, si son inválidas, muestra "Correo o contraseña incorrectos" sin salir de aquí (E2).
export default function LoginScreen() {
  const [checking, setChecking] = useState(isConfigured);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    let active = true;
    void hasSession().then((signedIn) => {
      if (!active) return;
      if (signedIn) router.replace('/catalog');
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
      <View style={styles.container}>
        <Text style={styles.error}>Falta configuración: ejecuta `npm run deploy:dev` (escribe .env.dev).</Text>
      </View>
    );
  }

  if (checking) return <ActivityIndicator style={styles.loading} accessibilityLabel="Comprobando sesión" />;

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

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center', backgroundColor: '#fff' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  button: { backgroundColor: '#1f6feb', borderRadius: 8, padding: 14, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#b00020' },
});
