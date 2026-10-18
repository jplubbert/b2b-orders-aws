import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '@/theme';

// REQ-007 E5: carga, lista vacía y error se muestran con este mismo componente en todas las pantallas.
// Los textos los pone cada pantalla (S-21: se conservan los de REQ-001..005).
export function StateMessage(
  props: { kind: 'loading' } | { kind: 'empty'; message: string } | { kind: 'error'; message: string },
) {
  if (props.kind === 'loading') {
    return (
      <View style={styles.container} testID="state-loading">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <View style={[styles.container, props.kind === 'error' && styles.errorBox]} testID={`state-${props.kind}`}>
      <Text style={props.kind === 'error' ? styles.error : styles.empty}>{props.message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  errorBox: {
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSurface,
  },
  empty: { textAlign: 'center', fontSize: fontSize.md, color: colors.textMuted },
  error: { textAlign: 'center', fontSize: fontSize.sm, color: colors.danger },
});
