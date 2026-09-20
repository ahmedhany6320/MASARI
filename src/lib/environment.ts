import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Which container the app is running inside.
 *
 * This matters because Expo Go is not a neutral sandbox — it is somebody
 * else's signed app, and from SDK 53 it deliberately strips the Android
 * notification module. Code that touches notifications therefore has to know
 * where it is running rather than assume the module is present.
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * True where scheduled local notifications can actually be delivered.
 *
 * Android Expo Go is the excluded case: `expo-notifications` throws there
 * rather than degrading, so every entry point in `lib/notifications.ts` is
 * gated on this. A development build (or any release build) lifts the
 * restriction — nothing about the app's own code changes.
 *
 * iOS Expo Go still schedules local notifications, so it is not excluded.
 */
export const notificationsSupported = !(isExpoGo && Platform.OS === 'android');
