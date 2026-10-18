import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors, disabledOpacity, fontSize, fontWeight, radius, spacing, touchTarget } from '@/theme';

type Variant = 'primary' | 'secondary' | 'link';

// Botón del tema; alto mínimo de 44 dp (REQ-007 E4).
// primary: relleno azul; secondary: borde azul; link: solo texto (enlaces de la barra).
// loading: indicador en lugar del texto y botón deshabilitado (p. ej. mientras se envía).
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityLabel,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  const textStyle = variant === 'primary' ? styles.onPrimary : styles.onLight;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && variant === 'primary' && styles.primaryPressed,
        pressed && variant !== 'primary' && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textStyle.color} />
      ) : (
        <Text style={[styles.text, textStyle]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  primary: { backgroundColor: colors.primary },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  secondary: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  link: { paddingHorizontal: spacing.sm },
  pressed: { opacity: 0.7 },
  disabled: { opacity: disabledOpacity },
  text: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  onPrimary: { color: colors.onPrimary },
  onLight: { color: colors.primary },
});
