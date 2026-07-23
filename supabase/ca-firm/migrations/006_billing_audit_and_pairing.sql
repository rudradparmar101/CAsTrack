-- ============================================================================
-- Migration 006 — Phase 14 (Final RLS pass): close billing review findings
-- 2-4 at the DB level
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ✅ APPLIED 2026-07-18 via the Supabase SQL editor (commit 45fa98c); folded
-- into schema.sql in the same commit, verified with
-- scripts/verify/09-billing-audit-and-pairing.mjs. This header was not
-- updated at the time — corrected 2026-07-23 after Phase 14.1's RLS sweep
-- found the live database didn't match this file's stale "not applied"
-- status; see docs/verification/migration-006-reconciliation.md for the
-- full investigation (every object below was re-verified live and matches
-- this file exactly).
--
-- Closes docs/planning/phase-12-notes.md's Migration-004 review findings 2-4
-- (finding 1 — client_invoices/client_invoice_items definer views excluding
-- internal_notes/cancellation_reason — was already closed by migration 004,
-- with the write-through gap in that mechanism separately closed by
-- migration 005; not touched here).
--
-- Finding 2 — on-account receipts (docs/planning/phase-12-notes.md:38-41):
--   receipts.invoice_id was NOT NULL, so an unallocated receipt could not
--   exist at all — deferred pending pilot demand. This migration makes
--   invoice_id nullable, teaches guard_receipt() and handle_receipt_change()
--   to skip invoice-linked validation/settlement for on-account rows, and
--   rebuilds client_outstanding as a FULL OUTER JOIN of invoice-based
--   outstanding and on-account credit per (firm_id, client_id) — so a
--   client with ONLY on-account receipts (no open invoice) now appears in
--   the ledger with a negative "outstanding" (a credit balance), and a
--   client with both nets the on-account credit against invoice-based
--   outstanding. Aged buckets stay invoice-only (on-account money isn't
--   attached to any one invoice's due date) — on_account_credit is exposed
--   as its own column so a future UI can show it distinctly. Applying
--   on-account credit TO a specific invoice (manual allocation) is
--   explicitly NOT built here — out of scope for this migration.
--
-- Finding 3 — receipt mutation audit trail (ROADMAP.md Phase 14 item 2,
--   "receipt mutation audit trail — receipts are DELETE/UPDATE-able by
--   billing.manage with no history"):
--   DECISION: audit trail, not immutability. receipts stay
--   billing.manage-mutable (matches the existing accepted UI decision,
--   project_context.md §6 — the UI intentionally exposes no edit/delete
--   action, so mutation is a deliberate direct-DB-access path for
--   correcting mistakes) — but every INSERT/UPDATE/DELETE is now logged by
--   a SECURITY DEFINER trigger into a new trigger-only-writable
--   receipt_history table, mirroring the existing task_stage_history
--   precedent (RLS enabled, no INSERT/UPDATE/DELETE policy at all → direct
--   writes denied; the SECURITY DEFINER trigger function is the only
--   writer). receipt_history is NOT FK'd to receipts (ON DELETE would
--   destroy the very DELETE row it's supposed to preserve) — it stores
--   receipt_id as a plain UUID plus a full before/after JSONB snapshot.
--
-- Finding 4 — billing.manage implies billing.view (docs/planning/phase-12-notes.md:21-29):
--   Previously "documented as a pairing rule" only — not enforced. Any
--   grant path (Phase 13's user_permissions editor, verify-script seeding,
--   manual service-role grants) had to remember to grant both keys
--   together, or issue_firm_invoice()'s SELECT ... FOR UPDATE (which needs
--   the firm_invoices SELECT policy, i.e. billing.view) would fail for a
--   billing.manage-only employee with "Invoice not found or not
--   accessible".
--   DECISION: auto-pair, not reject-at-grant-time. has_permission() now
--   special-cases p_key = 'billing.view': it also returns true whenever
--   has_permission('billing.manage') is true, checked BEFORE consulting
--   any user_permissions override on billing.view itself — so billing.view
--   cannot be silently defeated by an explicit revoke override while
--   billing.manage remains granted (a functional dependency, not a policy
--   preference: issue_firm_invoice() cannot work without it). This is
--   structurally guaranteed for every current and future grant path,
--   unlike a reject-at-grant-time trigger, which would need to fire on
--   BOTH role_permissions and user_permissions and still couldn't stop a
--   later revoke of billing.view alone from re-breaking the pairing.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Finding 2a — on-account receipts: invoice_id becomes nullable.
-- ----------------------------------------------------------------------------

ALTER TABLE public.receipts ALTER COLUMN invoice_id DROP NOT NULL;

COMMENT ON COLUMN public.receipts.invoice_id IS
  'NULL = on-account receipt, not yet allocated to any invoice (migration 006, review finding 2). Reflected in client_outstanding as on_account_credit, netted into outstanding.';

-- ----------------------------------------------------------------------------
-- Finding 2b — guard_receipt() must skip invoice-linked validation for
-- on-account (invoice_id IS NULL) rows; there is nothing to validate
-- against. Client/firm consistency still comes from the FK + RLS as before.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_receipt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv public.firm_invoices%ROWTYPE;
BEGIN
  IF NEW.invoice_id IS NULL THEN
    RETURN NEW; -- on-account: unallocated, nothing to validate against (finding 2)
  END IF;

  SELECT * INTO v_inv FROM public.firm_invoices WHERE id = NEW.invoice_id;
  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Receipt references a nonexistent invoice';
  END IF;
  IF v_inv.status NOT IN ('issued', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'Receipts can only be applied to issued invoices (invoice is %)', v_inv.status;
  END IF;
  IF v_inv.client_id <> NEW.client_id OR v_inv.firm_id <> NEW.firm_id THEN
    RAISE EXCEPTION 'Receipt client/firm must match the invoice it is applied to';
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- Finding 2c — handle_receipt_change()/apply_receipts_to_invoice() must not
-- be invoked for on-account rows (no invoice to settle).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_receipt_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.invoice_id IS NOT NULL THEN
    PERFORM public.apply_receipts_to_invoice(NEW.invoice_id);
  END IF;
  -- OLD is only ever referenced when TG_OP is DELETE or UPDATE (it is
  -- unassigned, not merely NULL, on INSERT — accessing a field of it there
  -- raises "record OLD is not assigned yet").
  IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id))
     AND OLD.invoice_id IS NOT NULL THEN
    PERFORM public.apply_receipts_to_invoice(OLD.invoice_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ----------------------------------------------------------------------------
-- Finding 2d — client_outstanding rebuilt to include on-account credit.
-- Same security_invoker = true as before (staff-only via the caller's own
-- billing.view RLS on firm_invoices AND receipts).
-- ----------------------------------------------------------------------------

DROP VIEW public.client_outstanding;

CREATE VIEW public.client_outstanding
WITH (security_invoker = true) AS
WITH invoice_agg AS (
  SELECT
    i.firm_id,
    i.client_id,
    COUNT(*)                                                        AS open_invoice_count,
    SUM(i.total_amount - i.amount_received - i.tds_received)        AS invoice_outstanding,
    SUM(i.total_amount)                                             AS total_billed,
    SUM(i.amount_received)                                          AS total_received,
    SUM(i.tds_received)                                             AS total_tds,
    MIN(COALESCE(i.due_date, i.invoice_date))                       AS oldest_due_date,
    SUM(CASE WHEN CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) <= 30
         THEN i.total_amount - i.amount_received - i.tds_received ELSE 0 END) AS bucket_0_30,
    SUM(CASE WHEN CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) BETWEEN 31 AND 60
         THEN i.total_amount - i.amount_received - i.tds_received ELSE 0 END) AS bucket_31_60,
    SUM(CASE WHEN CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) BETWEEN 61 AND 90
         THEN i.total_amount - i.amount_received - i.tds_received ELSE 0 END) AS bucket_61_90,
    SUM(CASE WHEN CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) > 90
         THEN i.total_amount - i.amount_received - i.tds_received ELSE 0 END) AS bucket_90_plus
  FROM public.firm_invoices i
  WHERE i.status IN ('issued', 'partially_paid')
  GROUP BY i.firm_id, i.client_id
),
on_account_agg AS (
  SELECT
    r.firm_id,
    r.client_id,
    SUM(r.amount + r.tds_amount) AS on_account_credit
  FROM public.receipts r
  WHERE r.invoice_id IS NULL
  GROUP BY r.firm_id, r.client_id
)
SELECT
  COALESCE(ia.firm_id, oa.firm_id)                                           AS firm_id,
  COALESCE(ia.client_id, oa.client_id)                                       AS client_id,
  COALESCE(ia.open_invoice_count, 0)                                         AS open_invoice_count,
  COALESCE(ia.invoice_outstanding, 0) - COALESCE(oa.on_account_credit, 0)    AS outstanding,
  COALESCE(ia.total_billed, 0)                                               AS total_billed,
  COALESCE(ia.total_received, 0)                                             AS total_received,
  COALESCE(ia.total_tds, 0)                                                  AS total_tds,
  COALESCE(oa.on_account_credit, 0)                                          AS on_account_credit,
  ia.oldest_due_date                                                         AS oldest_due_date,
  COALESCE(ia.bucket_0_30, 0)                                                AS bucket_0_30,
  COALESCE(ia.bucket_31_60, 0)                                               AS bucket_31_60,
  COALESCE(ia.bucket_61_90, 0)                                               AS bucket_61_90,
  COALESCE(ia.bucket_90_plus, 0)                                             AS bucket_90_plus
