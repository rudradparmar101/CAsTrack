/**
 * One place that turns a PostgREST/Postgres error into something a user may
 * see (app-layer security audit, finding L2).
 *
 * The problem it replaces: ~50 call sites returned `error.message` verbatim to
 * the UI, and five separate copies of a local `rlsFriendly()` mapped only the
 * PGRST116 shape and passed everything else through. So a constraint violation
 * surfaced as
 *   new row for relation "receipts" violates check constraint "receipts_amount_check"
 * and an RLS denial on INSERT as
 *   new row violates row-level security policy for table "clients"
 * — table names, constraint names, and policy existence, disclosed to any
 * authenticated tenant user. Narrow (no data, no stack trace, no file path,
 * and Next already redacts THROWN server errors in production) but real, and
 * uniformly terrible UX besides.
 *
 * DELIBERATELY PRESERVED — the loud-fail behaviour on RLS denials. This
 * project's house style chains `.select('id').single()` onto every write
 * specifically so an RLS-denied update matches zero rows and reports as a
 * FAILURE instead of a silent success (docs/DECISIONS.md, 2026-07-07). That
 * property lives at the call sites, not here, and nothing in this module
 * changes it: a zero-row write still returns `success: false`, still with a
 * permission-shaped message. What changes is only WHICH string the user sees.
 * Do not "simplify" any call site into swallowing a zero-row result.
 *
 * Server-side, the full original error is always logged with its code, so
 * nothing is lost for debugging — it just stops being the user's problem.
 */

export interface DbErrorLike {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * PostgREST returns PGRST116 when a write matched no row. With RLS in play
 * that means "you can see this row but may not modify it" — the single most
 * common legitimate denial in this app.
 */
function isZeroRowMatch(error: DbErrorLike | null | undefined): boolean {
  if (!error) return true; // callers pass null when the row simply wasn't returned
  if (error.code === 'PGRST116') return true;
  const m = error.message ?? '';
  return m.includes('0 rows') || m.includes('multiple (or no) rows');
}

/**
 * Postgres SQLSTATEs this app can say something genuinely useful about.
 * Anything not listed collapses to the generic message — the safe default.
 */
const CODE_MESSAGES: Record<string, string> = {
  // 23505 unique_violation — call sites that can name the specific constraint
  // (e.g. "this client already has a rate for that service") should keep doing
  // so BEFORE calling this; this is the fallback wording.
  '23505': 'That already exists. Please check for a duplicate and try again.',
  '23503': 'This is still referenced by other records, so it cannot be changed or removed.',
  '23514': 'Some of those values aren’t valid. Please check the form and try again.',
  '23502': 'Something required was missing. Please fill in every required field.',
  '22P02': 'Some of those values aren’t in the expected format.',
  '22001': 'One of those values is too long.',
  // 42501 insufficient_privilege / RLS violation on INSERT
  '42501': 'You do not have permission to make this change.',
  // P0001 raise_exception — every RAISE EXCEPTION this schema throws is a
  // deliberate, human-written guard message (stage transitions, firm-ownership
  // checks, custody rules). Those ARE meant for the user, so they are passed
  // through by resolveDbError() rather than mapped here.
};

const GENERIC = 'Something went wrong. Please try again, or contact support if it keeps happening.';
const GENERIC_DENIED = 'You do not have permission to make this change.';

export interface FriendlyDbErrorOptions {
  /**
   * Message for the zero-row / RLS-denied case. Defaults to the generic
   * permission wording; pass a more specific one where the surface warrants it
   * (e.g. tasks used "You do not have permission to modify this task.").
   */
  deniedMessage?: string;
  /**
   * Where this came from, for the server-side log line. Use the action name.
   */
  context?: string;
}

/**
 * Map a Supabase/Postgres error to a user-safe string, and log the real one.
 *
 * Always returns a string safe to render. Never returns `error.message` unless
 * that message came from an explicit `RAISE EXCEPTION` in this project's own
 * schema (P0001), which is by construction human-written and user-directed —
 * that is how the stage machine's "Invalid stage transition" and the
 * firm-ownership guards' messages continue to reach the user unchanged.
 */
export function friendlyDbError(
  error: DbErrorLike | null | undefined,
  options: FriendlyDbErrorOptions = {}
): string {
  const { deniedMessage = GENERIC_DENIED, context } = options;

  if (error) {
    // Full detail server-side only. This is the half that keeps debugging
    // possible after the user-facing half stops disclosing anything.
    console.error(
      `[db-error]${context ? ` ${context}:` : ''} code=${error.code ?? 'none'} message=${error.message ?? ''}` +
        `${error.details ? ` details=${error.details}` : ''}${error.hint ? ` hint=${error.hint}` : ''}`
    );
  }

  if (isZeroRowMatch(error)) return deniedMessage;

  const code = error?.code;

  // Deliberate, human-written guard messages from this schema's own triggers
  // and SECURITY DEFINER functions are meant to be read by the user.
  if (code === 'P0001' && error?.message) return error.message;

  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  // Row-level-security denials do not always arrive with a clean code.
  if (error?.message?.includes('row-level security')) return deniedMessage;

  return GENERIC;
}
