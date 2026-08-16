import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { getPermissionState, rescheduleAll } from '../lib/notifications';
import { useLedger } from '../store/useLedger';

/**
 * Keeps the scheduled notifications in step with the ledger.
 *
 * The messages embed live figures — today's limit, what is due — so they go
 * stale the moment anything changes. This reschedules on every ledger or
 * settings change, and again whenever the app returns to the foreground, which
 * covers the case of the app sitting closed across midnight while the day (and
 * therefore the limit) rolls over.
 *
 * Rescheduling is debounced because recording a purchase fires several store
 * updates in quick succession and each one would otherwise rebuild the queue.
 */
export function useNotificationSync(): void {
  const ledger = useLedger((s) => s.ledger);
  const fxRate = useLedger((s) => s.settings.fxRate);
  const lang = useLedger((s) => s.settings.lang);
  const reminders = useLedger((s) => s.settings.reminders);
  const hydrated = useLedger((s) => s.hydrated);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Scheduling before hydration would build the queue from an empty ledger.
    if (!hydrated) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void (async () => {
        if ((await getPermissionState()) !== 'granted') return;
        await rescheduleAll(ledger, fxRate, lang, reminders, new Date());
      })();
    }, 800);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hydrated, ledger, fxRate, lang, reminders]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !hydrated) return;
      void (async () => {
        if ((await getPermissionState()) !== 'granted') return;
        await rescheduleAll(ledger, fxRate, lang, reminders, new Date());
      })();
    });
    return () => sub.remove();
  }, [hydrated, ledger, fxRate, lang, reminders]);
}