FROM invoice_agg ia
FULL OUTER JOIN on_account_agg oa
  ON ia.firm_id = oa.firm_id AND ia.client_id = oa.client_id;

-- Re-apply migration 005's REVOKE — CREATE VIEW resets to Supabase's default
-- privileges every time (see docs/planning/phase-12-notes.md's migration-005
-- note: this REVOKE must be repeated whenever a definer/invoker view is
-- recreated, not just once at initial creation). client_outstanding is
-- security_invoker (not definer), so this is defense in depth, not the
-- primary control — but cheap and required by the documented convention.
REVOKE INSERT, UPDATE, DELETE ON public.client_outstanding FROM authenticated;
GRANT SELECT ON public.client_outstanding TO authenticated;

-- ----------------------------------------------------------------------------
-- Finding 3 — receipt_history: trigger-only audit trail. Same pattern as
-- task_stage_history: RLS enabled, no INSERT/UPDATE/DELETE policy at all
-- (direct writes denied by RLS default-deny), the SECURITY DEFINER trigger
-- function is the only writer. Not FK'd to receipts — a DELETE's history
-- row must outlive the receipt it describes.
-- ----------------------------------------------------------------------------

CREATE TABLE public.receipt_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  receipt_id UUID NOT NULL,
  operation  TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  client_id  UUID NOT NULL,
  invoice_id UUID,
  old_data   JSONB, -- NULL for insert
  new_data   JSONB, -- NULL for delete
  changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_receipt_history_receipt ON public.receipt_history(receipt_id);
