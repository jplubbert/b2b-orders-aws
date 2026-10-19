import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/Card';
import { OrderHistory, useOrderHistory } from '@/components/OrderHistory';
import { Screen } from '@/components/Screen';
import { StateMessage } from '@/components/StateMessage';
import { StatusBadge } from '@/components/StatusBadge';
import { formatCLP, formatDate, getOrder, type OrderDetail } from '@/lib/api';
import { colors, fontSize, fontWeight, spacing } from '@/theme';

// REQ-004: lines with the prices frozen at confirmation (E5) and the current status, which is requested again
// when returning to the screen and when pulling down (S-06). Another customer's order arrives as null (E3).
// REQ-012: "Historial" under the status and the date, loaded at the same moments in a query of its own (S-37).
export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { entry: history, reload: loadHistory } = useOrderHistory(id);

  const load = useCallback(async () => {
    const historyLoaded = loadHistory();
    try {
      setOrder(await getOrder(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : JSON.stringify(e));
    }
    await historyLoaded;
  }, [id, loadHistory]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (order === undefined && !error) {
    return (
      <Screen style={styles.centered}>
        <StateMessage kind="loading" />
      </Screen>
    );
  }
  if (order === null) {
    return (
      <Screen style={styles.centered}>
        <StateMessage kind="empty" message="Pedido no encontrado" />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        testID="order-detail"
        data={order?.lines ?? []}
        keyExtractor={(l) => l.productId}
        refreshing={refreshing}
        onRefresh={onRefresh}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            {error && <StateMessage kind="error" message={error} />}
            {order && (
              <View style={styles.top}>
                <Card style={styles.header}>
                  <View style={styles.line}>
                    <Text style={styles.number}>N° {order.number}</Text>
                    <StatusBadge status={order.status} />
                  </View>
                  <Text style={styles.detail}>{formatDate(order.createdAt)}</Text>
                </Card>
                <OrderHistory entry={history} />
              </View>
            )}
          </>
        }
        ListFooterComponent={
          order ? (
            <Card>
              <Text style={styles.total}>Total {formatCLP(order.total)}</Text>
            </Card>
          ) : null
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
  centered: { justifyContent: 'center' },
  list: { padding: spacing.lg, gap: spacing.md },
  top: { gap: spacing.md },
  header: { gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  number: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  item: { gap: spacing.xs },
  name: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  detail: { fontSize: fontSize.sm, color: colors.textMuted },
  subtotal: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  total: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'right' },
});
