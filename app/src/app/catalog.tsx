import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { QuantityStepper } from '@/components/QuantityStepper';
import { Screen } from '@/components/Screen';
import { SignOutButton } from '@/components/SignOutButton';
import { StateMessage } from '@/components/StateMessage';
import { formatCLP, listProducts, type Product } from '@/lib/api';
import { cartUnits, quantityOf } from '@/lib/cart';
import { useCart } from '@/lib/CartProvider';
import { colors, fontSize, fontWeight, spacing } from '@/theme';

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

  // La disposición de la barra se rehace en T-10 (REQ-006); aquí solo pasa al tema.
  const header = (
    <Stack.Screen
      options={{
        headerLeft: () => <SignOutButton />,
        headerRight: () => (
          <View style={styles.headerLinks}>
            <Button
              title="Mis pedidos"
              variant="link"
              onPress={() => router.push('/orders')}
              accessibilityLabel="Ver mis pedidos"
            />
            <Button
              title={`Carrito (${cartUnits(cart)})`}
              variant="link"
              onPress={() => router.push('/cart')}
              accessibilityLabel="Ver carrito"
            />
          </View>
        ),
      }}
    />
  );

  if (!products && !error) {
    return (
      <Screen>
        <StateMessage kind="loading" />
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
            <View style={styles.info}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.detail}>{item.presentation}</Text>
              <Text style={styles.price}>{formatCLP(item.unitPrice)}</Text>
            </View>
            <QuantityStepper quantity={quantityOf(cart, item.productId)} onChange={(q) => setQuantity(item, q)} />
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md },
  product: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1, gap: spacing.xs },
  name: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  detail: { fontSize: fontSize.sm, color: colors.textMuted },
  price: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  headerLinks: { flexDirection: 'row', alignItems: 'center' },
});