CREATE INDEX idx_receipt_history_firm    ON public.receipt_history(firm_id, client_id);

CREATE OR REPLACE FUNCTION public.log_receipt_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.receipt_history (firm_id, receipt_id, operation, client_id, invoice_id, old_data, new_data, changed_by)
    VALUES (NEW.firm_id, NEW.id, 'insert', NEW.client_id, NEW.invoice_id, NULL, to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.receipt_history (firm_id, receipt_id, operation, client_id, invoice_id, old_data, new_data, changed_by)
    VALUES (NEW.firm_id, NEW.id, 'update', NEW.client_id, NEW.invoice_id, to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.receipt_history (firm_id, receipt_id, operation, client_id, invoice_id, old_data, new_data, changed_by)
    VALUES (OLD.firm_id, OLD.id, 'delete', OLD.client_id, OLD.invoice_id, to_jsonb(OLD), NULL, auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER log_receipt_mutation
  AFTER INSERT OR UPDATE OR DELETE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.log_receipt_change();

ALTER TABLE public.receipt_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing viewers can see receipt history"
  ON public.receipt_history FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.view'));

CREATE POLICY "Super admins can view all receipt history"
  ON public.receipt_history FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- No INSERT/UPDATE/DELETE policy — RLS default-denies all direct writes.
-- log_receipt_change() (SECURITY DEFINER, above) is the only writer.

-- ----------------------------------------------------------------------------
-- Finding 4 — billing.manage implies billing.view (auto-pair at check time).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_permission(p_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_role     TEXT;
  v_override BOOLEAN;
BEGIN
  IF public.is_super_admin() THEN RETURN true; END IF;
  v_role := public.get_user_role();
  IF v_role = 'partner' THEN RETURN true; END IF;
  IF v_role IS DISTINCT FROM 'employee' THEN RETURN false; END IF;

  -- billing.manage implies billing.view (migration 006, review finding 4):
  -- issue_firm_invoice() is SECURITY INVOKER and opens with
  -- SELECT ... FOR UPDATE, which needs the firm_invoices SELECT policy
  -- (billing.view). Checked BEFORE the user_permissions override lookup
  -- below so an explicit billing.view=false override cannot defeat a
  -- billing.manage grant — this is a functional dependency (the RPC
  -- literally cannot work without it), not a revocable policy preference.
  IF p_key = 'billing.view' AND public.has_permission('billing.manage') THEN
    RETURN true;
  END IF;

  SELECT granted INTO v_override
  FROM public.user_permissions
  WHERE user_id = auth.uid() AND permission_key = p_key;
  IF FOUND THEN RETURN v_override; END IF;

  RETURN COALESCE(
    (SELECT allowed FROM public.role_permissions
     WHERE role = 'employee' AND permission_key = p_key),
    false
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMIT;

-- ============================================================================
-- ROLLBACK (reverse order; reviewed but NOT run as part of this migration)
-- ============================================================================
-- BEGIN;
--
-- CREATE OR REPLACE FUNCTION public.has_permission(p_key TEXT)
-- RETURNS BOOLEAN AS $$
-- DECLARE
--   v_role     TEXT;
--   v_override BOOLEAN;
-- BEGIN
--   IF public.is_super_admin() THEN RETURN true; END IF;
--   v_role := public.get_user_role();
--   IF v_role = 'partner' THEN RETURN true; END IF;
--   IF v_role IS DISTINCT FROM 'employee' THEN RETURN false; END IF;
--
--   SELECT granted INTO v_override
--   FROM public.user_permissions
--   WHERE user_id = auth.uid() AND permission_key = p_key;
--   IF FOUND THEN RETURN v_override; END IF;
--
--   RETURN COALESCE(
--     (SELECT allowed FROM public.role_permissions
--      WHERE role = 'employee' AND permission_key = p_key),
--     false
--   );
-- END;
-- $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
--
-- DROP TRIGGER IF EXISTS log_receipt_mutation ON public.receipts;
-- DROP FUNCTION IF EXISTS public.log_receipt_change();
-- DROP TABLE IF EXISTS public.receipt_history;
--
-- DROP VIEW public.client_outstanding;
-- CREATE VIEW public.client_outstanding
-- WITH (security_invoker = true) AS
-- SELECT
--   i.firm_id, i.client_id, COUNT(*) AS open_invoice_count,
--   SUM(i.total_amount - i.amount_received - i.tds_received) AS outstanding,
--   SUM(i.total_amount) AS total_billed, SUM(i.amount_received) AS total_received,
--   SUM(i.tds_received) AS total_tds,
--   MIN(COALESCE(i.due_date, i.invoice_date)) AS oldest_due_date,
--   SUM(CASE WHEN CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) <= 30
--        THEN i.total_amount - i.amount_received - i.tds_received ELSE 0 END) AS bucket_0_30,
--   SUM(CASE WHEN CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) BETWEEN 31 AND 60
--        THEN i.total_amount - i.amount_received - i.tds_received ELSE 0 END) AS bucket_31_60,
--   SUM(CASE WHEN CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) BETWEEN 61 AND 90
--        THEN i.total_amount - i.amount_received - i.tds_received ELSE 0 END) AS bucket_61_90,
--   SUM(CASE WHEN CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) > 90
--        THEN i.total_amount - i.amount_received - i.tds_received ELSE 0 END) AS bucket_90_plus
-- FROM public.firm_invoices i
-- WHERE i.status IN ('issued', 'partially_paid')
-- GROUP BY i.firm_id, i.client_id;
-- REVOKE INSERT, UPDATE, DELETE ON public.client_outstanding FROM authenticated;
-- GRANT SELECT ON public.client_outstanding TO authenticated;
--
-- CREATE OR REPLACE FUNCTION public.handle_receipt_change()
-- RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   IF TG_OP IN ('INSERT', 'UPDATE') THEN
--     PERFORM public.apply_receipts_to_invoice(NEW.invoice_id);
--   END IF;
--   IF TG_OP = 'DELETE'
--      OR (TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id) THEN
--     PERFORM public.apply_receipts_to_invoice(OLD.invoice_id);
--   END IF;
--   RETURN COALESCE(NEW, OLD);
-- END;
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.guard_receipt()
-- RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- DECLARE
--   v_inv public.firm_invoices%ROWTYPE;
-- BEGIN
--   SELECT * INTO v_inv FROM public.firm_invoices WHERE id = NEW.invoice_id;
--   IF v_inv.id IS NULL THEN
--     RAISE EXCEPTION 'Receipt references a nonexistent invoice';
--   END IF;
--   IF v_inv.status NOT IN ('issued', 'partially_paid', 'paid') THEN
--     RAISE EXCEPTION 'Receipts can only be applied to issued invoices (invoice is %)', v_inv.status;
--   END IF;
--   IF v_inv.client_id <> NEW.client_id OR v_inv.firm_id <> NEW.firm_id THEN
--     RAISE EXCEPTION 'Receipt client/firm must match the invoice it is applied to';
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
--
-- -- NOTE: cannot cleanly roll back "ALTER COLUMN invoice_id SET NOT NULL" if
-- -- any on-account (NULL invoice_id) rows were inserted after this migration
-- -- applied — those rows would need reallocation or deletion first. Rolling
-- -- back this migration after any on-account receipt has been recorded is a
-- -- manual, reviewed operation, not a scripted one.
-- -- ALTER TABLE public.receipts ALTER COLUMN invoice_id SET NOT NULL;
--
-- COMMIT;
-- ============================================================================
