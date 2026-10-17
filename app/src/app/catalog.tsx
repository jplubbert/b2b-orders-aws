import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { formatCLP, listProducts, type Product } from '@/lib/api';

// T-01: lista de productos del esqueleto andante. Estado vacío de REQ-002 E3 llega en T-04.
export default function CatalogScreen() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProducts()
      .then(setProducts)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : JSON.stringify(e)));
  }, []);

  if (error) return <Text style={[styles.row, styles.error]}>{error}</Text>;
  if (!products) return <ActivityIndicator style={styles.loading} />;

  return (
    <FlatList
      data={products}
      keyExtractor={(p) => p.productId}
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
});
