import { Platform } from 'react-native';
import {
  commitmentReminder,
  dueTodayReminder,
  logSpendingNudge,
  dueCommitments,
  morningBrief,
  overspendAlert,
  safeSpend,
  type Lang,
  type Ledger,
  type NotificationContent,
} from '../domain';
import { notificationsSupported } from './environment';

/**
 * Notification delivery.
 *
 * These are LOCAL scheduled notifications, not push. That matters: local
 * notifications are scheduled by the OS and fire with the phone fully closed
 * and no server involved — which is the exact capability the PWA could not
 * provide, and the reason this app is native at all.
 *
 * `expo-notifications` is loaded lazily rather than imported at the top of the
 * file. From SDK 53 the module THROWS on construction inside Expo Go on
 * Android, so a static import would take down the whole app at startup — even
 * for users who never turn notifications on. Requiring it behind
 * `notificationsSupported` keeps Expo Go usable for developing every other
 * screen, and a development build lifts the restriction with no code change.
 */

const CHANNEL_ID = 'masari-daily';

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/* eslint-disable @typescript-eslint/no-require-imports */
type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null = null;
let handlerSet = false;

/** Returns the native module, or null where it cannot be loaded safely. */
function load(): NotificationsModule | null {
  if (!notificationsSupported) return null;
  if (cached) return cached;
  try {
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
  if (!handlerSet) {
    // Show notifications even while the app is foregrounded — spending alerts
    // are worth surfacing mid-session, not only on the lock screen.
    cached.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    handlerSet = true;
  }
  return cached;
}

/** Whether this build can deliver notifications at all. */
export function canNotify(): boolean {
  return notificationsSupported;
}

export async function getPermissionState(): Promise<PermissionState> {
  const N = load();
  if (!N) return 'unsupported';
  const { status } = await N.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Asks for permission, creating the Android channel first.
 *
 * On Android the channel must exist before anything is posted, or the
 * notification is delivered silently with no heads-up display.
 */
export async function requestPermission(): Promise<PermissionState> {
  const N = load();
  if (!N) return 'unsupported';

  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'مصاري',
      importance: N.AndroidImportance.DEFAULT,
      lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE,
      vibrationPattern: [0, 250],
      lightColor: '#ec3013',
    });
  }

  const existing = await N.getPermissionsAsync();
  if (existing.status === 'granted') return 'granted';
  // Asking again after an explicit denial does nothing on either platform —
  // the user has to change it in system settings.
  if (!existing.canAskAgain) return 'denied';

  const { status } = await N.requestPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

async function scheduleDaily(
  N: NotificationsModule,
  content: NotificationContent,
  hour: number,
  minute: number,
): Promise<void> {
  await N.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: {
      type: N.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
  });
}

export interface ReminderSettings {
  logSpending?: boolean;
  logEveryHours?: number;
  logFromHour?: number;
  logToHour?: number;
  morning: boolean;
  morningHour: number;
  evening: boolean;
  eveningHour: number;
  commitments: boolean;
}

/**
 * Rebuilds the whole schedule from the current ledger.
 *
 * Everything is cancelled and re-created rather than diffed. The messages
 * embed live figures (today's limit, what is due), so a stale schedule would
 * quietly deliver yesterday's numbers — and with at most three notifications
 * to place, rebuilding is cheaper than reconciling.
 */
export async function rescheduleAll(
  ledger: Ledger,
  fxRate: number,
  lang: Lang,
  reminders: ReminderSettings,
  now: Date = new Date(),
): Promise<void> {
  const N = load();
  if (!N) return;

  await N.cancelAllScheduledNotificationsAsync();
  if ((await getPermissionState()) !== 'granted') return;

  const c = safeSpend(ledger, fxRate, now);

  if (reminders.morning) {
    await scheduleDaily(N, morningBrief(c, lang), reminders.morningHour, 0);
  }

  if (reminders.evening) {
    // Only schedule the evening alert when today actually went over.
    // Tomorrow's reschedule re-evaluates against tomorrow's spending.
    const alert = overspendAlert(c, lang);
    if (alert) await scheduleDaily(N, alert, reminders.eveningHour, 0);
  }

  if (reminders.commitments) {
    const msg = commitmentReminder(dueCommitments(ledger, now), lang);
    if (msg) await scheduleDaily(N, msg, reminders.morningHour, 30);

    // A commitment falling due TODAY gets its own prompt naming it, because
    // the actual amount has to be recorded at the moment it is paid — a
    // general "something is coming up" does not produce that.
    const today = dueTodayReminder(ledger.commits, lang, now);
    if (today) await scheduleDaily(N, today, Math.max(8, reminders.morningHour - 1), 0);
  }

  /*
   * The recording prompts. Every figure in the app is only as good as what was
   * entered, and unrecorded spending is by far the largest source of error, so
   * these are frequent by design — and each carries the remaining allowance so
   * it is worth reading rather than merely worth dismissing.
   */
  if (reminders.logSpending) {
    const step = Math.max(1, Math.round(reminders.logEveryHours ?? 2));
    const from = Math.max(0, Math.min(23, reminders.logFromHour ?? 9));
    const to = Math.max(from, Math.min(23, reminders.logToHour ?? 23));
    const nudge = logSpendingNudge(c, lang);

    for (let hour = from; hour <= to; hour += step) {
      await scheduleDaily(N, nudge, hour, 0);
    }
  }
}

/** Fires a notification right now — used to confirm permissions actually work. */
export async function sendTestNotification(
  ledger: Ledger,
  fxRate: number,
  lang: Lang,
  now: Date = new Date(),
): Promise<void> {
  const N = load();
  if (!N) return;
  const content = morningBrief(safeSpend(ledger, fxRate, now), lang);
  await N.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: null, // immediate
  });
}

export async function cancelAll(): Promise<void> {
  const N = load();
  if (!N) return;
  await N.cancelAllScheduledNotificationsAsync();
}
