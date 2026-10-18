import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { configureAmplify } from '@/lib/amplify';
import { CartProvider } from '@/lib/CartProvider';

configureAmplify();

export default function RootLayout() {
  return (
    <CartProvider>
      <StatusBar style="dark" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Iniciar sesión' }} />
        <Stack.Screen name="catalog" options={{ title: 'Catálogo', headerBackVisible: false }} />
        <Stack.Screen name="cart" options={{ title: 'Carrito' }} />
        <Stack.Screen name="orders" options={{ title: 'Mis pedidos' }} />
        <Stack.Screen name="order/[id]" options={{ title: 'Pedido' }} />
      </Stack>
    </CartProvider>
  );
}
