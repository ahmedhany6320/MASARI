import { useEffect, useState } from 'react';
import { Alert, Linking, Switch, View } from 'react-native';
import {
  canNotify,
  getPermissionState,
  requestPermission,
  rescheduleAll,
  sendTestNotification,
  type PermissionState,
} from '../lib/notifications';
import { useLocalization, usePalette } from '../store/selectors';
import { useLedger } from '../store/useLedger';
import { SPACE } from '../theme/tokens';
import { Body, Button, Caption, Card, Title } from './ui';

const HOURS = [6, 7, 8, 9, 10, 11, 12] as const;
const EVENING_HOURS = [18, 19, 20, 21, 22, 23] as const;

/**
 * Notification settings.
 *
 * The permission state drives what is shown: there is no point offering
 * toggles for notifications the OS will refuse to deliver, and a denied
 * permission can only be undone in system settings, so that case gets a link
 * rather than a button that would silently do nothing.
 */
export function NotificationSettings() {
  const p = usePalette();
  const { t, lang, rtl } = useLocalization();

  const ledger = useLedger((s) => s.ledger);
  const fxRate = useLedger((s) => s.settings.fxRate);
  const reminders = useLedger((s) => s.settings.reminders);
  const setReminders = useLedger((s) => s.setReminders);

  const [perm, setPerm] = useState<PermissionState>('undetermined');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPermissionState().then(setPerm);
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const next = await requestPermission();
      setPerm(next);
      if (next === 'granted') {
        await rescheduleAll(ledger, fxRate, lang, reminders, new Date());
        await sendTestNotification(ledger, fxRate, lang);
      }
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await sendTestNotification(ledger, fxRate, lang);
    } catch {
      Alert.alert(t('appName'), t('notifFailed'));
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, hint: string, value: boolean, onChange: (v: boolean) => void) => (
    <View style={{ paddingVertical: SPACE.md }}>
      <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.md }}>
        <Body style={{ flexShrink: 1 }}>{label}</Body>
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={perm !== 'granted'}
          trackColor={{ true: p.accent, false: p.faint }}
          accessibilityLabel={label}
        />
      </View>
      <Caption>{hint}</Caption>
    </View>
  );

  const hourPicker = (
    label: string,
    hours: readonly number[],
    current: number,
    onPick: (h: number) => void,
  ) => (
    <View style={{ paddingVertical: SPACE.sm }}>
      <Caption>{label}</Caption>
      <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.sm }}>
        {hours.map((h) => {
          const on = h === current;
          return (
            <Button
              key={h}
              label={`${String(h).padStart(2, '0')}:00`}
              variant={on ? 'primary' : 'secondary'}
              onPress={() => onPick(h)}
            />
          );
        })}
      </View>
    </View>
  );

  return (
    <Card>
      <Title>{t('notifT')}</Title>

      {!canNotify() ? (
        // Expo Go on Android strips the notification module. Say so plainly
        // rather than showing a toggle that cannot work — the app itself is
        // fine, the container it is running in is the limitation.
        <Caption>{t('notifNeedsBuild')}</Caption>
      ) : perm === 'granted' ? (
        <Caption>{t('notifGrantedNative')}</Caption>
      ) : perm === 'denied' ? (
        <>
          <Caption>{t('notifDeniedNative')}</Caption>
          <View style={{ marginTop: SPACE.md }}>
            <Button
              label={t('openSettings')}
              variant="secondary"
              onPress={() => void Linking.openSettings()}
            />
          </View>
        </>
      ) : (
        <>
          <Caption>{t('notifIntroNative')}</Caption>
          <View style={{ marginTop: SPACE.md }}>
            <Button label={t('notifEnable')} onPress={() => void enable()} disabled={busy} />
          </View>
        </>
      )}

      {canNotify() && perm === 'granted' && (
        <View style={{ marginTop: SPACE.md }}>
          {row(t('notifMorning'), t('notifMorningHint'), reminders.morning, (v) =>
            setReminders({ morning: v }),
          )}
          {reminders.morning &&
            hourPicker(t('notifTime'), HOURS, reminders.morningHour, (h) =>
              setReminders({ morningHour: h }),
            )}

          {row(t('notifEvening'), t('notifEveningHint'), reminders.evening, (v) =>
            setReminders({ evening: v }),
          )}
          {reminders.evening &&
            hourPicker(t('notifTime'), EVENING_HOURS, reminders.eveningHour, (h) =>
              setReminders({ eveningHour: h }),
            )}

          {row(t('notifCommit'), t('notifCommitHint'), reminders.commitments, (v) =>
            setReminders({ commitments: v }),
          )}

          <View style={{ marginTop: SPACE.md }}>
            <Button label={t('notifTest')} variant="secondary" onPress={() => void test()} disabled={busy} />
          </View>
        </View>
      )}
    </Card>
  );
}
