import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

/**
 * DB-backed rate limiting for public/unauthenticated endpoints (migration
 * 019). Vercel is serverless — an in-memory counter would not survive
 * between invocations, so the counter lives in Postgres via the atomic
 * check_rate_limit() RPC (SECURITY DEFINER, anon-callable by necessity; full
 * reasoning in the migration's header comment).
 *
 * FAIL OPEN, deliberately: if the RPC call itself errors (network blip, DB
 * hiccup), the request is allowed through and the failure is logged loudly.
 * This is one defense-in-depth layer on top of others that already exist
 * independently (Supabase's native signup rate limit, 48/128-bit entropy on
 * invite codes/tokens) — a transient outage in this layer must not become an
 * outage for signup or password reset. See docs/DECISIONS.md.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

type RpcCapable = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Core check against an already-constructed Supabase-like client (anything
 * with an `rpc()` method). Split out from checkRateLimit() so it can be
 * exercised directly — including with a deliberately broken client, to prove
 * the fail-open path — without needing next/headers' server-only context.
 */
export async function evaluateRateLimit(
  supabase: RpcCapable,
  action: string,
  identifier: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_action: action,
      p_identifier: identifier,
      p_max_attempts: maxAttempts,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      console.error(`[rate-limit] check_rate_limit("${action}") errored, failing open:`, error.message);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed: boolean; retry_after_seconds: number }
      | undefined;

    if (!row) {
      console.error(`[rate-limit] check_rate_limit("${action}") returned no row, failing open`);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
  } catch (err) {
    console.error(`[rate-limit] check_rate_limit("${action}") threw, failing open:`, err);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export async function checkRateLimit(
  action: string,
  identifier: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const supabase = await createClient();
  return evaluateRateLimit(supabase, action, identifier, maxAttempts, windowSeconds);
}

/** allowed iff every result is allowed; retryAfterSeconds is the largest of any denials. */
export function combineRateLimits(results: RateLimitResult[]): RateLimitResult {
  const denied = results.filter((r) => !r.allowed);
  if (denied.length === 0) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.max(...denied.map((r) => r.retryAfterSeconds)) };
}

export function rateLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * Client IP on Vercel: the edge network is the actual internet-facing TCP
 * terminator in front of every serverless invocation, so it sets
 * x-forwarded-for from the real connecting socket rather than trusting
 * whatever a client sent — a client cannot open a raw connection to the
 * origin function directly. Falls back to x-real-ip, then a shared 'unknown'
 * bucket (local dev / no proxy in front at all).
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();

  const forwarded = h.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  const real = h.get('x-real-ip');
  if (real?.trim()) return real.trim();

  return 'unknown';
}
