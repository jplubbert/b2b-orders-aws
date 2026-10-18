import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { formatCLP, formatDate, getOrder, type OrderDetail } from '@/lib/api';

// REQ-004: líneas con los precios congelados al confirmar (E5) y el estado vigente, que se pide de nuevo
// al volver a la pantalla y al deslizar hacia abajo (S-06). Un pedido ajeno llega como null (E3).
export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setOrder(await getOrder(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : JSON.stringify(e));
    }
  }, [id]);

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

  if (order === undefined && !error) return <ActivityIndicator style={styles.loading} />;
  if (order === null) return <Text style={styles.empty}>Pedido no encontrado</Text>;

  return (
    <FlatList
      testID="order-detail"
      data={order?.lines ?? []}
      keyExtractor={(l) => l.productId}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={
        <>
          {error && <Text style={[styles.row, styles.error]}>{error}</Text>}
          {order && (
            <View style={styles.row}>
              <View style={styles.line}>
                <Text style={styles.number}>N° {order.number}</Text>
                <Text style={styles.status}>{order.status}</Text>
              </View>
              <Text style={styles.detail}>{formatDate(order.createdAt)}</Text>
            </View>
          )}
        </>
      }
      ListFooterComponent={
        order ? <Text style={[styles.row, styles.total]}>Total {formatCLP(order.total)}</Text> : null
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.detail}>
            {item.presentation} · {item.quantity} × {formatCLP(item.unitPrice)}
          </Text>
          <Text style={styles.subtotal}>Subtotal {formatCLP(item.subtotal)}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 32 },
  row: { padding: 16, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  number: { fontSize: 18, fontWeight: '700' },
  status: { fontSize: 16, fontWeight: '600', color: '#1f6feb' },
  name: { fontSize: 16, fontWeight: '600' },
  detail: { color: '#555' },
  subtotal: { fontWeight: '600' },
  total: { fontSize: 18, fontWeight: '700', textAlign: 'right' },
  error: { color: '#b00020' },
  empty: { textAlign: 'center', fontSize: 16, color: '#555', padding: 24 },
});
