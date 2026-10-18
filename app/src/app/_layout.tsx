import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { configureAmplify } from '@/lib/amplify';
import { CartProvider } from '@/lib/CartProvider';
import { PanelProvider } from '@/lib/PanelProvider';
import { colors, fontSize, fontWeight } from '@/theme';

configureAmplify();

// Barra de la pila con el tema (REQ-006, REQ-007): superficie blanca, título a la izquierda, enlaces en azul.
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
    <CartProvider>
      <PanelProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={screenOptions}>
          <Stack.Screen name="index" options={{ title: 'Iniciar sesión' }} />
          <Stack.Screen name="catalog" options={{ title: 'Catálogo', headerBackVisible: false }} />
          <Stack.Screen name="product/[id]" options={{ title: 'Producto' }} />
          <Stack.Screen name="cart"options={{ title: 'Carrito' }} />
          <Stack.Screen name="orders" options={{ title: 'Mis pedidos' }} />
          <Stack.Screen name="order/[id]" options={{ title: 'Pedido' }} />
          {/* REQ-009/REQ-010: inicio del distribuidor (S-28). */}
          <Stack.Screen name="dist/index" options={{ title: 'Pedidos', headerBackVisible: false }} />
          {/* REQ-010 E5/REQ-011: el detalle pone "Pedido <número>" al encontrar el pedido. */}
          <Stack.Screen name="dist/order/[id]" options={{ title: 'Pedido' }} />
        </Stack>
      </PanelProvider>
    </CartProvider>
  );
}
