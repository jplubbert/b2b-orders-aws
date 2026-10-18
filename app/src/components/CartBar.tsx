import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatCLP } from '@/lib/api';
import { cartTotal, cartUnits } from '@/lib/cart';
import { useCart } from '@/lib/store/cart';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@/theme';

// REQ-006 E4–E5: fixed bottom bar with the cart's units and total; it always opens the Cart (empty one
// included, where "Confirmar pedido" stays disabled per REQ-003 E5).
export function CartBar() {
  const { cart } = useCart();
  const units = cartUnits(cart);
  const label = units === 0 ? 'Carrito vacío' : `Ver carrito · ${units} u. · ${formatCLP(cartTotal(cart))}`;

  return (
    <SafeAreaView edges={['bottom']} style={styles.bar}>
      <Pressable
        onPress={() => router.push('/cart')}
        accessibilityRole="button"
        accessibilityLabel="Ver carrito"
        style={({ pressed }) => [
          styles.button,
          units === 0 && styles.empty,
          pressed && (units === 0 ? styles.emptyPressed : styles.pressed),
        ]}
      >
        <Text style={[styles.text, units === 0 && styles.emptyText]}>{label}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  button: {
    minHeight: touchTarget,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pressed: { backgroundColor: colors.primaryPressed },
  empty: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  emptyPressed: { opacity: 0.7 },
  text: { color: colors.onPrimary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  emptyText: { color: colors.textMuted },
});
