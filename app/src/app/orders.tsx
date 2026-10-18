import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatCLP, formatDate, myOrders, type OrderSummary } from '@/lib/api';

// REQ-004: pedidos del más reciente al más antiguo (el servidor ordena) con número, fecha, total y estado.
// El estado vigente se pide de nuevo al volver a la pantalla y al deslizar hacia abajo (S-06).
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

  if (!orders && !error) return <ActivityIndicator style={styles.loading} />;

  return (
    <FlatList
      testID="orders-list"
      data={orders ?? []}
      keyExtractor={(o) => o.id}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={error ? <Text style={[styles.row, styles.error]}>{error}</Text> : null}
      // REQ-004 E4
      ListEmptyComponent={orders ? <Text style={styles.empty}>Todavía no hiciste pedidos</Text> : null}
      contentContainerStyle={orders?.length === 0 && styles.emptyContainer}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id } })}
          accessibilityRole="button"
        >
          <View style={styles.line}>
            <Text style={styles.number}>N° {item.number}</Text>
            <Text style={styles.status}>{item.status}</Text>
          </View>
          <View style={styles.line}>
            <Text style={styles.detail}>{formatDate(item.createdAt)}</Text>
            <Text style={styles.total}>{formatCLP(item.total)}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 32 },
  row: { padding: 16, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  number: { fontSize: 16, fontWeight: '600' },
  status: { fontSize: 14, fontWeight: '600', color: '#1f6feb' },
  detail: { color: '#555' },
  total: { fontWeight: '600' },
  error: { color: '#b00020' },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', fontSize: 16, color: '#555', padding: 24 },
});
