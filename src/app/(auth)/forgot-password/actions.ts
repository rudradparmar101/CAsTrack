'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { passwordResetEmail } from '@/lib/email/templates';
import { checkRateLimit, combineRateLimits, getClientIp, rateLimitMessage } from '@/lib/rate-limit';
import type { ActionResult } from '@/lib/types';

// Fixed floor so the response takes roughly the same time whether the email
// exists or not — the two branches below do very different amounts of work
// (a real account additionally calls generateLink's real token-issuing path
// AND sendEmail; a nonexistent one fails generateLink fast), so without this
// the response latency itself would leak account existence. Best-effort, not
// a guarantee (network/DB variance still leaks some signal) — that's the most
// that's practical from a serverless function with no dedicated timing
// infrastructure.
const MIN_RESPONSE_MS = 700;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Deliberately generic and identical regardless of whether the account
// exists — never reveal that via the message, an error, or a thrown
// exception. See the timing note above for the other half of this.
const GENERIC_RESULT: ActionResult = {
  success: true,
};

export async function requestPasswordResetAction(formData: FormData): Promise<ActionResult> {
  const start = Date.now();
  const email = (formData.get('email') as string)?.trim().toLowerCase();

  if (!email) {
    // Empty input isn't an enumeration vector (no email was even looked up)
    // — fine to respond immediately with a real validation error.
    return { success: false, error: 'Email is required.' };
  }

  // Two independent buckets, BOTH checked unconditionally before the
  // account-existence lookup below — a real and a fake email hit their
  // per-email bucket identically either way, so the rate-limit outcome never
  // correlates with whether the account exists (only with "this identifier
  // was already checked N times"), preserving the enumeration-safety
  // property this endpoint depends on (docs/DECISIONS.md, 2026-07-18).
  // Per-email catches one victim hammered from rotating IPs; per-IP catches
  // many addresses sprayed from one attacker. This is also the costliest
  // endpoint in the whole rate-limiting pass — every call sends a real
  // Resend email and, unlike Supabase's own recovery endpoint, has no
  // upstream protection of its own (see migration 019's header).
  const ip = await getClientIp();
  const rateLimit = combineRateLimits([
    await checkRateLimit('forgot_password_email', email),
    await checkRateLimit('forgot_password_ip', ip),
  ]);
  if (!rateLimit.allowed) {
    return { success: false, error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  try {
    const admin = createAdminClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    // generateLink (service-role admin API) mints Supabase's own real,
    // single-use, time-limited recovery token WITHOUT Supabase sending any
    // email itself — that's the only supported way to get a genuine
    // Supabase token while using our own branded sender instead of
    // Supabase's built-in mailer. redirectTo must be on the project's
    // Redirect URLs allow-list in Supabase Auth settings.
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent('/reset-password')}`,
      },
    });

    // No branching on the specific error (e.g. "user not found") — any
    // failure here just means we don't send an email. The caller-facing
    // result is identical either way.
    if (!error && data?.properties?.hashed_token) {
      const confirmUrl =
        `${siteUrl}/auth/confirm` +
        `?token_hash=${encodeURIComponent(data.properties.hashed_token)}` +
        `&type=recovery` +
        `&next=${encodeURIComponent('/reset-password')}`;

      await sendEmail({
        to: email,
        subject: 'Reset your Praxida password',
        html: passwordResetEmail({ resetUrl: confirmUrl }),
      });
    }
  } catch (err) {
    // Same reasoning as above: swallow and log, never surface to the caller.
    console.error('[forgot-password] unexpected error:', err);
  }

  const elapsed = Date.now() - start;
  if (elapsed < MIN_RESPONSE_MS) {
    await sleep(MIN_RESPONSE_MS - elapsed);
  }

  return GENERIC_RESULT;
}
