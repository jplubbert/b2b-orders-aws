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
import { usePanel } from '@/lib/store/panel';
import { colors, fontSize, fontWeight, orderStatus, radius, spacing, touchTarget } from '@/theme';

// S-28: "Todos" + the 5 statuses with their readable name (S-17), in S-04 order.
const FILTERS: { status: OrderStatus | null; label: string }[] = [
  { status: null, label: 'Todos' },
  ...(Object.keys(orderStatus) as OrderStatus[]).map((s) => ({ status: s, label: orderStatus[s].label })),
];

// REQ-010: orders of every store, newest first (the server sorts), with number, store (customerId, S-23),
// date, total and status. The filter asks the server for `allOrders(status)` (E2).
// The current status is requested again when returning to the screen and when pulling down (S-06).
// The list lives in the panel store (DEC-021): the detail (dist/order/[id]) reads it and updates it when the status changes.
export default function PanelScreen() {
  const [filter, setFilter] = useState<OrderStatus | null>(null);
  const { orders, setOrders } = usePanel();
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Only the response to the latest request counts: when switching filters fast, an old response doesn't win.
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

  // On entering (new session) the list of a previous session isn't shown while the new one arrives.
  useEffect(() => {
    setOrders(null);
  }, [setOrders]);

  // Runs on gaining focus and every time the filter changes.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function onFilter(status: OrderStatus | null) {
    if (status === filter) return;
    // Without the previous filter's list while the new one arrives.
    setOrders(null);
    setError(null);
    setFilter(status);
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // "Pedidos" title from _layout.tsx; on the right the account menu with "Cerrar sesión" (S-28, REQ-006).
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
        // REQ-010 E4 (no filter) and E3 (with filter)
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
