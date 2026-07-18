-- ============================================================================
-- Migration 004 — Client billing & receivables (Phase 12)
-- Target: the LIVE CA Firm Manager Supabase project (fwmmdyebvzncpezdwnxm).
-- NOT YET APPLIED — present to Jay for approval first (same ⚠ HUMAN gate as
-- migrations 001/002/003), apply via the Supabase SQL editor, read-only
-- verify, then this header gets updated. Folded into schema.sql in the same
-- change (schema.sql stays the greenfield source of truth).
--
-- What this adds (docs/ROADMAP.md Phase 12 + docs/planning/phase-12-notes.md):
--
--   1. clients.fees_hold — "fees pending, hold work" flag surfaced as a
--      banner on tasks and the filing-status grid. Plain column; rides the
--      existing clients RLS (staff read via client visibility, updates via
--      clients.manage).
--
--   2. fee_masters — the firm's rate card (client_id IS NULL) plus optional
--      per-client overrides (client_id set), per service. Feeds invoice-line
--      defaults; never referenced by invoices (lines snapshot everything).
--
--   3. firm_invoices / firm_invoice_items — GST-compliant firm→client
--      invoices (SAC 9982 default per line, CGST/SGST vs IGST by place of
--      supply). Key legal properties, DB-enforced:
--        - GAPLESS per-firm-per-FY numbering: numbers are assigned only at
--          issue time by issue_firm_invoice() from firm_invoice_counters
--          (drafts carry no number, so deleting a draft never makes a gap;
--          a failed issue rolls the counter increment back atomically).
--        - Issued invoices are IMMUTABLE: guard trigger locks every business
--          column once status leaves 'draft'. Cancel + reissue, never edit.
--          Cancellation is blocked while any receipt money is applied.
--        - Line items are frozen with their parent: INSERT/UPDATE/DELETE on
--          items of a non-draft invoice is rejected by trigger.
--      TDS u/s 194J (the flagged highest-risk item): tds_expected is
--      captured on the invoice (client's likely 10% deduction on
--      professional fees); receipts record actual tds_amount deducted, and
--      the settlement math treats recorded TDS as money received — so a
--      corporate client paying 90% + TDS certificate settles in full and
--      the outstanding ledger stays right.
--
--   4. receipts — manual payment entry (Razorpay is Phase 15 by decision):
--      mode, reference, amount + tds_amount, allocated to exactly ONE
--      invoice (invoice_id NOT NULL — an unallocated "on-account" receipt
--      would be invisible to the outstanding ledger and silently overstate
--      receivables, so on-account receipts are DEFERRED pending pilot
--      demand, review finding 2). A SECURITY DEFINER trigger maintains
--      firm_invoices.amount_received / tds_received and derives the
--      issued ⇄ partially_paid ⇄ paid status — same denormalization-by-
--      trigger precedent as documents.current_version. A single cheque
--      covering several invoices is entered as several rows sharing
--      reference_no (decision: an allocation table was judged premature
--      for v1).
--
--   5. client_outstanding view — per-client receivables with aged buckets
--      (0-30 / 31-60 / 61-90 / 90+ days past invoice due/issue date).
--      security_invoker = true, so it inherits the caller's RLS on
--      firm_invoices (staff-only in practice: billing.view).
--
--   6. client_invoices / client_invoice_items views — the ONLY read path
--      for client_users (review finding 1: a direct SELECT policy on
--      firm_invoices would expose the whole row, RLS being row-level not
--      column-level — internal_notes and cancellation_reason must never
--      reach the client). Definer-rights views (NOT security_invoker —
--      with no client policy on the base table, an invoker view would
--      return nothing) with the client predicate baked in
--      (client_id = get_user_client_id() AND status <> 'draft') and
--      security_barrier on; explicit safe column list. Same
--      curated-access-via-definer pattern as get_client_assigned_contact()
--      (migration 002).
--
-- RLS: staff SELECT gated by billing.view, writes by billing.manage (both
-- already in the permissions catalog, employee-default false; partners
-- bypass via has_permission()). client_users have NO direct policy on any
-- billing table — they read ONLY through the client_invoices /
-- client_invoice_items views; never fee_masters, receipts, or counters.
--
-- Safety notes:
--   - Purely additive: no existing table/policy narrowed; clients gains one
--     defaulted column (no rewrite beyond the backfill pass).
--   - Not idempotent (project migration convention) — run ONCE.
--   - Apply as a single transaction.
--
-- Rollback: bottom of file, commented out, reviewed not run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. clients.fees_hold
-- ----------------------------------------------------------------------------
ALTER TABLE public.clients
  ADD COLUMN fees_hold BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.fees_hold IS
  'Phase 12: "fees pending — hold work" flag. Advisory banner on tasks and '
  'the filing-status grid; does not block any action. Updated via the '
  'existing clients.manage UPDATE policy.';

