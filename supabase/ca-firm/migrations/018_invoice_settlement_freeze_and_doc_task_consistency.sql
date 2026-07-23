-- ============================================================================
-- Migration 018 — Phase 14.1b, two findings from closing the remaining RLS
-- sweep coverage gaps:
--   A4 (HIGH — money-path integrity): guard_firm_invoice() does not freeze
--     status/amount_received/tds_received, so any billing.manage holder can
--     directly mark an issued invoice 'paid' with a fabricated
--     amount_received, with ZERO receipt ever created — bypassing
--     apply_receipts_to_invoice() and the entire receipts/receipt_history
--     audit trail this project relies on for every other settlement change.
--   A3 (MEDIUM — data integrity): no DB constraint or trigger ensures
--     documents.client_id matches the client_id of the task it's linked to
--     via task_id. attachDocumentToTaskAction enforces this at the app
--     layer only; a raw PostgREST UPDATE by any documents.approve holder can
--     link a document to a task belonging to a DIFFERENT client within the
--     same firm, producing a genuinely inconsistent row no policy or
--     constraint rejects.
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ⚠ NOT YET APPLIED — drafted for Jay's review in Supabase Studio. Do not
-- apply via MCP or any automated path; this is a manual-apply-only gate,
-- same as every migration before it (001–017). Per the migration convention
-- (project_context.md header block / docs/DECISIONS.md): once applied and
-- confirmed, THIS FILE'S OWN HEADER must be updated to APPLIED <date> in the
-- same session that folds it into schema.sql.
--
-- The ENTIRE file is wrapped in one BEGIN;...COMMIT; block. Postgres DDL is
-- transactional: if ANY statement below fails, the WHOLE migration rolls
-- back atomically — no partial-application state.
--
-- ============================================================================
-- A4 — FULL DETAIL: guard_firm_invoice()'s frozen-column list (client_id,
-- firm_id, financial_year, invoice_seq, invoice_number, invoice_date,
-- due_date, the GST/place-of-supply fields, subtotal/cgst/sgst/igst/
-- round_off/total_amount, tds_expected, issued_at, created_by, created_at)
-- deliberately EXCLUDES status, amount_received, and tds_received — the
-- existing comment above that block says why: "issued <-> partially_paid <->
-- paid moves are trigger-derived from receipts; receipts writes are
-- billing.manage-gated, so no separate actor check is needed here beyond
-- the column freeze above." That reasoning is exactly backwards for a
-- DIRECT UPDATE on firm_invoices itself: it correctly describes how
-- apply_receipts_to_invoice() legitimately changes these three columns (via
-- the on_receipt_change trigger, after a real receipts row is written and
-- audited in receipt_history) — but says NOTHING about a billing.manage
-- holder issuing a raw UPDATE directly against firm_invoices, skipping
-- receipts entirely. Confirmed empirically: EP (billing.manage) called
-- `.from('firm_invoices').update({ status: 'paid', amount_received: 5000,
-- tds_received: 0 })` directly against an already-issued invoice, and it
-- succeeded, producing an invoice that reads as fully paid with ZERO rows
-- in receipts or receipt_history to back it up.
--
-- FIX: the same session-variable technique already established by
-- record_dsc_movement() (transaction-local set_config, cleared automatically
-- at COMMIT) — apply_receipts_to_invoice() sets a flag immediately before
-- its own settlement UPDATE; guard_firm_invoice() requires that flag to be
-- set before allowing status/amount_received/tds_received to change, UNLESS
-- the change is the existing, legitimate direct 'cancelled' transition
-- (already gated below by the "no money applied" check) or the invoice is
-- still 'draft' (status changes freely until issued, which is existing,
-- correct behavior — draft invoices aren't a settlement concern yet).
--
-- No regression: apply_receipts_to_invoice() is the ONLY code path that ever
-- needs to set amount_received/tds_received or move status between
-- issued/partially_paid/paid, and it now sets the flag itself. Direct
-- cancellation (a real, existing UI action) is unaffected — it's explicitly
-- exempted, matching its own pre-existing rules(no money applied, not
-- already paid). Draft invoices are unaffected — the freeze only applies
-- once OLD.status <> 'draft', same as every other frozen column here.
-- ============================================================================
--
-- ============================================================================
-- A3 — FULL DETAIL: no DB-level check ensures a document's client_id
-- matches its linked task's client_id. attachDocumentToTaskAction (the only
-- app-layer path that links an EXISTING document to a task) checks
-- doc.client_id === task.client_id itself and refuses otherwise — but that
-- is an app-layer check only; nothing stops the same UPDATE via raw
-- PostgREST. Confirmed empirically: EP (documents.approve) issued
-- `.from('documents').update({ task_id: taskGst })` directly against
-- docTaskless (a document belonging to client A3) where taskGst belongs to
-- client A1 — the UPDATE succeeded, producing a document row whose
-- client_id (A3) no longer matches its own task_id's client (A1).
--
-- Consequence, precisely characterized (not overstated): this does NOT
-- appear to break client_user portal isolation directly — every client-side
-- documents/tasks RLS predicate is keyed on documents.client_id or
-- tasks.client_id independently (client_can_access_task/can_access_document's
-- client branches), which stay internally consistent with each ROW's own
-- client_id regardless of this cross-reference. The real risk is staff-side
-- data integrity: any UI or report that assumes "a task's linked documents
-- belong to that task's client" (a reasonable assumption nothing else in
-- this schema contradicts) can now be shown a document belonging to a
-- DIFFERENT client, mis-attributing paperwork across clients within the
-- same firm -- a real, if narrower than cross-firm, correctness problem for
-- a CA firm's own recordkeeping.
--
-- FIX: a BEFORE INSERT OR UPDATE trigger on documents — the same "RLS/app
-- checks can't express this, a data-integrity trigger can" pattern already
-- used for tasks.assigned_to/reviewer_id/department_id's firm checks
-- (migrations 015/016) — validates that whenever task_id is being set (a
-- fresh INSERT with a non-null task_id, or an UPDATE that changes task_id or
-- client_id), the referenced task's client_id matches NEW.client_id.
--
-- No regression: attachDocumentToTaskAction already enforces this exact
-- invariant at the app layer before ever issuing the UPDATE, so every
-- legitimate document-to-task link already satisfies this trigger trivially.
-- Task-less documents (task_id IS NULL) are entirely unaffected.
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

  -- Migration 018 (A4 fix): transaction-local flag, read by guard_firm_
  -- invoice() below, so this function's own legitimate settlement UPDATE is
  -- exempted from the new status/amount_received/tds_received freeze.
  -- Cleared automatically at COMMIT — same technique as record_dsc_
  -- movement()'s app.dsc_movement_note.
  PERFORM set_config('app.settlement_update', 'true', true);

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

