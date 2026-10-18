import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/theme';

// Contenedor de pantalla con el fondo del tema (REQ-007).
export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