-- ----------------------------------------------------------------------------
-- 2. fee_masters — firm rate card + per-client overrides
-- ----------------------------------------------------------------------------
CREATE TABLE public.fee_masters (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id          UUID REFERENCES public.clients(id) ON DELETE CASCADE,  -- NULL = firm-wide rate card row
  service_name       TEXT NOT NULL CHECK (length(trim(service_name)) > 0),
  compliance_type_id UUID REFERENCES public.compliance_types(id) ON DELETE RESTRICT, -- optional link to the catalog
  amount             NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  periodicity        TEXT NOT NULL CHECK (periodicity IN ('one_time', 'monthly', 'quarterly', 'annual')) DEFAULT 'annual',
  notes              TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One rate per service, separately at firm level and per client.
CREATE UNIQUE INDEX uq_fee_master_firm_service
  ON public.fee_masters (firm_id, lower(service_name)) WHERE client_id IS NULL;
CREATE UNIQUE INDEX uq_fee_master_client_service
  ON public.fee_masters (client_id, lower(service_name)) WHERE client_id IS NOT NULL;

CREATE INDEX idx_fee_masters_firm   ON public.fee_masters(firm_id);
CREATE INDEX idx_fee_masters_client ON public.fee_masters(client_id) WHERE client_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. firm_invoices — GST-compliant firm→client invoices
-- ----------------------------------------------------------------------------
CREATE TABLE public.firm_invoices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id          UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT, -- invoices are statutory records; clients aren't hard-deleted anyway (F6)
  status             TEXT NOT NULL CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'cancelled')) DEFAULT 'draft',
  financial_year     TEXT NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'), -- '2026-27', mirrors tasks.financial_year
  -- Numbering: NULL while draft; assigned atomically at issue by
  -- issue_firm_invoice() so the per-firm-per-FY series stays GAPLESS.
  invoice_seq        INTEGER CHECK (invoice_seq IS NULL OR invoice_seq > 0),
  invoice_number     TEXT,                          -- display form, e.g. 'INV/2026-27/0042'
  invoice_date       DATE,                          -- set at issue
  due_date           DATE,                          -- payment due (drives ledger aging)
  -- GST snapshot, frozen at issue (immutable with the rest of the row):
  firm_gstin         TEXT,                          -- supplier GSTIN as printed
  client_gstin       TEXT,                          -- recipient GSTIN as printed (NULL = B2C/unregistered)
  place_of_supply    TEXT,                          -- state name as printed
  place_of_supply_state_code TEXT,                  -- GST state code, e.g. '27'
  is_interstate      BOOLEAN NOT NULL DEFAULT false, -- true ⇒ IGST; false ⇒ CGST+SGST
  -- Money (computed from items by issue_firm_invoice(); all INR):
  subtotal           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),      -- Σ taxable_value
  cgst_amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0),
  sgst_amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0),
  igst_amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (igst_amount >= 0),
  round_off          NUMERIC(6,2)  NOT NULL DEFAULT 0,                            -- total - (subtotal + gst), to whole rupee
  total_amount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  -- TDS u/s 194J: what the client is EXPECTED to deduct (typically 10% of
  -- subtotal for corporate clients). Editable while draft; settlement math
  -- uses the ACTUAL tds recorded on receipts (tds_received below).
  tds_expected       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tds_expected >= 0),
  -- Receipts-trigger-maintained (never written by the app):
  amount_received    NUMERIC(12,2) NOT NULL DEFAULT 0,
  tds_received       NUMERIC(12,2) NOT NULL DEFAULT 0,
  internal_notes     TEXT,                          -- internal; NEVER exposed to client_user (excluded from client_invoices view); stays editable post-issue
  cancellation_reason TEXT,                         -- internal; excluded from client_invoices view too
  cancelled_at       TIMESTAMPTZ,
  issued_at          TIMESTAMPTZ,
  created_by         UUID NOT NULL REFERENCES public.profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Drafts have no number; everything past draft must have one.
  CHECK ((status = 'draft') = (invoice_seq IS NULL)),
  CHECK ((invoice_seq IS NULL) = (invoice_number IS NULL)),
  CHECK ((invoice_seq IS NULL) = (invoice_date IS NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_invoice_number_per_firm_fy
  ON public.firm_invoices (firm_id, financial_year, invoice_seq)
  WHERE invoice_seq IS NOT NULL;

CREATE INDEX idx_firm_invoices_firm    ON public.firm_invoices(firm_id);
CREATE INDEX idx_firm_invoices_client  ON public.firm_invoices(client_id);
CREATE INDEX idx_firm_invoices_status  ON public.firm_invoices(status);
CREATE INDEX idx_firm_invoices_fy      ON public.firm_invoices(firm_id, financial_year);

CREATE TABLE public.firm_invoice_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  invoice_id    UUID NOT NULL REFERENCES public.firm_invoices(id) ON DELETE CASCADE,
  description   TEXT NOT NULL CHECK (length(trim(description)) > 0),
  sac_code      TEXT NOT NULL DEFAULT '9982',       -- accounting/auditing/bookkeeping services
  quantity      NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  rate          NUMERIC(12,2) NOT NULL CHECK (rate >= 0),          -- per unit
  taxable_value NUMERIC(12,2) NOT NULL CHECK (taxable_value >= 0), -- quantity × rate, app-computed
  gst_rate      NUMERIC(5,2)  NOT NULL DEFAULT 18 CHECK (gst_rate >= 0 AND gst_rate <= 100), -- % (split CGST/SGST or all IGST at issue)
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_items_invoice ON public.firm_invoice_items(invoice_id);

-- Gapless number series state, one row per (firm, FY). Only touched inside
-- issue_firm_invoice(), in the same transaction as the invoice UPDATE — a
-- failed issue rolls both back, so the series cannot gap.
CREATE TABLE public.firm_invoice_counters (
  firm_id        UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  last_seq       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (firm_id, financial_year)
);

-- ----------------------------------------------------------------------------
-- 4. receipts — manual payment entry (+ TDS u/s 194J actually deducted).
--    Every receipt allocates to exactly one invoice (on-account receipts
--    deferred pending pilot demand — see header).
-- ----------------------------------------------------------------------------
CREATE TABLE public.receipts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  invoice_id   UUID NOT NULL REFERENCES public.firm_invoices(id) ON DELETE RESTRICT,
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),      -- money actually received
  tds_amount   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),  -- TDS u/s 194J deducted by the client
  mode         TEXT NOT NULL CHECK (mode IN ('cash', 'cheque', 'bank_transfer', 'upi', 'card', 'other')) DEFAULT 'bank_transfer',
  reference_no TEXT,                                 -- cheque no / UTR / UPI ref
  notes        TEXT,
  created_by   UUID NOT NULL REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount + tds_amount > 0)
);

