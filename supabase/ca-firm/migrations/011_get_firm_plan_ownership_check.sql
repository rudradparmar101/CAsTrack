-- ============================================================================
-- Migration 011 — Phase 14.2, finding F1-RPC (HIGH): close the
-- get_firm_plan() cross-tenant plan/feature leak
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ⚠ NOT YET APPLIED — drafted for Jay's review in Supabase Studio. Do not
-- apply via MCP or any automated path; this is a manual-apply-only gate,
-- same as every migration before it (001–010). Per the migration convention
-- (project_context.md header block / docs/DECISIONS.md): once applied and
-- confirmed, THIS FILE'S OWN HEADER must be updated to APPLIED <date> in the
-- same session that folds it into schema.sql.
--
-- Found by: docs/verification/phase-14-rls-sweep.md, finding F1-RPC —
-- scripts/verify/14-rls-sweep.mjs, checks #103-105. `get_firm_plan
-- (p_firm_id UUID)` is SECURITY DEFINER (bypasses the billing.view-gated RLS
-- on firm_subscriptions entirely) and takes an ARBITRARY firm UUID with no
-- ownership check and no permission check of any kind. Empirically confirmed
-- live: E0 (Firm A, billing.view explicitly revoked) got her own firm's plan
-- anyway; EV (Firm A employee) supplied Firm B's UUID and got Firm B's real
-- plan/pricing/feature data back; a client_user (UA1) could do the exact same
-- cross-firm call with no role restriction whatsoever.
--
-- FIX: same shape as migration 010 (F0) — add an ownership check (p_firm_id
-- must equal the caller's own firm) and require has_permission('billing.view')
-- inside the function body, matching the RLS this function is meant to sit
-- alongside (see schema.sql's firm_subscriptions SELECT policy). This is the
-- fix explicitly recommended in phase-14-rls-sweep.md's F1-RPC writeup.
--
-- is_super_admin() and service_role are BOTH exempt from the ownership check
-- specifically (not from the permission check, which has_permission() already
-- resolves to true for a super_admin internally per its own existing
-- "super_admin -> true" branch, migration-006-era comment above its
-- definition). A platform super admin's own profile has firm_id = NULL (they
-- are not a member of any firm), so a bare p_firm_id = get_user_firm_id()
-- check would incorrectly reject a super admin viewing ANY firm's plan --
-- exactly the cross-firm visibility platform_admins exists to grant. This
-- mirrors how every other super_admin-aware RLS policy in this schema treats
-- is_super_admin() as a blanket bypass. service_role is exempt for the same
-- reason as migration 010's apply_receipts_to_invoice(): a service-role
-- caller has no JWT and thus no auth.uid(), so get_user_firm_id() and
-- has_permission() cannot resolve meaningfully for it either way.
--
-- Converted from a one-line SQL function to plpgsql: the guard clauses need
-- procedural control flow (RAISE EXCEPTION before the SELECT), which a bare
-- SQL-language function body cannot express.
--
-- firm_has_feature(p_flag) — the one other function that calls get_firm_plan
-- internally — always passes get_user_firm_id() (its own caller's firm), so
-- the new ownership check is a no-op for it; the new billing.view requirement
-- is new coverage, but firm_has_feature() has zero callers in src/ today
-- (project_context.md §6 item 8: "DB helpers exist... but no server action
-- checks them yet"), so this introduces no live-app regression.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_firm_plan(p_firm_id UUID)
RETURNS public.plans LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result public.plans;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_super_admin() THEN
    IF NOT public.has_permission('billing.view') THEN
      RAISE EXCEPTION 'You do not have permission to view this firm''s plan';
    END IF;

    IF p_firm_id <> public.get_user_firm_id() THEN
      RAISE EXCEPTION 'Firm not found';
    END IF;
  END IF;

  SELECT p.* INTO v_result
  FROM public.plans p
  JOIN public.firm_subscriptions s ON s.plan_id = p.id
  WHERE s.firm_id = p_firm_id AND s.status IN ('trialing', 'active', 'past_due')
  LIMIT 1;

  RETURN v_result;
END;
$$;

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.get_firm_plan(p_firm_id UUID)
-- RETURNS public.plans AS $$
--   SELECT p.* FROM public.plans p
--   JOIN public.firm_subscriptions s ON s.plan_id = p.id
--   WHERE s.firm_id = p_firm_id AND s.status IN ('trialing', 'active', 'past_due')
--   LIMIT 1;
-- $$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
-- COMMIT;
--
-- Rolling back RESTORES the cross-tenant plan/feature leak this migration
-- closes (F1-RPC — any authenticated user, any role, could read any other
-- firm's subscription plan/feature data by UUID) — only do this to
-- re-diagnose, never as a standing state.
-- ============================================================================
