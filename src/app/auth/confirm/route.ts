import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeInternalPath } from '@/lib/safe-redirect';
import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * Verifies a Supabase recovery (or other OTP-type) token sent via our own
 * branded email — the token_hash + verifyOtp() pair is the flow-type-agnostic
 * pattern Supabase documents for custom email sends, independent of whether
 * the project uses PKCE or implicit auth flow (unlike following
 * generateLink()'s own action_link, which depends on that setting).
 *
 * Deliberately a separate route from /auth/callback: that route's signup
 * provisioning logic force-redirects a client_user to /portal regardless of
 * `next`, which would skip the password-set step for a client resetting
 * their password. Recovery verification has no provisioning concerns at all
 * (the profile already exists), so it stays fully isolated here.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  // Allow-listed to an internal path — same reasoning as /auth/callback: this
  // is concatenated onto `origin`, and `next=@evil.com` would make evil.com
  // the URL's HOST. See lib/safe-redirect.ts and the audit's L1.
  const next = safeInternalPath(searchParams.get('next'), '/reset-password');

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/reset-password?error=invalid_link`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(`${origin}/reset-password?error=invalid_link`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
