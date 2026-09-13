import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useLocalization, usePalette } from '../store/selectors';
import { useLedger } from '../store/useLedger';
import { SPACE } from '../theme/tokens';
import { Body, Button, Caption, Title } from './ui';

/** Re-lock after this long in the background. */
const GRACE_MS = 60_000;

/**
 * Biometric gate.
 *
 * Wraps the app and holds a cover over it until the device authenticates. The
 * cover renders instead of the children rather than on top of them, so a
 * locked app never puts balances in the OS task switcher.
 *
 * There is a deliberate grace period: switching to the banking app to check a
 * figure and coming straight back should not demand a fingerprint every time,
 * or people turn the lock off entirely.
 */
export function AppLock({ children }: { children: React.ReactNode }) {
  const enabled = useLedger((s) => s.settings.biometricLock);
  const hydrated = useLedger((s) => s.hydrated);
  const setBiometricLock = useLedger((s) => s.setBiometricLock);
  const { t } = useLocalization();
  const p = usePalette();

  const [unlocked, setUnlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const prompting = useRef(false);

  const authenticate = useCallback(async () => {
    // Two prompts at once (a rerender racing the AppState listener) makes the
    // OS cancel both, which reads to the user as the lock being broken.
    if (prompting.current) return;
    prompting.current = true;
    setFailed(false);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();

      // A device with no biometrics enrolled can never satisfy this gate, so
      // turn the setting off rather than locking the owner out of their own
      // ledger permanently.
      if (!hasHardware || !enrolled) {
        setBiometricLock(false);
        setUnlocked(true);
        return;
      }

      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: t('unlockPrompt'),
        cancelLabel: t('cancel'),
        // Allows the device passcode as a fallback, so a wet or unreadable
        // fingerprint is an inconvenience rather than a lockout.
        disableDeviceFallback: false,
      });

      if (res.success) {
        setUnlocked(true);
        backgroundedAt.current = null;
      } else {
        setFailed(true);
      }
    } finally {
      prompting.current = false;
    }
  }, [setBiometricLock, t]);

  // Prompt on first render once the setting is known.
  useEffect(() => {
    if (!hydrated || !enabled || unlocked) return;
    void authenticate();
  }, [hydrated, enabled, unlocked, authenticate]);

  // Re-lock after a long enough stint in the background.
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (state === 'active' && backgroundedAt.current != null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away > GRACE_MS) setUnlocked(false);
      }
    });
    return () => sub.remove();
  }, [enabled]);

  if (!enabled || unlocked) return <>{children}</>;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center', padding: SPACE.xl }}>
      <Title>{t('appName')}</Title>
      <Caption style={{ marginTop: SPACE.sm, textAlign: 'center' }}>{t('lockedHint')}</Caption>
      {failed && (
        <Body style={{ color: p.negative, marginTop: SPACE.md }}>{t('unlockFailed')}</Body>
      )}
      <View style={{ marginTop: SPACE.xl, alignSelf: 'stretch' }}>
        <Button label={t('unlock')} onPress={() => void authenticate()} />
      </View>
    </View>
  );
}
