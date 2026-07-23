/**
 * Single source of truth for password strength — used by signup (both modes),
 * password reset, portal invite acceptance, and the authenticated
 * change-password action.
 *
 * BEFORE (app-layer security audit, finding M4): three different rules were in
 * force. This module said 6 characters, `accept-invite/actions.ts` hardcoded
 * its own duplicate `< 6`, and `settings/actions.ts` used `< 8`. So the actual
 * floor depended on which door a user came through — and the weakest door set
 * the real floor, because a password created at 6 characters stays valid
 * everywhere afterwards.
 *
 * Six characters is below every current baseline: NIST SP 800-63B says 8
 * minimum, OWASP ASVS L1 says 12 for a new application. This product stores
 * clients' PAN, GSTIN, TAN, CIN, DSC custody records and invoices — a
 * compromise is a data-protection incident for the firm's CLIENTS, not just
 * for one user. There is also no compensating control at this layer: `/login`
 * is deliberately outside this project's rate limiter (it is a client-side
 * signInWithPassword() that never reaches this server — docs/DECISIONS.md,
 * 2026-07-24), so brute-force resistance rests entirely on Supabase's own
 * native Auth limits, which this project neither configures nor verifies.
 *
 * NO COMPOSITION RULES, deliberately. No "must contain an uppercase and a
 * digit and a symbol". Length dominates composition for real-world strength,
 * and NIST now explicitly advises against composition rules because they push
 * users toward predictable mutations (Password1!) and password reuse. A
 * 12-character passphrase beats a mangled 8-character one.
 *
 * ⚠ THIS IS ONLY HALF THE CONTROL. Supabase Auth enforces its own minimum
 * server-side, and a client could call supabase.auth.signUp() directly against
 * the Auth API without ever touching this app. The project-level "Minimum
 * password length" setting in the Supabase dashboard must be raised to match,
 * or this floor is bypassable. Tracked as a ⚠ HUMAN item.
 */

/** Raised from 6. OWASP ASVS L1 for a new application. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * bcrypt (which Supabase Auth uses) silently truncates at 72 BYTES, so
 * anything beyond that is not merely useless — it is misleading, because two
 * different long passwords sharing a 72-byte prefix would both authenticate.
 * Rejecting outright is clearer than truncating silently.
 */
export const MAX_PASSWORD_BYTES = 72;

export function validatePassword(password: string): string | null {
  if (!password) {
    return 'Password is required.';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you'll remember works well.`;
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return `Password is too long (limit ${MAX_PASSWORD_BYTES} bytes).`;
  }
  return null;
}