CREATE INDEX idx_receipts_firm    ON public.receipts(firm_id);
CREATE INDEX idx_receipts_client  ON public.receipts(client_id);
CREATE INDEX idx_receipts_invoice ON public.receipts(invoice_id);

-- ----------------------------------------------------------------------------
-- 5. updated_at triggers (existing handle_updated_at helper)
-- ----------------------------------------------------------------------------
CREATE TRIGGER on_fee_master_updated   BEFORE UPDATE ON public.fee_masters   FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_firm_invoice_updated BEFORE UPDATE ON public.firm_invoices FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_receipt_updated      BEFORE UPDATE ON public.receipts      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Invoice immutability guard (legal requirement: issued invoices are
--    never edited — cancel + reissue). Same guard-trigger pattern as
--    guard_profile_protected_fields (F1).
-- ----------------------------------------------------------------------------
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
    END IF;

    -- issued ⇄ partially_paid ⇄ paid moves are trigger-derived from receipts;
    -- receipts writes are billing.manage-gated, so no separate actor check
    -- is needed here beyond the column freeze above.
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_firm_invoice
  BEFORE UPDATE ON public.firm_invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_firm_invoice();

-- Line items freeze with their parent: any write to items of a non-draft
-- invoice is rejected (RLS also gates this; the trigger is the authority).
CREATE OR REPLACE FUNCTION public.guard_invoice_items_frozen()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.firm_invoices
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_status IS NULL THEN
    RETURN COALESCE(NEW, OLD); -- parent being cascade-deleted
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Line items of an issued invoice are immutable';
  END IF;
  -- An UPDATE must not re-point an item at a different invoice.
  IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION 'Line items cannot be moved between invoices';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER guard_invoice_items_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON public.firm_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_items_frozen();

