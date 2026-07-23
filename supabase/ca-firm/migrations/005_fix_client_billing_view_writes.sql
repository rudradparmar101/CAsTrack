-- ============================================================================
-- Migration 005 — Close client-writable DEFINER view gap on billing views
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ✅ APPLIED (Phase 12) — confirmed live: client_invoices/client_invoice_items
-- carry exactly this migration's fix (security_barrier=true, REVOKE of write
-- privileges from authenticated, verified directly against pg_views/
-- information_schema during Phase 14.2's systemic audit, 2026-07-23). Folded
-- into schema.sql in the same change. This header was stale ("NOT YET
-- APPLIED") until that audit caught it — see docs/DECISIONS.md for the
-- migration convention this class of gap motivated.
--
-- What this fixes (docs/verification/portal-isolation.md §7):
--
--   client_invoices / client_invoice_items are DEFINER-rights views with no
--   INSTEAD OF trigger and no WITH CHECK OPTION, so Postgres treats them as
--   auto-updatable: a write through the view is rewritten as a write
--   against firm_invoices / firm_invoice_items executed with the VIEW
--   OWNER'S rights. Migration 004 revoked ALL from anon/PUBLIC and granted
--   only SELECT to authenticated, but PUBLIC != authenticated — Supabase's
--   default privileges already grant `authenticated` full DML on newly
--   created objects in `public`, and that grant is additive, never removed
--   by 004's GRANT SELECT. The result: a portal client's own valid JWT can
--   UPDATE client_invoices to set status='paid'/rewrite amount_received, or
--   DELETE an issued invoice outright (gapping the statutory numbering
--   series) — entirely bypassing the deliberate absence of any client write
--   policy on firm_invoices. Confirmed live: §7.1 checks C12b/C12c FAIL.
--
-- FIX 1 (primary): explicitly REVOKE INSERT/UPDATE/DELETE on the client
-- billing views from `authenticated`, keeping SELECT. Also applied to
-- client_outstanding (security_invoker — writes through it would run under
-- the caller's own RLS, which already has no client policy on
-- firm_invoices, but the same default-privilege gap can otherwise leave a
-- writable grant sitting unused-but-present; revoked here as a matching
-- backstop, not because an exploit path was demonstrated against it).
--
-- FIX 2 (backstop, travels with the table not the view): a BEFORE DELETE
-- trigger on firm_invoices rejecting deletion of any row whose status is
-- not 'draft'. Issued invoices are statutory records — the correct
-- operation is cancel, never delete (guard_firm_invoice already enforces
-- this for UPDATE-based status changes; this closes the DELETE path the
-- guard trigger does not cover, since it only fires BEFORE UPDATE).
-- Verified not to interfere with ON DELETE CASCADE from firms (a firm-level
-- cascade delete removes the parent firms row; firm_invoices rows cascade
-- via their own FK regardless of status — this trigger only ever fires for
-- a direct DELETE targeting firm_invoices, which for a partner/employee
-- happens through the existing "Billing managers can delete draft
-- invoices" RLS policy anyway).
--
-- Explicitly NOT done here (see docs/ROADMAP.md Phase 14 deferred list and
-- docs/planning/phase-12-notes.md for the reasoning):
--   - guard_firm_invoice's frozen-column list still omits status /
--     amount_received / tds_received (apply_receipts_to_invoice() legitimately
--     writes them) — needs the session-variable pattern already noted for
--     the task_stage_history.note fix, not attempted in this migration.
--   - No audit of every other CREATE VIEW/CREATE TABLE in the schema for
--     this same class of default-privilege gap — logged for the Phase 14
--     final RLS pass.
--
-- Safety notes:
--   - Purely additive/restrictive: narrows privileges that were never
--     supposed to exist and adds one DELETE guard; no existing legitimate
--     read or write path is touched (staff billing.manage DELETE of a draft
--     invoice is unaffected — the new trigger only blocks non-draft
--     deletes, which no RLS policy currently permits anyway).
--   - Not idempotent (project migration convention) — run ONCE.
--   - Apply as a single transaction.
--
-- Rollback: bottom of file, commented out, reviewed not run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Strip residual DML privileges Supabase's default grants handed
--    `authenticated` on these views. SELECT stays; INSERT/UPDATE/DELETE
--    must never reach the underlying firm_invoices / firm_invoice_items
--    tables through the view rewrite.
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE
  ON public.client_invoices, public.client_invoice_items
  FROM authenticated;

REVOKE INSERT, UPDATE, DELETE
  ON public.client_outstanding
  FROM authenticated;

-- Re-affirm the intended grant explicitly (idempotent within this
-- transaction; makes the intent self-documenting at the point future
-- readers will look).
GRANT SELECT ON public.client_invoices, public.client_invoice_items TO authenticated;
GRANT SELECT ON public.client_outstanding TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Backstop: issued invoices are statutory records — cancel, never
--    delete. guard_firm_invoice (BEFORE UPDATE) already freezes status
--    transitions once issued; this closes the DELETE path, which no
--    BEFORE UPDATE trigger can see.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_firm_invoice_no_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft invoices can be deleted — cancel a % invoice instead', OLD.status;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER guard_firm_invoice_no_delete
  BEFORE DELETE ON public.firm_invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_firm_invoice_no_delete();

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS guard_firm_invoice_no_delete ON public.firm_invoices;
-- DROP FUNCTION IF EXISTS public.guard_firm_invoice_no_delete();
-- GRANT INSERT, UPDATE, DELETE ON public.client_invoices, public.client_invoice_items TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.client_outstanding TO authenticated;
-- COMMIT;
--
-- Rolling back RESTORES the write-through gap this migration closes (a
-- portal client's JWT could again mutate/delete its own firm_invoices rows
-- via the definer views) — only do this to re-diagnose, never as a
-- standing state.
-- ============================================================================
