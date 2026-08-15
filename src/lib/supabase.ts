import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Supabase client.
 *
 * The URL and anon key come from app config (`EXPO_PUBLIC_*` env vars). These
 * two values are public by design — the anon key is meant to ship in clients.
 * What protects the data is row-level security in the database, not secrecy of
 * this key, which is exactly the property the prototype's sync-code scheme
 * lacked. Never put the service-role key here; it bypasses RLS entirely.
 */
const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  (Constants.expoConfig?.extra?.supabaseUrl as string | undefined);

const anonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  (Constants.expoConfig?.extra?.supabaseAnonKey as string | undefined);

/**
 * Whether the app has been pointed at a backend yet. The app is fully usable
 * offline without one, so this is a feature flag rather than a fatal error —
 * sign-in and sync are simply hidden until it is configured.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

function createSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: {
      // AsyncStorage keeps the session across launches. On web there is no
      // AsyncStorage-backed native store, so the SDK's default is left alone.
      ...(Platform.OS === 'web' ? {} : { storage: AsyncStorage }),
      autoRefreshToken: true,
      persistSession: true,
      // React Native has no URL bar to parse a callback out of.
      detectSessionInUrl: Platform.OS === 'web',
    },
  });
}

export const supabase = createSupabase();

/** Throws when called without configuration — use `isSupabaseConfigured` first. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  return supabase;
}
