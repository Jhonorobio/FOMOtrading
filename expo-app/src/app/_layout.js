// Root layout — session-gated navigation (Expo Router protected routes pattern).
import { useEffect } from 'react';
import { Stack, SplashScreen } from 'expo-router';
import { SessionProvider, useSession } from '../lib/session';
import { C } from '../lib/theme';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { token, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading) SplashScreen.hide();
  }, [isLoading]);

  if (isLoading) return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Protected guard={!!token}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function Root() {
  return (
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
}
