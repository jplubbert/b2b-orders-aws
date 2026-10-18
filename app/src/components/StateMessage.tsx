import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '@/theme';

// REQ-007 E5: loading, empty list and error are shown with this same component on every screen.
// Each screen sets the texts (S-21: those of REQ-001..005 are kept).
// While loading, `label` is only for screen readers (e.g. "Comprobando sesión").
export function StateMessage(
  props:
    | { kind: 'loading'; label?: string }
    | { kind: 'empty'; message: string }
    | { kind: 'error'; message: string },
) {
  if (props.kind === 'loading') {
    return (
      <View style={styles.container} testID="state-loading">
        <ActivityIndicator color={colors.primary} accessibilityLabel={props.label} />
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
