import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { OrderStatus } from '@/lib/generated/graphql';
import { fontSize, fontWeight, orderStatus, radius, spacing } from '@/theme';

// REQ-007: order status as a colored label with its readable name (S-17). Left-aligned by default;
// `style` lets it be centered where the block is centered (the Cart's confirmation).
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
