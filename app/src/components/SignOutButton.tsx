import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { signOut } from 'aws-amplify/auth';
import { useCart } from '@/lib/CartProvider';

// REQ-005: borra la sesión local (tokens de Amplify en AsyncStorage) y el carrito (S-09) y vuelve al
// inicio. signOut sin `global` limpia los tokens locales aunque falle la revocación en Cognito (sin
// red), así que un error no impide salir.
export function SignOutButton() {
  const { clear } = useCart();
  const [busy, setBusy] = useState(false);

  async function onPress() {
    setBusy(true);
    try {
      await signOut();
    } catch {
      // ver arriba: la sesión local ya no se usa
    }
    clear();
    router.replace('/');
  }

  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button">
      <Text style={[styles.text, busy && styles.disabled]}>Cerrar sesión</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  text: { color: '#1f6feb', fontSize: 16 },
  disabled: { opacity: 0.5 },
});