-- ----------------------------------------------------------------------------
-- 7. Receipt validity + settlement maintenance
-- ----------------------------------------------------------------------------
-- BEFORE trigger: a receipt must reference a live (issued-family) invoice
-- of the SAME client and firm — the doc↔task cross-client gap (§6 known
-- risk 6) is not repeated here.
CREATE OR REPLACE FUNCTION public.guard_receipt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv public.firm_invoices%ROWTYPE;
BEGIN
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

CREATE TRIGGER guard_receipt
  BEFORE INSERT OR UPDATE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_receipt();

-- AFTER trigger: recompute the affected invoice(s)' settlement columns and
-- derive status (issued ⇄ partially_paid ⇄ paid). SECURITY DEFINER so the
-- denormalized columns update even though the actor's own UPDATE rights on
-- firm_invoices are irrelevant here (same pattern as the document-version
-- counters). Settlement counts amount + TDS actually deducted (u/s 194J):
-- a 90%-cash + 10%-TDS receipt fully settles the invoice.
CREATE OR REPLACE FUNCTION public.apply_receipts_to_invoice(p_invoice_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION public.handle_receipt_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.apply_receipts_to_invoice(NEW.invoice_id);
  END IF;
  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id) THEN
    PERFORM public.apply_receipts_to_invoice(OLD.invoice_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER on_receipt_change
  AFTER INSERT OR UPDATE OR DELETE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.handle_receipt_change();

-- ----------------------------------------------------------------------------
-- 8. issue_firm_invoice() — the ONLY path from draft to issued.
--    SECURITY INVOKER: the caller's own RLS (billing.manage) governs both the
--    counter write and the invoice UPDATE; the function exists purely for
--    atomicity (number assignment + totals snapshot + status flip in one
--    transaction — a failure anywhere rolls the counter back, keeping the
--    series gapless).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_firm_invoice(
  p_invoice_id   UUID,
  p_invoice_date DATE DEFAULT CURRENT_DATE
)
RETURNS public.firm_invoices
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_inv       public.firm_invoices%ROWTYPE;
  v_seq       INTEGER;
  v_subtotal  NUMERIC(12,2);
  v_gst       NUMERIC(12,2);
  v_raw_total NUMERIC(12,2);
  v_total     NUMERIC(12,2);
  v_items     INTEGER;
BEGIN
  -- Lock the draft row (also proves the caller can see it under RLS).
  SELECT * INTO v_inv FROM public.firm_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found or not accessible';
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft invoices can be issued (invoice is %)', v_inv.status;
  END IF;

  SELECT COUNT(*), COALESCE(SUM(taxable_value), 0),
         COALESCE(SUM(ROUND(taxable_value * gst_rate / 100, 2)), 0)
    INTO v_items, v_subtotal, v_gst
  FROM public.firm_invoice_items WHERE invoice_id = p_invoice_id;
  IF v_items = 0 THEN
    RAISE EXCEPTION 'Cannot issue an invoice with no line items';
  END IF;

  v_raw_total := v_subtotal + v_gst;
  v_total     := ROUND(v_raw_total, 0);  -- round to whole rupee

  -- Atomic, gapless next number for (firm, FY). The ON CONFLICT UPDATE takes
  -- a row lock, serializing concurrent issuers within one firm+FY.
  INSERT INTO public.firm_invoice_counters (firm_id, financial_year, last_seq)
  VALUES (v_inv.firm_id, v_inv.financial_year, 1)
  ON CONFLICT (firm_id, financial_year)
    DO UPDATE SET last_seq = public.firm_invoice_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  UPDATE public.firm_invoices
  SET status         = 'issued',
      invoice_seq    = v_seq,
      invoice_number = 'INV/' || financial_year || '/' || lpad(v_seq::text, 4, '0'),
      invoice_date   = p_invoice_date,
      issued_at      = now(),
      subtotal       = v_subtotal,
      cgst_amount    = CASE WHEN is_interstate THEN 0 ELSE ROUND(v_gst / 2, 2) END,
      sgst_amount    = CASE WHEN is_interstate THEN 0 ELSE v_gst - ROUND(v_gst / 2, 2) END,
      igst_amount    = CASE WHEN is_interstate THEN v_gst ELSE 0 END,
      round_off      = v_total - v_raw_total,
      total_amount   = v_total
  WHERE id = p_invoice_id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_firm_invoice(UUID, DATE) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. client_outstanding — per-client receivables with aged buckets.
--    security_invoker: the caller's RLS on firm_invoices applies — staff
--    need billing.view; client_users (who have no policy on firm_invoices)
--    get nothing here, by design. Ages by due_date, falling back to
--    invoice_date.
-- ----------------------------------------------------------------------------
CREATE VIEW public.client_outstanding
WITH (security_invoker = true) AS
SELECT
  i.firm_id,
  i.client_id,
  COUNT(*)                                                        AS open_invoice_count,
  SUM(i.total_amount - i.amount_received - i.tds_received)        AS outstanding,
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
GROUP BY i.firm_id, i.client_id;

-- ----------------------------------------------------------------------------
-- 9B. client_invoices / client_invoice_items — the ONLY read path for
--     client_users (review finding 1). RLS is row-level, not column-level:
--     a direct SELECT policy on firm_invoices would hand the client
--     internal_notes and cancellation_reason. These are DEFINER-RIGHTS
--     views (deliberately NOT security_invoker — with no client policy on
--     the base table an invoker view would return nothing) with the client
--     predicate baked in and an explicit safe column list; security_barrier
--     stops leaky functions from seeing rows before the predicate. Staff and
--     anon resolve get_user_client_id() to NULL and get zero rows. Same
--     curated-access-via-definer pattern as get_client_assigned_contact().
-- ----------------------------------------------------------------------------
CREATE VIEW public.client_invoices
WITH (security_barrier = true) AS
SELECT
  i.id, i.firm_id, i.client_id, i.status, i.financial_year,
  i.invoice_number, i.invoice_date, i.due_date,
  i.firm_gstin, i.client_gstin, i.place_of_supply,
  i.place_of_supply_state_code, i.is_interstate,
  i.subtotal, i.cgst_amount, i.sgst_amount, i.igst_amount,
  i.round_off, i.total_amount, i.tds_expected,
  i.amount_received, i.tds_received, i.issued_at, i.created_at
FROM public.firm_invoices i
WHERE i.client_id = public.get_user_client_id()
  AND i.status <> 'draft';

CREATE VIEW public.client_invoice_items
WITH (security_barrier = true) AS
SELECT
  li.id, li.invoice_id, li.description, li.sac_code,
  li.quantity, li.rate, li.taxable_value, li.gst_rate, li.sort_order
FROM public.firm_invoice_items li
JOIN public.firm_invoices i ON i.id = li.invoice_id
WHERE i.client_id = public.get_user_client_id()
  AND i.status <> 'draft';

REVOKE ALL ON public.client_invoices, public.client_invoice_items FROM anon, public;
GRANT SELECT ON public.client_invoices, public.client_invoice_items TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.fee_masters            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_invoice_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_invoice_counters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts               ENABLE ROW LEVEL SECURITY;

-- fee_masters — staff-only (clients never see the firm's rate card).
CREATE POLICY "Billing viewers can see fee masters"
  ON public.fee_masters FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.view'));

CREATE POLICY "Super admins can view all fee masters"
  ON public.fee_masters FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Billing managers can create fee masters"
  ON public.fee_masters FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.get_user_firm_id() AND public.has_permission('billing.manage'));

CREATE POLICY "Billing managers can update fee masters"
  ON public.fee_masters FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.manage'));

CREATE POLICY "Billing managers can delete fee masters"
  ON public.fee_masters FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.manage'));

-- firm_invoices — staff via billing.view/manage. NO client policy: client
-- reads go through the client_invoices view only (finding 1 — a row-level
-- policy would expose internal_notes / cancellation_reason).
CREATE POLICY "Billing viewers can see firm invoices"
  ON public.firm_invoices FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.view'));

CREATE POLICY "Super admins can view all firm invoices"
  ON public.firm_invoices FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Billing managers can create draft invoices"
  ON public.firm_invoices FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND public.has_permission('billing.manage')
    AND created_by = auth.uid()
    AND status = 'draft'      -- issue only via issue_firm_invoice()
  );

