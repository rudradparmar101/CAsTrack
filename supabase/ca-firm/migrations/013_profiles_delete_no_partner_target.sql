-- ============================================================================
-- Migration 013 — Phase 14.2, finding F3 (MEDIUM): block partner-on-partner
-- profile deletion
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ✅ APPLIED 2026-07-23 — confirmed clean in Supabase Studio by Jay; the
-- policy's qual shows the role <> 'partner' exclusion live. Folded into
-- schema.sql in the same session per the migration convention
-- (project_context.md header block / docs/DECISIONS.md).
--
-- Found by: docs/verification/phase-14-rls-sweep.md, finding F3 — check #25.
-- `"Partners can remove profiles in their firm"` blocks self-deletion
-- (`id <> auth.uid()`) but has NO restriction on the target's role.
-- Empirically confirmed live: PA successfully DELETEd PA2's profile row — a
-- second, same-firm partner, not an employee. The legitimate case (a partner
-- removing an employee) also succeeds, as designed.
--
-- DECISION (Jay, 2026-07-23): block partner-on-partner removal entirely, not
-- allow it via a narrower confirmation mechanism. Mirrors the line this
-- project has already drawn elsewhere for partner-on-partner actions —
-- migration 009 scoped `user_permissions`' self-view SELECT and its
-- INSERT/UPDATE/DELETE policies to target `role = 'employee'` only, never a
-- partner; the DSC/documents `clients.view` scoping draws the same kind of
-- line for what an employee vs. a partner can reach. A partner unilaterally
-- removing a co-partner's entire staff access with a single DELETE call, no
-- consent or notification path, is a governance-sensitive action for what
-- the product model treats as a firm's ownership tier — removing a
-- co-partner (if ever genuinely needed) becomes a manual/support-assisted
-- action outside the app, not an in-app one.
--
-- FIX: add `AND role <> 'partner'` directly to the DELETE policy's USING
-- clause. No subquery needed (unlike profile_in_my_firm()'s pattern, which
-- exists for checking a DIFFERENT table's target reference) — the DELETE
-- policy's USING clause evaluates against the row being deleted itself, and
-- that row's own `role` column is exactly the target's role.
--
-- No regression: a partner removing an employee (the only legitimate,
-- already-tested case) still resolves `role <> 'partner'` to true and is
-- unaffected. Self-deletion was already blocked and remains blocked.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Partners can remove profiles in their firm" ON public.profiles;

CREATE POLICY "Partners can remove profiles in their firm"
  ON public.profiles FOR DELETE TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.get_user_role() = 'partner'
    AND id <> auth.uid()          -- a partner cannot delete themselves
    AND role <> 'partner'         -- nor delete a co-partner (migration 013, F3)
  );

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- DROP POLICY IF EXISTS "Partners can remove profiles in their firm" ON public.profiles;
-- CREATE POLICY "Partners can remove profiles in their firm"
--   ON public.profiles FOR DELETE TO authenticated
--   USING (
--     firm_id = public.get_user_firm_id()
--     AND public.get_user_role() = 'partner'
--     AND id <> auth.uid()
--   );
-- COMMIT;
--
-- Rolling back RESTORES the ability for a partner to delete a co-partner's
-- profile (F3 — no target-role exclusion) — only do this to re-diagnose,
-- never as a standing state.
-- ============================================================================
