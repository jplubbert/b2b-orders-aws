import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { configureAmplify } from '@/lib/amplify';
import { colors, fontSize, fontWeight } from '@/theme';

configureAmplify();

// Stack header with the theme (REQ-006, REQ-007): white surface, title on the left, links in blue.
const screenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.primary,
  headerTitleStyle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  headerTitleAlign: 'left',
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.background },
} as const;

export default function RootLayout() {
  return (
    // The cart, session and panel state live in Zustand stores (DEC-021), without providers.
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index" options={{ title: 'Iniciar sesión' }} />
        <Stack.Screen name="catalog" options={{ title: 'Catálogo', headerBackVisible: false }} />
        <Stack.Screen name="product/[id]" options={{ title: 'Producto' }} />
        <Stack.Screen name="cart"options={{ title: 'Carrito' }} />
        <Stack.Screen name="orders" options={{ title: 'Mis pedidos' }} />
        <Stack.Screen name="order/[id]" options={{ title: 'Pedido' }} />
        {/* REQ-009/REQ-010: the distributor's home (S-28). */}
        <Stack.Screen name="dist/index" options={{ title: 'Pedidos', headerBackVisible: false }} />
        {/* REQ-010 E5/REQ-011: the detail sets "Pedido <number>" once it finds the order. */}
        <Stack.Screen name="dist/order/[id]" options={{ title: 'Pedido' }} />
      </Stack>
    </>
  );
}