CREATE POLICY "Billing managers can update invoices"
  ON public.firm_invoices FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.manage'));
  -- (the guard trigger, not this policy, decides WHAT may change post-issue)

CREATE POLICY "Billing managers can delete draft invoices"
  ON public.firm_invoices FOR DELETE TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.has_permission('billing.manage')
    AND status = 'draft'      -- issued invoices are cancelled, never deleted
  );

-- firm_invoice_items — staff only; client reads go through the
-- client_invoice_items view (finding 1).
CREATE POLICY "Billing viewers can see invoice items"
  ON public.firm_invoice_items FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.view'));

CREATE POLICY "Super admins can view all invoice items"
  ON public.firm_invoice_items FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Billing managers can create invoice items"
  ON public.firm_invoice_items FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.get_user_firm_id() AND public.has_permission('billing.manage'));

CREATE POLICY "Billing managers can update invoice items"
  ON public.firm_invoice_items FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.manage'));

CREATE POLICY "Billing managers can delete invoice items"
  ON public.firm_invoice_items FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.manage'));
  -- (all three item writes additionally require the parent to be draft — trigger)

-- firm_invoice_counters — written only inside issue_firm_invoice() under the
-- caller's rights; readable for diagnostics by billing viewers.
CREATE POLICY "Billing viewers can see invoice counters"
  ON public.firm_invoice_counters FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.view'));

