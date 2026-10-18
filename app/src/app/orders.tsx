import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { StateMessage } from '@/components/StateMessage';
import { StatusBadge } from '@/components/StatusBadge';
import { formatCLP, formatDate, myOrders, type OrderSummary } from '@/lib/api';
import { colors, fontSize, fontWeight, spacing } from '@/theme';

// REQ-004: orders newest first (the server sorts) with number, date, total and status.
// The current status is requested again when returning to the screen and when pulling down (S-06).
export default function OrdersScreen() {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setOrders(await myOrders());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : JSON.stringify(e));
    }
  }, []);

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

  if (!orders && !error) {
    return (
      <Screen style={styles.centered}>
        <StateMessage kind="loading" />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        testID="orders-list"
        data={orders ?? []}
        keyExtractor={(o) => o.id}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListHeaderComponent={error ? <StateMessage kind="error" message={error} /> : null}
        // REQ-004 E4
        ListEmptyComponent={orders ? <StateMessage kind="empty" message="Todavía no hiciste pedidos" /> : null}
        contentContainerStyle={[styles.list, orders?.length === 0 && styles.emptyContainer]}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id } })}
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Card style={styles.order}>
              <View style={styles.line}>
                <Text style={styles.number}>N° {item.number}</Text>
                <StatusBadge status={item.status} />
              </View>
              <View style={styles.line}>
                <Text style={styles.detail}>{formatDate(item.createdAt)}</Text>
                <Text style={styles.total}>{formatCLP(item.total)}</Text>
              </View>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  list: { padding: spacing.lg, gap: spacing.md },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  order: { gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  number: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  detail: { fontSize: fontSize.sm, color: colors.textMuted },
  total: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
});
