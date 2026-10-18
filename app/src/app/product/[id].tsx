import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { CartBar } from '@/components/CartBar';
import { QuantityStepper } from '@/components/QuantityStepper';
import { Screen } from '@/components/Screen';
import { StateMessage } from '@/components/StateMessage';
import { formatCLP } from '@/lib/api';
import { quantityOf } from '@/lib/cart';
import { useCart } from '@/lib/CartProvider';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme';

// REQ-008: detalle de un producto del catálogo ya cargado (S-19, sin consulta nueva), con la cantidad
// que tiene en el mismo carrito del catálogo (REQ-003) y su subtotal. Sin imagen (S-18): recuadro con la inicial.
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { cart, setQuantity, catalog } = useCart();
  const product = catalog?.find((p) => p.productId === id);

  // E5: id fuera del catálogo cargado → no se puede agregar.
  if (!product) {
    return (
      <Screen style={styles.missing}>
        <StateMessage kind="empty" message="Este producto ya no está disponible" />
        <Button
          title="Volver al catálogo"
          variant="secondary"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/catalog'))}
        />
      </Screen>
    );
  }

  const quantity = quantityOf(cart, product.productId);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.summary}>
          <View style={styles.initialBox} testID="product-initial">
            <Text style={styles.initial}>{product.name.trim().charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.detail}>{product.presentation}</Text>
          <Text style={styles.price}>{formatCLP(product.unitPrice)}</Text>
        </Card>
        <Card style={styles.cartCard}>
          <View style={styles.row}>
            <Text style={styles.label}>En el carrito</Text>
            <QuantityStepper quantity={quantity} onChange={(q) => setQuantity(product, q)} />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Subtotal</Text>
            <Text style={styles.subtotal} testID="product-subtotal">
              {formatCLP(product.unitPrice * quantity)}
            </Text>
          </View>
        </Card>
      </ScrollView>
      <CartBar />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  summary: { alignItems: 'center', gap: spacing.xs },
  initialBox: {
    width: spacing.xxl * 3,
    height: spacing.xxl * 3,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  initial: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  name: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  detail: { fontSize: fontSize.sm, color: colors.textMuted },
  price: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text },
  cartCard: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  label: { fontSize: fontSize.md, color: colors.textMuted },
  subtotal: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  missing: { justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
});
