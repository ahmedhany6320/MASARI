import type { Session, User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Authentication.
 *
 * Sign-in is entirely optional. Masari works fully offline with no account,
 * and an account only ever adds sync — so every call here is safe to make when
 * Supabase is unconfigured, returning a clear error rather than throwing into
 * the UI.
 */

export interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, user: session?.user ?? null, loading };
}

export interface AuthResult {
  ok: boolean;
  /** Present when `ok` is false. Safe to show the user. */
  error?: string;
  /** True when the account was created and needs email confirmation. */
  needsConfirmation?: boolean;
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: 'not-configured' };
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: 'not-configured' };
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
  });
  if (error) return { ok: false, error: error.message };
  // With email confirmation enabled, Supabase returns a user but no session.
  return { ok: true, needsConfirmation: !data.session };
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
