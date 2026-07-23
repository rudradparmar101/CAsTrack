-- ============================================================================
-- Migration 010 — Phase 14.2, finding F0 (CRITICAL): close the
-- apply_receipts_to_invoice() cross-tenant write primitive
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ⚠ NOT YET APPLIED — drafted for Jay's review in Supabase Studio. Do not
-- apply via MCP or any automated path; this is a manual-apply-only gate,
-- same as every migration before it (001–009). Per the migration convention
-- added 2026-07-23 (project_context.md header block / docs/DECISIONS.md):
-- once applied and confirmed, THIS FILE'S OWN HEADER must be updated to
-- APPLIED <date> in the same session that folds it into schema.sql — that
-- update must not be deferred to a later session.
--
-- Found by: docs/verification/phase-14-rls-sweep.md, finding F0 —
-- scripts/verify/14-rls-sweep.mjs, check #112. `apply_receipts_to_invoice
-- (p_invoice_id UUID)` is SECURITY DEFINER, RETURNS VOID (not a trigger-only
-- return type, so nothing stops a direct RPC call), and its body had NO
-- firm-ownership check and NO permission check before running an UPDATE
-- against firm_invoices. Empirically confirmed live: EVB, a Firm B employee
-- with ZERO billing permission of any kind, called this RPC directly
-- against Firm A's invoice and it succeeded with no error, touching the
-- row's updated_at. SECURITY DEFINER means this function bypasses RLS
-- entirely — its own body is the only security boundary that exists for it,
-- and until this migration that boundary was absent.
--
-- FIX: add an explicit ownership check (the target invoice must belong to
-- the caller's own firm) and the same permission gate every other billing
-- write path already uses (billing.manage — the existing catalog key, not a
-- new one; matches the RLS on firm_invoices/receipts UPDATE and the
-- has_permission() pairing rule from migration 006, review finding 4).
--
-- service_role IS EXEMPT from both checks, deliberately: this function is
-- also invoked internally, on EVERY receipts write, by the on_receipt_change
-- trigger (handle_receipt_change() -> apply_receipts_to_invoice()) —
-- including service-role-driven receipt writes that legitimately bypass RLS
-- entirely (this project's own verify scripts seed receipts via the
-- service-role client; a future admin/backfill path might too). A
-- service-role call has no JWT and therefore no auth.uid() at all, so
-- get_user_firm_id()/has_permission() would resolve to NULL/false for it
-- regardless of legitimacy — auth.role() = 'service_role' is the correct,
-- unambiguous signal to distinguish "no RLS applies, already fully trusted"
-- from "an anon or authenticated caller with no relationship to this
-- invoice," which auth.uid() IS NULL alone cannot distinguish (anon-key
-- callers with no session also have auth.uid() IS NULL). For any
-- authenticated user (staff, any firm), the check is fully enforced — the
-- legitimate path (a real billing.manage-holding staff member recording a
-- receipt through the app, RLS-checked on the way in) always resolves both
-- checks true already, since guard_receipt() already validated the
-- receipt's firm/client match the invoice's, and the receipts RLS INSERT/
-- UPDATE/DELETE policies already require billing.manage to reach this point
-- at all — so this migration introduces no legitimate-path regression.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_receipts_to_invoice(p_invoice_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF NOT public.has_permission('billing.manage') THEN
      RAISE EXCEPTION 'You do not have permission to update this invoice''s settlement';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.firm_invoices
      WHERE id = p_invoice_id AND firm_id = public.get_user_firm_id()
    ) THEN
      RAISE EXCEPTION 'Invoice not found in your firm';
    END IF;
  END IF;

  UPDATE public.firm_invoices i
  SET amount_received = r.amt,
      tds_received    = r.tds,
      status = CASE
        WHEN i.status NOT IN ('issued', 'partially_paid', 'paid') THEN i.status
        WHEN r.amt + r.tds >= i.total_amount AND i.total_amount > 0 THEN 'paid'
        WHEN r.amt + r.tds > 0 THEN 'partially_paid'
        ELSE 'issued'
      END
  FROM (
    SELECT COALESCE(SUM(amount), 0) AS amt, COALESCE(SUM(tds_amount), 0) AS tds
    FROM public.receipts WHERE invoice_id = p_invoice_id
  ) r
  WHERE i.id = p_invoice_id;
END;
$$;

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.apply_receipts_to_invoice(p_invoice_id UUID)
-- RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   UPDATE public.firm_invoices i
--   SET amount_received = r.amt,
--       tds_received    = r.tds,
--       status = CASE
--         WHEN i.status NOT IN ('issued', 'partially_paid', 'paid') THEN i.status
--         WHEN r.amt + r.tds >= i.total_amount AND i.total_amount > 0 THEN 'paid'
--         WHEN r.amt + r.tds > 0 THEN 'partially_paid'
--         ELSE 'issued'
--       END
--   FROM (
--     SELECT COALESCE(SUM(amount), 0) AS amt, COALESCE(SUM(tds_amount), 0) AS tds
--     FROM public.receipts WHERE invoice_id = p_invoice_id
--   ) r
--   WHERE i.id = p_invoice_id;
-- END;
-- $$;
-- COMMIT;
--
-- Rolling back RESTORES the cross-tenant write primitive this migration
-- closes (F0 — any authenticated user in any firm could force a write to
-- another firm's firm_invoices row via this RPC) — only do this to
-- re-diagnose, never as a standing state.
-- ============================================================================
