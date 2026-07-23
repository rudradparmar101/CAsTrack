import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * A throwaway, session-less Supabase client used ONLY to verify a password the
 * user has just typed (app-layer security audit, finding M3 — re-authentication
 * before a password change).
 *
 * Supabase Auth has no "verify this password" endpoint; the only way to check
 * one is to attempt a real sign-in with it. That is a state-changing call, so
 * it must not be made on the request's own server client — doing so would
 * rewrite the caller's session cookies as a side effect of a verification step,
 * and a failed attempt could disturb a session that was perfectly valid.
 *
 * This client therefore has no cookie adapter at all, and both
 * `persistSession` and `autoRefreshToken` are off: whatever session the
 * sign-in creates lives only in this object and is garbage-collected when the
 * action returns. It uses the ANON key (never the service role) — verifying a
 * password is exactly what the anon key is for, and there is no reason to
 * involve a privileged key in it.
 */
export function createReauthClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}
