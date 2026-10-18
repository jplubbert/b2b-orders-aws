import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { AccountMenu } from '@/components/AccountMenu';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { CartBar } from '@/components/CartBar';
import { QuantityStepper } from '@/components/QuantityStepper';
import { Screen } from '@/components/Screen';
import { StateMessage } from '@/components/StateMessage';
import { formatCLP, listProducts, type Product } from '@/lib/api';
import { quantityOf } from '@/lib/cart';
import { useCart } from '@/lib/store/cart';
import { colors, fontSize, fontWeight, spacing, touchTarget } from '@/theme';

// REQ-002: active products sorted by name (the server filters and sorts) with presentation and price.
// REQ-003: each product is added to the cart with − / +.
export default function CatalogScreen() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { cart, setQuantity, setCatalog } = useCart();

  // S-19: the loaded catalog stays in the cart store for the product detail (REQ-008).
  const load = useCallback(async () => {
    try {
      const loaded = await listProducts();
      setProducts(loaded);
      setCatalog(loaded);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : JSON.stringify(e));
    }
  }, [setCatalog]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pulling down requests the catalog again (e.g. after activating or deactivating products).
  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // REQ-006: the "Catálogo" title (on the left, from _layout.tsx); on the right "Mis pedidos" and the
  // account button, which holds "Cerrar sesión" (S-15). The cart moves to the bottom bar.
  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <View style={styles.headerRight}>
            <Button
              title="Mis pedidos"
              variant="link"
              onPress={() => router.push('/orders')}
              accessibilityLabel="Ver mis pedidos"
            />
            <AccountMenu />
          </View>
        ),
      }}
    />
  );

  if (!products && !error) {
    return (
      <Screen>
        {header}
        <View style={styles.loading}>
          <StateMessage kind="loading" />
        </View>
        <CartBar />
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      <FlatList
        testID="catalog-list"
        data={products ?? []}
        keyExtractor={(p) => p.productId}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListHeaderComponent={error ? <StateMessage kind="error" message={error} /> : null}
        // REQ-002 E3
        ListEmptyComponent={products ? <StateMessage kind="empty" message="No hay productos disponibles" /> : null}
        contentContainerStyle={[styles.list, products?.length === 0 && styles.emptyContainer]}
        renderItem={({ item }) => (
          <Card style={styles.product}>
            {/* REQ-008: tapping the row (outside − / +) opens the product detail. */}
            <Pressable
              style={({ pressed }) => [styles.info, pressed && styles.pressed]}
              onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.productId } })}
              accessibilityRole="button"
              accessibilityLabel={`Ver detalle de ${item.name}`}
            >
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.detail}>{item.presentation}</Text>
              <Text style={styles.price}>{formatCLP(item.unitPrice)}</Text>
            </Pressable>
            <QuantityStepper quantity={quantityOf(cart, item.productId)} onChange={(q) => setQuantity(item, q)} />
          </Card>
        )}
      />
      <CartBar />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md },
  product: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1, gap: spacing.xs, minHeight: touchTarget, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  name: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  detail: { fontSize: fontSize.sm, color: colors.textMuted },
  price: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  loading: { flex: 1, justifyContent: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
