import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { QuantityStepper } from '@/components/QuantityStepper';
import { Screen } from '@/components/Screen';
import { StateMessage } from '@/components/StateMessage';
import { StatusBadge } from '@/components/StatusBadge';
import { ApiError, createOrder, formatCLP, type CreatedOrder } from '@/lib/api';
import { cartTotal, lineSubtotal, rejectionMessage, toOrderLines } from '@/lib/cart';
import { useCart } from '@/lib/CartProvider';
import { colors, fontSize, fontWeight, spacing } from '@/theme';

// REQ-003: subtotal por línea y total; Confirmar crea el pedido (precios del servidor), vacía el carrito
// y muestra el número. Con el carrito vacío, Confirmar está deshabilitado (E5).
export default function CartScreen() {
  const { cart, setQuantity, clear } = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<CreatedOrder | null>(null);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      const order = await createOrder(toOrderLines(cart));
      clear();
      setConfirmed(order);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? rejectionMessage(cart, e.errorType, e.message)
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  if (confirmed) {
    return (
      <Screen style={styles.doneScreen}>
        <Card style={styles.done}>
          <Text style={styles.doneTitle}>Pedido confirmado</Text>
          <Text style={styles.doneNumber}>N° {confirmed.number}</Text>
          <StatusBadge status={confirmed.status} style={styles.doneBadge} />
          <Text style={styles.doneTotal}>Total {formatCLP(confirmed.total)}</Text>
        </Card>
        <Button title="Volver al catálogo" onPress={() => router.back()} />
      </Screen>
    );
  }

  const empty = cart.length === 0;
  return (
    <Screen>
      <FlatList
        data={cart}
        keyExtractor={(l) => l.product.productId}
        ListEmptyComponent={<StateMessage kind="empty" message="El carrito está vacío" />}
        contentContainerStyle={[styles.list, empty && styles.emptyContainer]}
        renderItem={({ item }) => (
          <Card style={styles.line}>
            <View style={styles.info}>
              <Text style={styles.name}>{item.product.name}</Text>
              <Text style={styles.detail}>
                {item.product.presentation} · {formatCLP(item.product.unitPrice)} c/u
              </Text>
              <Text style={styles.subtotal}>Subtotal {formatCLP(lineSubtotal(item))}</Text>
            </View>
            <QuantityStepper quantity={item.quantity} onChange={(q) => setQuantity(item.product, q)} />
          </Card>
        )}
      />
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {error && <StateMessage kind="error" message={error} />}
        <Text style={styles.total}>Total {formatCLP(cartTotal(cart))}</Text>
        <Button title="Confirmar pedido" loading={busy} disabled={empty} onPress={onConfirm} />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1, gap: spacing.xs },
  name: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  detail: { fontSize: fontSize.sm, color: colors.textMuted },
  subtotal: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  footer: {
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  total: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'right' },
  doneScreen: { justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  done: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  doneTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  doneBadge: { alignSelf: 'center' },
  doneNumber: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  doneTotal: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
});
