import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  commitmentReminder,
  dueCommitments,
  morningBrief,
  overspendAlert,
  safeSpend,
  type Lang,
  type Ledger,
  type NotificationContent,
} from '../domain';

/**
 * Notification delivery.
 *
 * These are LOCAL scheduled notifications, not push. That matters: local
 * notifications are scheduled by the OS and fire with the phone fully closed
 * and no server involved — which is the exact capability the PWA could not
 * provide, and the reason this app is native at all. It also means they work
 * in Expo Go, where Android push does not.
 */

// Show notifications even while the app is foregrounded — the spending alerts
// are worth surfacing mid-session, not just on the lock screen.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Identifiers so a reschedule replaces rather than duplicates. */
const CHANNEL_ID = 'masari-daily';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function getPermissionState(): Promise<PermissionState> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Asks for permission, creating the Android channel first.
 *
 * On Android the channel must exist before anything is posted, otherwise
 * notifications are delivered silently with no heads-up display.
 */
export async function requestPermission(): Promise<PermissionState> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'مصاري',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      vibrationPattern: [0, 250],
      lightColor: '#ec3013',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return 'granted';
  // Asking again after an explicit denial does nothing on either platform —
  // the user has to change it in system settings.
  if (!existing.canAskAgain) return 'denied';

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

async function scheduleDaily(
  content: NotificationContent,
  hour: number,
  minute: number,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
  });
}

export interface ReminderSettings {
  morning: boolean;
  morningHour: number;
  evening: boolean;
  eveningHour: number;
  commitments: boolean;
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  morning: true,
  morningHour: 9,
  evening: true,
  eveningHour: 21,
  commitments: true,
};

/**
 * Rebuilds the whole schedule from the current ledger.
 *
 * Everything is cancelled and re-created rather than diffed. The messages
 * embed live figures (today's limit, what is due), so a stale schedule would
 * quietly deliver yesterday's numbers — and with at most three notifications
 * to place, rebuilding is cheaper than reconciling.
 *
 * Call this whenever the ledger or the reminder settings change.
 */
export async function rescheduleAll(
  ledger: Ledger,
  fxRate: number,
  lang: Lang,
  reminders: ReminderSettings,
  now: Date = new Date(),
): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();

  if ((await getPermissionState()) !== 'granted') return;

  const c = safeSpend(ledger, fxRate, now);

  if (reminders.morning) {
    await scheduleDaily(morningBrief(c, lang), reminders.morningHour, 0);
  }

  if (reminders.evening) {
    // Only schedule the evening alert when today has actually gone over.
    // Tomorrow's reschedule re-evaluates against tomorrow's spending.
    const alert = overspendAlert(c, lang);
    if (alert) await scheduleDaily(alert, reminders.eveningHour, 0);
  }

  if (reminders.commitments) {
    const due = dueCommitments(ledger, now);
    const msg = commitmentReminder(due, lang);
    if (msg) await scheduleDaily(msg, reminders.morningHour, 30);
  }
}

/** Fires a notification right now — used to confirm permissions actually work. */
export async function sendTestNotification(
  ledger: Ledger,
  fxRate: number,
  lang: Lang,
  now: Date = new Date(),
): Promise<void> {
  const content = morningBrief(safeSpend(ledger, fxRate, now), lang);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: null, // immediate
  });
}

export async function cancelAll(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
