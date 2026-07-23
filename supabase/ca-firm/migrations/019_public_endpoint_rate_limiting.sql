-- ============================================================================
-- Migration 019 — DB-backed rate limiting for public/unauthenticated
-- endpoints (the last gate before external testers get access).
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ✅ APPLIED 2026-07-24 — confirmed clean in Supabase Studio by Jay
-- (rate_limit_buckets present, RLS enabled). Folded into schema.sql in the
-- same session per the migration convention (project_context.md header
-- block / docs/DECISIONS.md).
--
-- The ENTIRE file is wrapped in one BEGIN;...COMMIT; block. Postgres DDL is
-- transactional: if ANY statement below fails, the WHOLE migration rolls
-- back atomically — no partial-application state.
--
-- ============================================================================
-- WHY THIS CAN'T BE IN-MEMORY (the constraint that shapes everything below):
-- the app runs on Vercel, which is serverless — each invocation of a server
-- action or route handler may land on a different instance, and instances
-- are recycled unpredictably. A Map, an LRU cache, or a module-level counter
-- would reset (or simply not be shared) between invocations, so it would
-- appear to work in `npm run dev` (one long-lived process) and then silently
-- do nothing in production. The counter has to live somewhere every
-- invocation can see and atomically update: Postgres, via a SECURITY
-- DEFINER function, same shape as every other cross-cutting write path this
-- project already uses (create_notification, record_dsc_movement, etc.).
--
-- WHAT THIS PROTECTS (see project_context.md §6 item 9 / docs/DECISIONS.md
-- 2026-07-23 "no rate limiting" entry for the prior open-item record):
--   - signup (both create-firm and join-firm modes) — auth_signup
--   - join-firm's invite-code lookup (lookup_firm_by_invite_code), which
--     runs BEFORE signUp and has zero native protection of its own —
--     invite_code_lookup
--   - forgot-password — forgot_password — the highest-priority endpoint:
--     it deliberately calls admin.generateLink() instead of the anon-key
--     resetPasswordForEmail() (2026-07-18 decision, so a branded email can
--     be sent instead of Supabase's own), which means Supabase's own
--     recovery-endpoint rate limit does NOT apply to it — today this path
--     has NO rate limiting anywhere, and every call costs a real Resend send.
--   - client portal invite acceptance (both the accept-invite page's
--     server-rendered token lookup and the accept action's re-validation) —
--     accept_invite_lookup
-- Login is NOT wired to this table — see the architectural note in the
-- session's Part A writeup: `/login` calls supabase.auth.signInWithPassword()
-- directly from the BROWSER against Supabase's own Auth API, never touching
-- this Next.js server, so no server-side gate (this one included) can see
-- that request at all. Supabase's own Auth rate limits are the only
-- protection that call has today.
--
-- WHY A SINGLE GENERIC FUNCTION, NOT ONE TABLE/FUNCTION PER ENDPOINT: every
-- endpoint above needs the identical primitive — "has this action+identifier
-- been seen more than N times in the current window" — with only the
-- action name, identifier, max-attempts, and window differing per call site.
-- One counter table + one atomic check-and-increment function, parameterized
-- per call, avoids four near-identical tables/functions that would drift the
-- way the migration-file-header convention drifted before §9 was added.
--
-- ATOMICITY / RACE-SAFETY (the actual hard requirement — a naive
-- SELECT-then-UPDATE undercounts under concurrent requests, because two
-- concurrent transactions can both read the same pre-increment count before
-- either writes back): `INSERT ... ON CONFLICT (bucket_key) DO UPDATE SET
-- count = rate_limit_buckets.count + 1` is a single atomic statement.
-- Postgres resolves a conflicting concurrent INSERT by having the losing
-- transaction(s) wait on the row's lock and then apply the UPDATE branch
-- against the now-committed row — there is no window where two concurrent
-- callers can both observe and increment from the same stale count. This is
-- the standard documented pattern for atomic upsert-counters in Postgres and
-- needs no application-level locking.
--
-- FIXED WINDOW, NOT SLIDING: the bucket key embeds the window's start time
-- (floor(epoch / window_seconds)), so a burst straddling a window boundary
-- can in principle see up to ~2x the nominal limit across the boundary
-- instant. Accepted deliberately — every limit below is already set with
-- headroom for legitimate bursts (e.g. a firm onboarding 15 employees), so
-- the fixed-window edge case doesn't materially change the abuse-resistance
-- story, and it keeps the bucket key (and therefore the cleanup predicate)
-- trivial: a row past its own expires_at is unconditionally dead.
--
-- SECURITY BOUNDARY (per the standing rule that every SECURITY DEFINER
-- function needs an explicit check on every caller-supplied identifier —
-- DECISIONS.md 2026-07-23 "DSC register" entries, F0/F1-RPC fixes): this
-- function is deliberately callable by UNAUTHENTICATED callers (anon), so
-- "does the caller own this firm/client" — the check every other DEFINER
-- function in this schema performs — has no meaning here; there is no
-- tenant relationship to check. Its actual security boundary is narrower and
-- structural, not permission-based: the function can NEVER read or write
-- ANY table other than rate_limit_buckets, and rate_limit_buckets holds
-- nothing but a hashed-nothing counter (an action label, a caller-supplied
-- identifier string, a count, and two timestamps) — no ability exists,
-- through this function, to read another caller's data or write to any
-- tenant table. The one real residual risk: because `p_identifier` is
-- whatever the caller passes, and this function is exposed the same way
-- lookup_firm_by_invite_code/lookup_client_invitation already are (anon-
-- callable, by necessity — every caller of THIS function is by definition
-- unauthenticated), someone could call check_rate_limit() directly via the
-- RPC endpoint with an identifier they don't "own" (e.g. someone else's IP
-- string or email) and pre-exhaust that bucket, causing a false rate-limit
-- hit against a victim who never made the real requests. This is a nuisance
-- denial-of-service against one specific bucket, not a data-exposure or
-- cross-tenant-write risk — it can never do anything worse than make one
-- action+identifier pair look rate-limited slightly early. Accepted for the
-- same reason lookup_firm_by_invite_code/lookup_client_invitation accept
-- being anon-callable: there is no way to serve unauthenticated callers from
-- a Postgres function without the anon Postgres role being able to invoke it
-- directly, and Supabase does not distinguish "our own server called this
-- with the anon key" from "a browser called this with the anon key" at the
-- database layer.
--
-- CLEANUP: no pg_cron / new scheduled job. Part C wires a
-- `DELETE FROM rate_limit_buckets WHERE expires_at < now()` into the START
-- of the existing `/api/cron/send-reminders` route (same "reuse the existing
-- daily cron" precedent as the Phase 13.2 DSC expiry alerts) — application
-- code, not DDL, so it isn't part of this migration.
-- ============================================================================

BEGIN;

CREATE TABLE public.rate_limit_buckets (
  bucket_key    TEXT PRIMARY KEY,
  action        TEXT NOT NULL,
  identifier    TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER NOT NULL DEFAULT 1,
  expires_at    TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE public.rate_limit_buckets IS
  'Fixed-window counters for public-endpoint rate limiting (signup, forgot-password, invite-code lookup, accept-invite). Holds IPs and/or emails as caller-supplied identifiers — personal data, RLS default-deny, no policies at all (mirrors task_stage_history). The ONLY writer is check_rate_limit() (SECURITY DEFINER). Rows are dead once past expires_at; cleanup runs from /api/cron/send-reminders, not a trigger or a separate cron.';

CREATE INDEX idx_rate_limit_buckets_expires_at ON public.rate_limit_buckets (expires_at);

-- rls_auto_enable() (migration 017) already does both of these automatically
-- for any newly created table, regardless of which role runs CREATE TABLE —
-- written explicitly here anyway, matching this project's existing house
-- convention of writing RLS/grants directly in the migration that creates a
-- table (e.g. migrations 004/005 for views) rather than relying solely on
-- the implicit event-trigger behavior.
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.rate_limit_buckets FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.rate_limit_buckets FROM authenticated;
-- Deliberately NO SELECT/INSERT/UPDATE/DELETE policy at all — RLS with zero
-- policies is a hard default-deny for every role including `authenticated`
-- (which still holds a table-level GRANT per Supabase's project-wide default
-- ACL — RLS is what actually blocks row access, not the grant). The only way
-- to touch this table's rows is through check_rate_limit() below.

-- Atomic check-and-increment. p_action/p_identifier form the bucket key
-- together with the current fixed window; p_max_attempts/p_window_seconds
-- are supplied per call site so one function serves every endpoint.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action TEXT,
  p_identifier TEXT,
  p_max_attempts INT,
  p_window_seconds INT
)
RETURNS TABLE(allowed BOOLEAN, retry_after_seconds INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_expires_at   TIMESTAMPTZ;
  v_bucket_key   TEXT;
  v_count        INT;
BEGIN
  IF p_action IS NULL OR p_identifier IS NULL OR p_max_attempts IS NULL OR p_window_seconds IS NULL
     OR p_max_attempts < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'check_rate_limit: all arguments are required and must be positive';
  END IF;

  v_window_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  v_expires_at := v_window_start + make_interval(secs => p_window_seconds);
  v_bucket_key := p_action || ':' || p_identifier || ':' || extract(epoch FROM v_window_start)::bigint;

  INSERT INTO public.rate_limit_buckets (bucket_key, action, identifier, window_start, count, expires_at)
  VALUES (v_bucket_key, p_action, p_identifier, v_window_start, 1, v_expires_at)
  ON CONFLICT (bucket_key) DO UPDATE SET count = rate_limit_buckets.count + 1
  RETURNING rate_limit_buckets.count INTO v_count;

  RETURN QUERY SELECT
    v_count <= p_max_attempts,
    GREATEST(0, ceil(extract(epoch FROM (v_expires_at - now())))::int);
END;
$$;

COMMENT ON FUNCTION public.check_rate_limit(TEXT, TEXT, INT, INT) IS
  'Atomic fixed-window check-and-increment for public-endpoint rate limiting. Anon-callable by necessity (every legitimate caller is unauthenticated) — see the migration header for why that is safe. Never touches any table but rate_limit_buckets.';

GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, TEXT, INT, INT) TO anon, authenticated;

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.check_rate_limit(TEXT, TEXT, INT, INT);
-- DROP TABLE IF EXISTS public.rate_limit_buckets;
-- COMMIT;
--
-- Rolling back removes rate limiting entirely from every endpoint that calls
-- check_rate_limit() — only do this to re-diagnose, never as a standing
-- state, and only once Part C's server-action call sites are also reverted
-- (a call site left in place would just start throwing "function does not
-- exist" if this function is dropped out from under it).
-- ============================================================================
