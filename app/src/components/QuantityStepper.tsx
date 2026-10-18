import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MAX_QUANTITY } from '@/lib/cart';
import { colors, disabledOpacity, fontSize, fontWeight, radius, spacing, touchTarget } from '@/theme';

// − quantity +; at 0 the product leaves the cart. 44 dp buttons (REQ-007 E4).
export function QuantityStepper({ quantity, onChange }: { quantity: number; onChange: (q: number) => void }) {
  return (
    <View style={styles.row}>
      <Pressable
        style={[styles.button, quantity === 0 && styles.disabled]}
        disabled={quantity === 0}
        onPress={() => onChange(quantity - 1)}
        accessibilityLabel="Quitar uno"
      >
        <Text style={styles.sign}>−</Text>
      </Pressable>
      <Text style={styles.quantity}>{quantity}</Text>
      <Pressable
        style={[styles.button, quantity >= MAX_QUANTITY && styles.disabled]}
        disabled={quantity >= MAX_QUANTITY}
        onPress={() => onChange(quantity + 1)}
        accessibilityLabel="Agregar uno"
      >
        <Text style={styles.sign}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  button: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: disabledOpacity },
  sign: { color: colors.onPrimary, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  quantity: {
    minWidth: spacing.xxl,
    textAlign: 'center',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
});
