import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { SignOutButton } from '@/components/SignOutButton';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@/theme';

// REQ-006 (S-15): botón de cuenta con la inicial del correo; abre un menú con el correo de la sesión,
// "Cerrar sesión" (REQ-005) y "Cancelar". Tocar fuera, "Cancelar" o el botón atrás de Android lo cierran
// sin tocar la sesión ni el carrito (E3). El correo sale de los atributos de Cognito vía Amplify.
export function AccountMenu() {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const attributes = await fetchUserAttributes();
        if (alive) setEmail(attributes.email ?? null);
      } catch {
        // sin correo: el botón muestra "?" y el menú igual permite cerrar sesión
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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
