import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { configureAmplify } from '@/lib/amplify';

configureAmplify();

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Iniciar sesión' }} />
        <Stack.Screen name="catalog" options={{ title: 'Catálogo', headerBackVisible: false }} />
      </Stack>
    </>
  );
}
