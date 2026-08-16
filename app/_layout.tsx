import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, I18nManager, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppLock } from '../src/components/AppLock';
import { useNotificationSync } from '../src/hooks/useNotificationSync';
import { useLocalization, usePalette } from '../src/store/selectors';
import { useLedger } from '../src/store/useLedger';

/**
 * Root layout.
 *
 * Holds a blank screen until the persisted ledger has been read back from
 * disk. Rendering before hydration would flash an empty ledger — showing
 * someone a safe-spend limit of zero for a frame is worse than showing nothing.
 */
export default function RootLayout() {
  const hydrated = useLedger((s) => s.hydrated);
  const onboarded = useLedger((s) => s.settings.onboarded);
  const { rtl } = useLocalization();
  const p = usePalette();
  const theme = useLedger((s) => s.settings.theme);

  // Keeps the scheduled notifications matching the current ledger. Safe to
  // call before hydration — the hook waits for it.
  useNotificationSync();

  useEffect(() => {
    // Arabic needs the whole layout mirrored, not just text right-aligned.
    // Note that on a real device a change here only takes full effect after a
    // reload — React Native resolves layout direction natively at startup.
    if (I18nManager.isRTL !== rtl) {
      I18nManager.allowRTL(rtl);
      I18nManager.forceRTL(rtl);
    }
  }, [rtl]);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bg }}>
        <ActivityIndicator color={p.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <AppLock>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }}>
          <Stack.Protected guard={!onboarded}>
            <Stack.Screen name="onboarding" />
          </Stack.Protected>
          <Stack.Protected guard={onboarded}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
        </Stack>
      </AppLock>
    </SafeAreaProvider>
  );
}
