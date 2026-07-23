/**
 * Every rate-limit threshold in this app, in one place (app-layer security
 * audit, finding M6).
 *
 * Before this module the eight live limits were bare literals at their call
 * sites across four files, and two of them — `auth_signup` and
 * `accept_invite_lookup` — already appeared TWICE with duplicated numbers.
 * That is the same shape as the duplicated-value drift that produced this
 * project's migration-header incident: one copy gets updated, the other
 * quietly does not.
 *
 * The deduplication is the obvious win. The one that actually matters is the
 * TYPE: `RateLimitAction` is a union of these keys, so `checkRateLimit()` can
 * only be called with an action that exists here. A typo previously produced a
 * silently-separate bucket that counted nothing and denied nobody — a limiter
 * that appears wired up and does nothing, with no error and no test that would
 * catch it. It is now a compile error.
 *
 * WHY A CONSTANTS MODULE AND NOT DB-BACKED CONFIG (the audit's own reasoning,
 * recorded here where a future session will actually read it): DB-backed
 * thresholds would add a read — or a cache with its own invalidation problem —
 * to the hot path of every public endpoint, and would put the limiter's
 * configuration inside the very system the limiter protects, so one DB problem
 * degrades the control twice. These numbers change approximately never; the
 * deploy cycle is appropriate change control for them. If per-firm limits are
 * ever wanted (a plausible Phase 15 SaaS-tier feature), the path stays open:
 * `rate_limit_buckets` already exists and `check_rate_limit()` already takes
 * the limit as an argument, so only the lookup below would change.
 *
 * The fixed-window limiter itself is deliberately unchanged — it is verified
 * in production (atomic under 40 concurrent callers, live IP-trust check
 * against praxida.in) and its only real weakness, a boundary burst of up to 2x
 * across a window edge, is irrelevant at these thresholds. See
 * docs/DECISIONS.md, 2026-07-24.
 */

export interface RateLimitRule {
  /** Attempts permitted per window, per identifier. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** What the identifier is — documentation, and a reminder at the call site. */
  keyedBy: 'ip' | 'email' | 'user' | 'firm';
}

const HOUR = 3600;

export const RATE_LIMITS = {
  // ---- public / unauthenticated (migration 019, thresholds unchanged) ----
  /** Both signup modes share this — a signUp() call is an account-creation
   *  attempt whichever mode it came through. Generous enough for a firm
   *  onboarding 15 employees from one office IP. */
  auth_signup: { max: 20, windowSeconds: HOUR, keyedBy: 'ip' },
  /** Cheap DB lookup, checked BEFORE the RPC so a guessing script never
   *  reaches even that query once it trips. Largely defence-in-depth —
   *  invite codes are 48-bit random. */
  invite_code_lookup: { max: 30, windowSeconds: HOUR, keyedBy: 'ip' },
  /** The costliest public endpoint: every call sends a real Resend email and
   *  it deliberately bypasses Supabase's own recovery rate limit, so it had
   *  zero upstream protection. Both buckets are checked unconditionally to
   *  preserve enumeration-safety. */
  forgot_password_email: { max: 8, windowSeconds: HOUR, keyedBy: 'email' },
  forgot_password_ip: { max: 15, windowSeconds: HOUR, keyedBy: 'ip' },
  /** Shared between the accept-invite page's own token lookup and the accept
   *  action's re-validation. Tokens are 128-bit random. */
  accept_invite_lookup: { max: 20, windowSeconds: HOUR, keyedBy: 'ip' },

  // ---- authenticated (app-layer audit, finding M5) ----------------------
  /** Portal invites send a branded, DKIM-signed email from the firm's own
   *  verified domain. Two buckets: per-user catches one compromised or
   *  malicious staff account; per-firm caps the blast radius of several. */
  client_invite_user: { max: 20, windowSeconds: HOUR, keyedBy: 'user' },
  client_invite_firm: { max: 50, windowSeconds: HOUR, keyedBy: 'firm' },
  /** Up to 500 sequential single-row INSERTs per call. The 500-row cap bounds
   *  one call; nothing bounded the loop. */
  client_import: { max: 10, windowSeconds: HOUR, keyedBy: 'user' },
  /** Walks every active client x every applicable compliance type across every
   *  department. Expensive and idempotent, so repeat runs are pure waste. */
  statutory_generation: { max: 6, windowSeconds: HOUR, keyedBy: 'firm' },
  /** Sends an email and advances the firm's gapless invoice counter. Lower
   *  priority than the three above — the counter is a natural constraint —
   *  but cheap to include while the call site is open. */
  invoice_issue: { max: 60, windowSeconds: HOUR, keyedBy: 'firm' },
} as const satisfies Record<string, RateLimitRule>;

/**
 * The union of every valid action name. This is the point of the module:
 * `checkRateLimit('cleint_invite_user', ...)` no longer compiles.
 */
export type RateLimitAction = keyof typeof RATE_LIMITS;

export function rateLimitRule(action: RateLimitAction): RateLimitRule {
  return RATE_LIMITS[action];
}
