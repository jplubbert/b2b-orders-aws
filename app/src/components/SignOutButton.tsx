import { router } from 'expo-router';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { signOut } from '@/lib/store/session';

// REQ-005: clears the local session, the cart (S-09) and the panel's list, and returns to the login screen;
// a failed revocation in Cognito doesn't prevent leaving (see `signOut`).
export function SignOutButton({ variant = 'link' }: { variant?: 'secondary' | 'link' }) {
  const [busy, setBusy] = useState(false);

  async function onPress() {
    setBusy(true);
    await signOut();
    router.replace('/');
  }

  return <Button title="Cerrar sesión" variant={variant} onPress={onPress} disabled={busy} />;
}
