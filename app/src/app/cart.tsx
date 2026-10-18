import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { QuantityStepper } from '@/components/QuantityStepper';
import { ApiError, createOrder, formatCLP, type CreatedOrder } from '@/lib/api';
import { cartTotal, lineSubtotal, rejectionMessage, toOrderLines } from '@/lib/cart';
import { useCart } from '@/lib/CartProvider';

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
      <View style={styles.done}>
        <Text style={styles.doneTitle}>Pedido confirmado</Text>
        <Text style={styles.doneNumber}>N° {confirmed.number}</Text>
        <Text style={styles.detail}>
          Total {formatCLP(confirmed.total)} · {confirmed.status}
        </Text>
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Volver al catálogo</Text>
        </Pressable>
      </View>
    );
  }

  const empty = cart.length === 0;
  return (
    <View style={styles.container}>
      <FlatList
        data={cart}
        keyExtractor={(l) => l.product.productId}
        ListEmptyComponent={<Text style={styles.empty}>El carrito está vacío</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.info}>
              <Text style={styles.name}>{item.product.name}</Text>
              <Text style={styles.detail}>
                {item.product.presentation} · {formatCLP(item.product.unitPrice)} c/u
              </Text>
              <Text style={styles.subtotal}>Subtotal {formatCLP(lineSubtotal(item))}</Text>
            </View>
            <QuantityStepper quantity={item.quantity} onChange={(q) => setQuantity(item.product, q)} />
          </View>
        )}
      />
      <View style={styles.footer}>
        {error && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.total}>Total {formatCLP(cartTotal(cart))}</Text>
        <Pressable
          style={[styles.button, (empty || busy) && styles.disabled]}
          disabled={empty || busy}
          onPress={onConfirm}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Confirmar pedido</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
  },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  detail: { color: '#555', marginTop: 4 },
  subtotal: { marginTop: 4, fontWeight: '600' },
  empty: { textAlign: 'center', fontSize: 16, color: '#555', padding: 24 },
  footer: { padding: 16, gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  total: { fontSize: 18, fontWeight: '700', textAlign: 'right' },
  error: { color: '#b00020' },
  button: { backgroundColor: '#1f6feb', borderRadius: 8, padding: 14, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  done: { flex: 1, padding: 24, gap: 12, justifyContent: 'center', backgroundColor: '#fff' },
  doneTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  doneNumber: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
});
