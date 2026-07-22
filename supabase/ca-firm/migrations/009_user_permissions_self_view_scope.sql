-- ============================================================================
-- Migration 009 — Close client_user readability gap on user_permissions
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ⚠ NOT YET APPLIED — drafted for Jay's review in Supabase Studio. Do not
-- apply via MCP or any automated path; this is a manual-apply-only gate,
-- same as every migration before it (001–008).
--
-- Found by: scripts/verify/12-permissions-ui.mjs, check II1, during the
-- Phase 13.3 Step 0 gate (Supabase MCP was unavailable in this environment,
-- so Step 0 was closed empirically instead — see docs/DECISIONS.md and
-- project_context.md §4.x for that call). 24/25 checks passed; this is the
-- one that failed.
--
-- What's wrong (schema.sql, current live policy, "11.8 user_permissions"):
--
--   CREATE POLICY "Users can view their own permission overrides"
--     ON public.user_permissions FOR SELECT TO authenticated
--     USING (user_id = auth.uid());
--
--   This SELECT policy has no role restriction: it matches ANY authenticated
--   user whose own id appears in user_id, including a client_user. The
--   INSERT/UPDATE/DELETE policies on this table all correctly require
--   profile_in_my_firm(user_id, 'employee') — so under normal app operation
--   a client_user (or a partner) can never end up with a row here. But that
--   invariant is enforced only by the write policies, not by anything the
--   SELECT policy or the table schema itself guarantees. If a row for a
--   client_user (or partner) ever existed — a service-role script, a manual
--   Studio insert, a future bug in the write policies, a role change on a
--   profile after a row was created — that user could read it directly via
--   raw PostgREST. scripts/verify/12-permissions-ui.mjs check II1 proves
--   this concretely: a row force-seeded by service-role for a client_user
--   (something the app itself cannot do) came back with 1 row on a SELECT
--   as that client_user, where the spec requires zero.
--
-- Severity: this is a defense-in-depth gap, not a demonstrated escalation
-- path — no write path is affected (II2/II3/II4 all correctly reject), and
-- the row can only expose which permission_key/granted value a stray row
-- carries, never let the client_user act on it. But Phase 13.3's own
-- guardrail is "a client_user gets zero rows and zero write path" — this
-- migration closes the "zero rows" half for good, at the DB layer, rather
-- than resting on "no write path currently creates one."
--
-- FIX: scope the self-view policy to the only role that should ever
-- legitimately have a user_permissions row — employees. (Partners always
-- resolve has_permission() to true regardless of any row here, so a partner
-- has no legitimate reason to read one either; scoping to 'employee' rather
-- than 'employee' OR 'partner' matches the actual invariant precisely.)
--
-- Safety notes:
--   - Purely restrictive: narrows a SELECT policy that was already supposed
--     to be inaccessible to non-employees in practice. No legitimate
--     existing read path is removed — employees viewing their own overrides
--     (the one thing Phase 13.3's UI needs, indirectly, via has_permission()
--     and via a partner's own broader SELECT policy) is unaffected.
--   - Does not touch INSERT/UPDATE/DELETE policies (already correct — see
--     scripts/verify/12-permissions-ui.mjs checks I/II/III, all PASS).
--   - Not idempotent (project migration convention) — run ONCE.
--   - Apply as a single transaction.
--
-- Rollback: bottom of file, commented out, reviewed not run.
-- ============================================================================

BEGIN;

DROP POLICY "Users can view their own permission overrides" ON public.user_permissions;

CREATE POLICY "Employees can view their own permission overrides"
  ON public.user_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.get_user_role() = 'employee');

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- DROP POLICY "Employees can view their own permission overrides" ON public.user_permissions;
-- CREATE POLICY "Users can view their own permission overrides"
--   ON public.user_permissions FOR SELECT TO authenticated
--   USING (user_id = auth.uid());
-- COMMIT;
--
-- Rolling back RESTORES the gap this migration closes (any authenticated
-- user, including a client_user, could read a user_permissions row bearing
-- their own id if one ever existed) — only do this to re-diagnose, never as
-- a standing state.
-- ============================================================================
