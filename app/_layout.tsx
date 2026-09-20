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
    // Direction is handled explicitly in every component (`row-reverse` and
    // `textAlign` driven by the active language), NOT delegated to
    // I18nManager. Calling forceRTL here as well would mirror the layout a
    // second time at the native level and flip it straight back to LTR.
    //
    // Doing it in JS also means switching language takes effect immediately —
    // forceRTL only applies after a full app restart, which would leave the
    // user staring at a half-flipped screen until they killed the app.
    if (I18nManager.isRTL) {
      I18nManager.allowRTL(false);
      I18nManager.forceRTL(false);
    }
  }, []);

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
            {/* Detail screens, pushed over the tabs rather than living in them:
                they are destinations you visit and leave, not places you dwell. */}
            <Stack.Screen name="insights" />
            <Stack.Screen name="goal-plan" />
            <Stack.Screen name="start-today" />
            <Stack.Screen name="salary" />
            <Stack.Screen name="card" />
            <Stack.Screen name="transfers" />
            <Stack.Screen name="receivables" />
          </Stack.Protected>
        </Stack>
      </AppLock>
    </SafeAreaProvider>
  );
}
