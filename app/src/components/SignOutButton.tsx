import { router } from 'expo-router';
import { useState } from 'react';
import { signOut } from 'aws-amplify/auth';
import { Button } from '@/components/Button';
import { useCart } from '@/lib/CartProvider';

// REQ-005: borra la sesión local (tokens de Amplify en AsyncStorage) y el carrito (S-09) y vuelve al
// inicio. signOut sin `global` limpia los tokens locales aunque falle la revocación en Cognito (sin
// red), así que un error no impide salir.
export function SignOutButton({ variant = 'link' }: { variant?: 'secondary' | 'link' }) {
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

  return <Button title="Cerrar sesión" variant={variant} onPress={onPress} disabled={busy} />;
}
