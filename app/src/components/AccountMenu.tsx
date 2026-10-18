import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { SignOutButton } from '@/components/SignOutButton';
import { useSession } from '@/lib/store/session';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@/theme';

// REQ-006 (S-15): account button with the email's initial; it opens a menu with the session's email,
// "Cerrar sesión" (REQ-005) and "Cancelar". Tapping outside, "Cancelar" or Android's back button close it
// without touching the session or the cart (E3). The email comes from the session store (DEC-021); if the
// ID token didn't carry it, from the Cognito attributes via Amplify.
export function AccountMenu() {
  const email = useSession((s) => s.email);
  const setEmail = useSession((s) => s.setEmail);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (email) return;
    let alive = true;
    void (async () => {
      try {
        const attributes = await fetchUserAttributes();
        if (alive) setEmail(attributes.email ?? null);
      } catch {
        // no email: the button shows "?" and the menu still allows signing out
      }
    })();
    return () => {
      alive = false;
    };
  }, [email, setEmail]);

  const close = () => setOpen(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Cuenta"
        style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
      >
        <Text style={styles.initial}>{email ? email[0].toUpperCase() : '?'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close} testID="account-menu">
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Cerrar menú de cuenta" />
          <Card style={styles.menu}>
            <Text style={styles.label}>Sesión iniciada como</Text>
            <Text style={styles.email}>{email ?? '—'}</Text>
            <SignOutButton variant="secondary" />
            <Button title="Cancelar" variant="link" onPress={close} />
          </Card>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.primaryPressed },
  initial: { color: colors.onPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  overlay: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.backdrop },
  menu: { gap: spacing.md, borderRadius: radius.lg },
  label: { fontSize: fontSize.sm, color: colors.textMuted },
  email: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
});
