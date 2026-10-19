import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDate, orderHistory } from '@/lib/api';
import { useHistory, type OrderHistoryEntry } from '@/lib/store/history';
import { colors, fontSize, fontWeight, orderStatus, spacing } from '@/theme';
import { Card } from './Card';
import { StateMessage } from './StateMessage';

/** History of order `id` and `reload`, which requests it again (on opening the detail and on pulling down, S-37). */
export function useOrderHistory(id: string) {
  const entry = useHistory((s) => s.byOrder[id]);
  const reload = useCallback(async () => {
    const { loaded, failed } = useHistory.getState();
    try {
      loaded(id, await orderHistory(id));
    } catch {
      failed(id);
    }
  }, [id]);
  return { entry, reload };
}

// REQ-012 E8–E12, S-37: "Historial" section of the order detail (store and distributor), oldest event first
// as the server sends them. The first event reads "Recibido"; a change, "<previous> → <new>" with the names of
// S-17; each one with its es-CL date and time. `entry` undefined: not loaded yet.
export function OrderHistory({ entry }: { entry: OrderHistoryEntry | undefined }) {
  const events = entry?.events;
  return (
    <Card>
      <View testID="order-history" style={styles.section}>
        <Text style={styles.heading}>Historial</Text>
        {entry?.error && <StateMessage kind="error" message="No se pudo cargar el historial" testID="history-error" />}
        {!events && !entry?.error && <StateMessage kind="loading" testID="history-loading" />}
        {events?.length === 0 && !entry?.error && (
          <StateMessage kind="empty" message="Sin movimientos registrados todavía" testID="history-empty" />
        )}
        {events?.map((e) => (
          <View key={e.eventId} testID="history-row" style={styles.row}>
            <Text style={styles.change}>
              {e.from ? `${orderStatus[e.from].label} → ${orderStatus[e.to].label}` : orderStatus[e.to].label}
            </Text>
            <Text style={styles.date}>{formatDate(e.at)}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  heading: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  change: { flexShrink: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  date: { fontSize: fontSize.sm, color: colors.textMuted },
});
