import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { formatCLP, listProducts, type Product } from '@/lib/api';

// REQ-002: productos activos ordenados por nombre (el servidor filtra y ordena) con presentación y precio.
export default function CatalogScreen() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setProducts(await listProducts());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : JSON.stringify(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Deslizar hacia abajo vuelve a pedir el catálogo (p. ej. tras activar o desactivar productos).
  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!products && !error) return <ActivityIndicator style={styles.loading} />;

  return (
    <FlatList
      data={products ?? []}
      keyExtractor={(p) => p.productId}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={error ? <Text style={[styles.row, styles.error]}>{error}</Text> : null}
      // REQ-002 E3
      ListEmptyComponent={products ? <Text style={styles.empty}>No hay productos disponibles</Text> : null}
      contentContainerStyle={products?.length === 0 && styles.emptyContainer}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.detail}>
            {item.presentation} · {formatCLP(item.unitPrice)}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 32 },
  row: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  name: { fontSize: 16, fontWeight: '600' },
  detail: { color: '#555', marginTop: 4 },
  error: { color: '#b00020' },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', fontSize: 16, color: '#555', padding: 24 },
});
