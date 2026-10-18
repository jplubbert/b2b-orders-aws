import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AccountMenu } from '@/components/AccountMenu';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { StateMessage } from '@/components/StateMessage';
import { StatusBadge } from '@/components/StatusBadge';
import { allOrders, formatCLP, formatDate } from '@/lib/api';
import type { OrderStatus } from '@/lib/generated/graphql';
import { usePanel } from '@/lib/PanelProvider';
import { colors, fontSize, fontWeight, orderStatus, radius, spacing, touchTarget } from '@/theme';

// S-28: "Todos" + los 5 estados con su nombre legible (S-17), en el orden de S-04.
const FILTERS: { status: OrderStatus | null; label: string }[] = [
  { status: null, label: 'Todos' },
  ...(Object.keys(orderStatus) as OrderStatus[]).map((s) => ({ status: s, label: orderStatus[s].label })),
];

// REQ-010: pedidos de todos los almacenes del más reciente al más antiguo (el servidor ordena) con número,
// almacén (customerId, S-23), fecha, total y estado. El filtro pide `allOrders(status)` al servidor (E2).
// El estado vigente se pide de nuevo al volver a la pantalla y al deslizar hacia abajo (S-06).
// La lista vive en PanelProvider: el detalle (dist/order/[id]) la lee y la actualiza al cambiar el estado.
export default function PanelScreen() {
  const [filter, setFilter] = useState<OrderStatus | null>(null);
  const { orders, setOrders } = usePanel();
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Solo vale la respuesta del último pedido: al cambiar rápido de filtro no gana una respuesta vieja.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const loaded = await allOrders(filter);
      if (request !== latest.current) return;
      setOrders(loaded);
      setError(null);
    } catch (e) {
      if (request !== latest.current) return;
      setError(e instanceof Error ? e.message : JSON.stringify(e));
    }
  }, [filter, setOrders]);

  // Al entrar (nueva sesión) no se muestra la lista de una sesión anterior mientras llega la nueva.
  useEffect(() => {
    setOrders(null);
  }, [setOrders]);

  // Corre al ganar el foco y cada vez que cambia el filtro.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function onFilter(status: OrderStatus | null) {
    if (status === filter) return;
    // Sin la lista del filtro anterior mientras llega la nueva.
    setOrders(null);
    setError(null);
    setFilter(status);
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Título "Pedidos" desde _layout.tsx; a la derecha el menú de cuenta con "Cerrar sesión" (S-28, REQ-006).
  const header = <Stack.Screen options={{ headerRight: () => <AccountMenu /> }} />;

  const filters = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filters}>
      {FILTERS.map(({ status, label }) => {
        const selected = status === filter;
        return (
          <Pressable
            key={label}
            onPress={() => onFilter(status)}
            accessibilityRole="button"
            accessibilityLabel={`Filtro ${label}`}
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  if (!orders && !error) {
    return (
      <Screen>
        {header}
        {filters}
        <View style={styles.loading}>
          <StateMessage kind="loading" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      {filters}
      <FlatList
        testID="panel-list"
        data={orders ?? []}
        keyExtractor={(o) => o.id}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListHeaderComponent={error ? <StateMessage kind="error" message={error} /> : null}
        // REQ-010 E4 (sin filtro) y E3 (con filtro)
        ListEmptyComponent={
          orders ? (
            <StateMessage kind="empty" message={filter ? 'No hay pedidos en este estado' : 'Todavía no hay pedidos'} />
          ) : null
        }
        contentContainerStyle={[styles.list, orders?.length === 0 && styles.emptyContainer]}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/dist/order/[id]', params: { id: item.id } })}
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Card style={styles.order}>
              <View style={styles.line}>
                <Text style={styles.number}>N° {item.number}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.customer}>Almacén {item.customerId}</Text>
              <View style={styles.line}>
                <Text style={styles.detail}>{formatDate(item.createdAt)}</Text>
                <Text style={styles.total}>{formatCLP(item.total)}</Text>
              </View>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterBar: { flexGrow: 0 },
  filters: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm },
  chip: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  chipTextSelected: { color: colors.onPrimary },
  pressed: { opacity: 0.7 },
  loading: { flex: 1, justifyContent: 'center' },
  list: { padding: spacing.lg, gap: spacing.md },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  order: { gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  number: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  customer: { fontSize: fontSize.sm, color: colors.text },
  detail: { fontSize: fontSize.sm, color: colors.textMuted },
  total: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
});
