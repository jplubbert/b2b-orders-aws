import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { QuantityStepper } from '@/components/QuantityStepper';
import { formatCLP, listProducts, type Product } from '@/lib/api';
import { cartUnits, quantityOf } from '@/lib/cart';
import { useCart } from '@/lib/CartProvider';

// REQ-002: productos activos ordenados por nombre (el servidor filtra y ordena) con presentación y precio.
// REQ-003: cada producto se agrega al carrito con − / +.
export default function CatalogScreen() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { cart, setQuantity } = useCart();

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

  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <Pressable onPress={() => router.push('/cart')} accessibilityLabel="Ver carrito">
            <Text style={styles.cartLink}>Carrito ({cartUnits(cart)})</Text>
          </Pressable>
        ),
      }}
    />
  );

  if (!products && !error) return <ActivityIndicator style={styles.loading} />;

  return (
    <>
      {header}
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
          <View style={[styles.row, styles.product]}>
            <View style={styles.info}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.detail}>
                {item.presentation} · {formatCLP(item.unitPrice)}
              </Text>
            </View>
            <QuantityStepper quantity={quantityOf(cart, item.productId)} onChange={(q) => setQuantity(item, q)} />
          </View>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 32 },
  row: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  product: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  detail: { color: '#555', marginTop: 4 },
  error: { color: '#b00020' },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', fontSize: 16, color: '#555', padding: 24 },
  cartLink: { color: '#1f6feb', fontSize: 16, fontWeight: '600' },
});
