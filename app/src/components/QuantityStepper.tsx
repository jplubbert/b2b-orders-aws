import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MAX_QUANTITY } from '@/lib/cart';

// − cantidad +; con 0 el producto sale del carrito.
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1f6feb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.3 },
  sign: { color: '#fff', fontSize: 20, fontWeight: '600' },
  quantity: { minWidth: 32, textAlign: 'center', fontSize: 16 },
});