CREATE OR REPLACE FUNCTION public.guard_firm_invoice()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Drafts may only move to 'issued' (via issue_firm_invoice); to discard a
  -- draft, DELETE it (allowed by policy) — that never gaps the series.
  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'issued') THEN
    RAISE EXCEPTION 'A draft invoice can only be issued (or deleted), not moved to %', NEW.status;
  END IF;

  -- Cancelled is terminal.
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled invoice cannot be modified';
  END IF;

  IF OLD.status <> 'draft' THEN
    -- Business columns are frozen once issued.
    IF NEW.client_id       IS DISTINCT FROM OLD.client_id
    OR NEW.firm_id         IS DISTINCT FROM OLD.firm_id
    OR NEW.financial_year  IS DISTINCT FROM OLD.financial_year
    OR NEW.invoice_seq     IS DISTINCT FROM OLD.invoice_seq
    OR NEW.invoice_number  IS DISTINCT FROM OLD.invoice_number
    OR NEW.invoice_date    IS DISTINCT FROM OLD.invoice_date
    OR NEW.due_date        IS DISTINCT FROM OLD.due_date
    OR NEW.firm_gstin      IS DISTINCT FROM OLD.firm_gstin
    OR NEW.client_gstin    IS DISTINCT FROM OLD.client_gstin
    OR NEW.place_of_supply IS DISTINCT FROM OLD.place_of_supply
    OR NEW.place_of_supply_state_code IS DISTINCT FROM OLD.place_of_supply_state_code
    OR NEW.is_interstate   IS DISTINCT FROM OLD.is_interstate
    OR NEW.subtotal        IS DISTINCT FROM OLD.subtotal
    OR NEW.cgst_amount     IS DISTINCT FROM OLD.cgst_amount
    OR NEW.sgst_amount     IS DISTINCT FROM OLD.sgst_amount
    OR NEW.igst_amount     IS DISTINCT FROM OLD.igst_amount
    OR NEW.round_off       IS DISTINCT FROM OLD.round_off
    OR NEW.total_amount    IS DISTINCT FROM OLD.total_amount
    OR NEW.tds_expected    IS DISTINCT FROM OLD.tds_expected
    OR NEW.issued_at       IS DISTINCT FROM OLD.issued_at
    OR NEW.created_by      IS DISTINCT FROM OLD.created_by
    OR NEW.created_at      IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Issued invoices are immutable — cancel and reissue instead of editing';
    END IF;

    -- Cancelling requires no money applied (delete/reallocate receipts first).
    IF NEW.status = 'cancelled' THEN
      IF OLD.status = 'paid' THEN
        RAISE EXCEPTION 'A fully paid invoice cannot be cancelled';
      END IF;
      IF OLD.amount_received <> 0 OR OLD.tds_received <> 0 THEN
        RAISE EXCEPTION 'Cannot cancel an invoice with receipts applied — remove or reallocate its receipts first';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.amount_received IS DISTINCT FROM OLD.amount_received
       OR NEW.tds_received IS DISTINCT FROM OLD.tds_received
    THEN
      -- Migration 018 (A4 fix): status/amount_received/tds_received may
      -- ONLY change via apply_receipts_to_invoice()'s own settlement
      -- recomputation (flagged via the transaction-local setting above) —
      -- never via a direct UPDATE from any other caller, however permitted
      -- at the RLS layer. This is what closes the "mark an invoice paid
      -- with no receipt" gap.
      IF current_setting('app.settlement_update', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'status, amount_received, and tds_received can only change via a recorded receipt (apply_receipts_to_invoice) or by cancelling the invoice';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- A3 fix: documents.client_id <-> linked task's client_id consistency.
CREATE OR REPLACE FUNCTION public.guard_document_task_client_consistency()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.task_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.client_id IS DISTINCT FROM OLD.client_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tasks t WHERE t.id = NEW.task_id AND t.client_id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'A document''s client_id must match the client_id of the task it is linked to';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_document_task_client
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_task_client_consistency();

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.apply_receipts_to_invoice(p_invoice_id UUID)
-- RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   IF auth.role() <> 'service_role' THEN
--     IF NOT public.has_permission('billing.manage') THEN
--       RAISE EXCEPTION 'You do not have permission to update this invoice''s settlement';
--     END IF;
--     IF NOT EXISTS (
--       SELECT 1 FROM public.firm_invoices
--       WHERE id = p_invoice_id AND firm_id = public.get_user_firm_id()
--     ) THEN
--       RAISE EXCEPTION 'Invoice not found in your firm';
--     END IF;
--   END IF;
--   UPDATE public.firm_invoices i
--   SET amount_received = r.amt, tds_received = r.tds,
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
--
-- CREATE OR REPLACE FUNCTION public.guard_firm_invoice()
-- RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'issued') THEN
--     RAISE EXCEPTION 'A draft invoice can only be issued (or deleted), not moved to %', NEW.status;
--   END IF;
--   IF OLD.status = 'cancelled' THEN
--     RAISE EXCEPTION 'A cancelled invoice cannot be modified';
--   END IF;
--   IF OLD.status <> 'draft' THEN
--     IF NEW.client_id IS DISTINCT FROM OLD.client_id
--     OR NEW.firm_id IS DISTINCT FROM OLD.firm_id
--     OR NEW.financial_year IS DISTINCT FROM OLD.financial_year
--     OR NEW.invoice_seq IS DISTINCT FROM OLD.invoice_seq
--     OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
--     OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
--     OR NEW.due_date IS DISTINCT FROM OLD.due_date
--     OR NEW.firm_gstin IS DISTINCT FROM OLD.firm_gstin
--     OR NEW.client_gstin IS DISTINCT FROM OLD.client_gstin
--     OR NEW.place_of_supply IS DISTINCT FROM OLD.place_of_supply
--     OR NEW.place_of_supply_state_code IS DISTINCT FROM OLD.place_of_supply_state_code
--     OR NEW.is_interstate IS DISTINCT FROM OLD.is_interstate
--     OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
--     OR NEW.cgst_amount IS DISTINCT FROM OLD.cgst_amount
--     OR NEW.sgst_amount IS DISTINCT FROM OLD.sgst_amount
--     OR NEW.igst_amount IS DISTINCT FROM OLD.igst_amount
--     OR NEW.round_off IS DISTINCT FROM OLD.round_off
--     OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
--     OR NEW.tds_expected IS DISTINCT FROM OLD.tds_expected
--     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
--     OR NEW.created_by IS DISTINCT FROM OLD.created_by
--     OR NEW.created_at IS DISTINCT FROM OLD.created_at
--     THEN
--       RAISE EXCEPTION 'Issued invoices are immutable — cancel and reissue instead of editing';
--     END IF;
--     IF NEW.status = 'cancelled' THEN
--       IF OLD.status = 'paid' THEN
--         RAISE EXCEPTION 'A fully paid invoice cannot be cancelled';
--       END IF;
--       IF OLD.amount_received <> 0 OR OLD.tds_received <> 0 THEN
--         RAISE EXCEPTION 'Cannot cancel an invoice with receipts applied — remove or reallocate its receipts first';
--       END IF;
--     END IF;
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
--
-- DROP TRIGGER IF EXISTS guard_document_task_client ON public.documents;
-- DROP FUNCTION IF EXISTS public.guard_document_task_client_consistency();
-- COMMIT;
--
-- Rolling back RESTORES both gaps this migration closes (A4 — any
-- billing.manage holder can directly fake an invoice's paid/amount_received
-- state with no receipt; A3 — a document can be linked to a task belonging
-- to a different client, with no constraint stopping it) — only do this to
-- re-diagnose, never as a standing state.
-- ============================================================================
