import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { OrderStatus } from '@/lib/generated/graphql';
import { fontSize, fontWeight, orderStatus, radius, spacing } from '@/theme';

// REQ-007: estado del pedido como etiqueta de color con su nombre legible (S-17). Por defecto se alinea a
// la izquierda; `style` permite centrarla donde el bloque va centrado (confirmación del Carrito).
export function StatusBadge({ status, style }: { status: OrderStatus; style?: StyleProp<ViewStyle> }) {
  const s = orderStatus[status];
  return (
    <View style={[styles.badge, { backgroundColor: s.background }, style]} testID={`status-${status}`}>
      <Text style={[styles.text, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: { fontSize: fontSize.xs, fontWeight: fontWeight.bold },
});
