import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { StateMessage } from '@/components/StateMessage';
import { StatusBadge } from '@/components/StatusBadge';
import { formatCLP, formatDate, setOrderStatus } from '@/lib/api';
import type { OrderStatus } from '@/lib/generated/graphql';
import { usePanel } from '@/lib/PanelProvider';
import { colors, disabledOpacity, fontSize, fontWeight, orderStatus, radius, spacing, touchTarget } from '@/theme';

// Los 5 estados de S-04 en su orden, con el nombre legible de S-17.
const STATUSES = Object.keys(orderStatus) as OrderStatus[];

// REQ-010: detalle del pedido para el distribuidor (almacén, líneas con precios congelados, total y estado),
// desde la lista del panel ya cargada (como S-19, sin consulta nueva). REQ-011: "Cambiar estado" con los 5
// estados como botones; el elegido se guarda con setOrderStatus y la respuesta del servidor actualiza el
// detalle y el panel. Sin confirmación y sin orden obligatorio; elegir el actual no es error (S-24).
export default function DistOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { orders, replaceOrder } = usePanel();
  const order = orders?.find((o) => o.id === id);
  const [saving, setSaving] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!order) {
    return (
      <Screen style={styles.missing}>
        <StateMessage kind="empty" message="Pedido no encontrado" />
        <Button
          title="Volver a Pedidos"
          variant="secondary"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/dist'))}
        />
      </Screen>
    );
  }

  async function onStatus(status: OrderStatus) {
    if (!order || saving) return;
    setSaving(status);
    setError(null);
    try {
      replaceOrder(await setOrderStatus(order.customerId, order.id, status));
    } catch {
      // E7: el detalle conserva el estado anterior (la lista no cambió).
      setError('No se pudo cambiar el estado');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: `Pedido ${order.number}` }} />
      <FlatList
        testID="dist-order-detail"
        data={order.lines}
        keyExtractor={(l) => l.productId}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Card style={styles.header}>
            <View style={styles.line}>
              <Text style={styles.customer}>Almacén {order.customerId}</Text>
              <StatusBadge status={order.status} />
            </View>
            <Text style={styles.detail}>{formatDate(order.createdAt)}</Text>
          </Card>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Card>
              <Text style={styles.total}>Total {formatCLP(order.total)}</Text>
            </Card>
            <Card style={styles.change}>
              <Text style={styles.heading}>Cambiar estado</Text>
              {error && <StateMessage kind="error" message={error} />}
              <View style={styles.statuses}>
                {STATUSES.map((status) => {
                  const current = status === order.status;
                  const label = orderStatus[status].label;
                  return (
                    <Pressable
                      key={status}
                      onPress={() => void onStatus(status)}
                      disabled={saving !== null}
                      accessibilityRole="button"
                      accessibilityLabel={`Estado ${label}`}
                      accessibilityState={{ selected: current, disabled: saving !== null, busy: saving === status }}
                      style={({ pressed }) => [
                        styles.chip,
                        current && styles.chipSelected,
                        saving !== null && styles.disabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.chipText, current && styles.chipTextSelected]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.item}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.detail}>
              {item.presentation} · {item.quantity} × {formatCLP(item.unitPrice)}
            </Text>
            <Text style={styles.subtotal}>Subtotal {formatCLP(item.subtotal)}</Text>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  missing: { justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  list: { padding: spacing.lg, gap: spacing.md },
  header: { gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  customer: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  item: { gap: spacing.xs },
  name: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  detail: { fontSize: fontSize.sm, color: colors.textMuted },
  subtotal: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  footer: { gap: spacing.md },
  total: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'right' },
  change: { gap: spacing.md },
  heading: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  statuses: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  chipTextSelected: { color: colors.onPrimary },
  disabled: { opacity: disabledOpacity },
  pressed: { opacity: 0.7 },
});