CREATE POLICY "Billing managers advance invoice counters"
  ON public.firm_invoice_counters FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.get_user_firm_id() AND public.has_permission('billing.manage'));

CREATE POLICY "Billing managers update invoice counters"
  ON public.firm_invoice_counters FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.manage'));

-- receipts — staff-only. Clients learn payment state from their invoice's
-- status/amount_received, never from raw receipt rows (which can carry
-- internal notes).
CREATE POLICY "Billing viewers can see receipts"
  ON public.receipts FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.view'));

CREATE POLICY "Super admins can view all receipts"
  ON public.receipts FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Billing managers can create receipts"
  ON public.receipts FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND public.has_permission('billing.manage')
    AND created_by = auth.uid()
  );

CREATE POLICY "Billing managers can update receipts"
  ON public.receipts FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.manage'));

CREATE POLICY "Billing managers can delete receipts"
  ON public.receipts FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.manage'));

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- DROP VIEW IF EXISTS public.client_invoice_items;
-- DROP VIEW IF EXISTS public.client_invoices;
-- DROP VIEW IF EXISTS public.client_outstanding;
-- DROP TRIGGER IF EXISTS on_receipt_change ON public.receipts;
-- DROP TRIGGER IF EXISTS guard_receipt ON public.receipts;
-- DROP TRIGGER IF EXISTS guard_invoice_items_frozen ON public.firm_invoice_items;
-- DROP TRIGGER IF EXISTS guard_firm_invoice ON public.firm_invoices;
-- DROP TRIGGER IF EXISTS on_receipt_updated ON public.receipts;
-- DROP TRIGGER IF EXISTS on_firm_invoice_updated ON public.firm_invoices;
-- DROP TRIGGER IF EXISTS on_fee_master_updated ON public.fee_masters;
-- DROP FUNCTION IF EXISTS public.issue_firm_invoice(UUID, DATE);
-- DROP FUNCTION IF EXISTS public.handle_receipt_change();
-- DROP FUNCTION IF EXISTS public.apply_receipts_to_invoice(UUID);
-- DROP FUNCTION IF EXISTS public.guard_receipt();
-- DROP FUNCTION IF EXISTS public.guard_invoice_items_frozen();
-- DROP FUNCTION IF EXISTS public.guard_firm_invoice();
-- DROP TABLE IF EXISTS public.receipts;
-- DROP TABLE IF EXISTS public.firm_invoice_counters;
-- DROP TABLE IF EXISTS public.firm_invoice_items;
-- DROP TABLE IF EXISTS public.firm_invoices;
-- DROP TABLE IF EXISTS public.fee_masters;
-- ALTER TABLE public.clients DROP COLUMN IF EXISTS fees_hold;
-- COMMIT;
--
-- Rolling back DESTROYS all billing data recorded between apply and
-- rollback (invoices, receipts, rate cards) — issued invoice numbers
-- already given to clients cannot be regenerated identically afterward.
-- ============================================================================
