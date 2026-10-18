import { router } from 'expo-router';
import { useState } from 'react';
import { signOut } from 'aws-amplify/auth';
import { Button } from '@/components/Button';
import { useCart } from '@/lib/CartProvider';

// REQ-005: clears the local session (Amplify tokens in AsyncStorage) and the cart (S-09) and returns to
// the login screen. signOut without `global` clears the local tokens even if the revocation in Cognito
// fails (no network), so an error doesn't prevent leaving.
export function SignOutButton({ variant = 'link' }: { variant?: 'secondary' | 'link' }) {
  const { clear } = useCart();
  const [busy, setBusy] = useState(false);

  async function onPress() {
    setBusy(true);
    try {
      await signOut();
    } catch {
      // see above: the local session is no longer used
    }
    clear();
    router.replace('/');
  }

  return <Button title="Cerrar sesión" variant={variant} onPress={onPress} disabled={busy} />;
}
