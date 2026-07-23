-- ============================================================================
-- Migration 001 — CA compliance core (Phase 9)
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ✅ APPLIED (Phase 9) — predates the ⚠/✅ header convention adopted from
-- migration 004 onward; added retroactively during Phase 14.2's systemic
-- header audit (2026-07-23) for consistency, not because this file's status
-- was ever in doubt (Phase 9's objects have been in continuous live use).
-- This is the DELTA to apply to the running database. `supabase/ca-firm/
-- schema.sql` has already been updated in place to fold these changes into
-- the greenfield source of truth for any FUTURE fresh project — do not run
-- schema.sql again against this live project, run only this file.
--
-- Adds: client_registrations (multi-GSTIN/TAN/PF/ESI/PT per client),
-- audit-applicability flags on clients, compliance_types (platform catalog,
-- seeded with the Tier-1 core set), and structured period/provenance columns
-- on tasks (financial_year/period_type/period_key/source/category/
-- compliance_type_id) with the idempotency key for calendar-driven statutory
-- generation (Phase 10 builds the generation engine; this migration only
-- adds the schema it will write into).
--
-- Locked decision this migration encodes: statutory tasks are CALENDAR-
-- generated (Phase 10), not completion-chained. Completion-chaining (the
-- existing Phase 4 recurrence spawn in tasks/actions.ts) now explicitly
-- skips `source = 'statutory'` tasks — see the accompanying code change in
-- `src/app/(dashboard)/tasks/actions.ts` (changeStageCore), not part of this
-- SQL file.
--
-- Safety notes:
--   - Zero behavior change for existing rows: every new tasks/clients column
--     is nullable or has a DEFAULT: source DEFAULT 'manual', category
--     DEFAULT 'routine', is_audit_applicable DEFAULT false. Existing tasks
--     become source='manual' automatically and are UNCHANGED by the Phase 4
--     recurrence guard (which only skips 'statutory').
--   - No existing table's RLS is modified. New tables get RLS enabled with
--     policies written in the same statement batch — there is no window
--     where they're readable/writable without policies.
--   - Not written to be idempotent (no IF NOT EXISTS / OR REPLACE-safe
--     everywhere) — matches this project's existing migration style
--     (schema.sql itself has no such guards). Intended to run ONCE.
--   - Apply as a single transaction (wrap in BEGIN/COMMIT, or rely on the
--     Supabase SQL editor's implicit transaction) so a mid-script failure
--     leaves the live schema unchanged rather than half-migrated.
--
-- Rollback: see the very bottom of this file (commented out). Review before
-- running — dropping compliance_type_id cascades to tasks that reference it
-- only if ON DELETE RESTRICT is bypassed by dropping the column outright,
-- which is what the rollback does; any statutory tasks created between
-- apply and rollback would lose their compliance_type_id/period linkage.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. New enum types
-- ----------------------------------------------------------------------------
CREATE TYPE public.registration_type AS ENUM ('gstin', 'tan', 'pf', 'esi', 'pt', 'other');
CREATE TYPE public.gst_scheme AS ENUM ('regular', 'composition', 'qrmp');
CREATE TYPE public.compliance_periodicity AS ENUM ('monthly', 'quarterly', 'annual', 'event');

-- ----------------------------------------------------------------------------
-- 2. compliance_types — platform-wide catalog (create before altering tasks,
--    which will FK to it)
-- ----------------------------------------------------------------------------
CREATE TABLE public.compliance_types (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                        TEXT NOT NULL UNIQUE,
  name                        TEXT NOT NULL,
  department_code             TEXT NOT NULL,
  periodicity                 public.compliance_periodicity NOT NULL,
  due_day_rule                JSONB NOT NULL DEFAULT '{}'::jsonb,
  requires_registration_type  public.registration_type,
  requires_gst_scheme          public.gst_scheme,
  requires_flag                TEXT,
  applicable_business_types    TEXT[],
  is_active                    BOOLEAN NOT NULL DEFAULT true,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_compliance_types_department ON public.compliance_types(department_code);

CREATE TRIGGER on_compliance_type_updated BEFORE UPDATE ON public.compliance_types
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.compliance_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view active compliance types"
  ON public.compliance_types FOR SELECT TO authenticated
  USING (is_active OR public.is_super_admin());

CREATE POLICY "Super admins manage compliance types"
  ON public.compliance_types FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Seed: the Tier-1 core set from the feature-gap review (docs/ROADMAP.md §Appendix).
-- See schema.sql §10 for the due_day_rule convention comment.
INSERT INTO public.compliance_types
  (code, name, department_code, periodicity, due_day_rule, requires_registration_type, requires_gst_scheme, requires_flag, applicable_business_types) VALUES
  ('gstr1_monthly',        'GSTR-1 (Monthly)',           'gst',        'monthly',   '{"due_day": 11, "months_after_period_end": 1}', 'gstin', 'regular',     NULL, NULL),
  ('gstr1_qrmp',           'GSTR-1 (QRMP)',              'gst',        'quarterly', '{"due_day": 13, "months_after_period_end": 1}', 'gstin', 'qrmp',        NULL, NULL),
  ('gstr3b_monthly',       'GSTR-3B (Monthly)',          'gst',        'monthly',   '{"due_day": 20, "months_after_period_end": 1}', 'gstin', 'regular',     NULL, NULL),
  ('gstr3b_qrmp',          'GSTR-3B (QRMP)',             'gst',        'quarterly', '{"due_day": 22, "months_after_period_end": 1}', 'gstin', 'qrmp',        NULL, NULL),
  ('cmp08_quarterly',      'CMP-08 (Composition)',       'gst',        'quarterly', '{"due_day": 18, "months_after_period_end": 1}', 'gstin', 'composition', NULL, NULL),
  ('gstr4_annual',         'GSTR-4 (Composition Annual)','gst',        'annual',    '{"due_day": 30, "due_month": 6}',                'gstin', 'composition', NULL, NULL),
  ('gstr9_annual',         'GSTR-9 (Annual Return)',     'gst',        'annual',    '{"due_day": 31, "due_month": 12}',               'gstin', 'regular',     NULL, NULL),
  ('tds_payment_monthly',  'TDS Payment (Challan)',      'income_tax', 'monthly',   '{"due_day": 7, "months_after_period_end": 1}',   'tan',   NULL,          NULL, NULL),
  ('tds_24q_quarterly',    'TDS Return 24Q (Salary)',    'income_tax', 'quarterly', '{"due_day": 31, "months_after_period_end": 1}',  'tan',   NULL,          NULL, NULL),
  ('tds_26q_quarterly',    'TDS Return 26Q (Non-Salary)','income_tax', 'quarterly', '{"due_day": 31, "months_after_period_end": 1}',  'tan',   NULL,          NULL, NULL),
  ('advance_tax_quarterly','Advance Tax Installment',    'income_tax', 'quarterly', '{"due_day": 15, "note": "installment % differs by quarter"}', NULL, NULL, NULL, NULL),
  ('itr_non_audit_annual', 'ITR Filing (Non-Audit)',     'income_tax', 'annual',    '{"due_day": 31, "due_month": 7}',                NULL,    NULL,          NULL, NULL),
  ('itr_audit_annual',     'ITR Filing (Audit Cases)',   'income_tax', 'annual',    '{"due_day": 31, "due_month": 10}',               NULL,    NULL,          'is_audit_applicable', NULL),
  ('tax_audit_report_annual','Tax Audit Report (3CA/3CB-3CD)','audit', 'annual',    '{"due_day": 30, "due_month": 9}',                NULL,    NULL,          'is_audit_applicable', NULL),
  ('aoc4_annual',          'AOC-4 (Financial Statements)','roc',       'annual',    '{"due_day": 29, "due_month": 10}',               NULL,    NULL,          NULL, ARRAY['opc','pvt_ltd','public_ltd']),
  ('mgt7_annual',          'MGT-7 (Annual Return)',      'roc',        'annual',    '{"due_day": 28, "due_month": 11}',               NULL,    NULL,          NULL, ARRAY['opc','pvt_ltd','public_ltd']);

-- ----------------------------------------------------------------------------
-- 3. clients — audit-applicability flags
-- ----------------------------------------------------------------------------
ALTER TABLE public.clients
  ADD COLUMN is_audit_applicable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN audit_type TEXT CHECK (audit_type IS NULL OR audit_type IN (
    'tax_audit', 'statutory_audit', 'gst_audit', 'other'
  ));

-- ----------------------------------------------------------------------------
-- 4. client_registrations
-- ----------------------------------------------------------------------------
CREATE TABLE public.client_registrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id           UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type                public.registration_type NOT NULL,
  registration_number TEXT NOT NULL,
  state               TEXT,
  state_code          TEXT,
  gst_scheme          public.gst_scheme,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type <> 'gstin' OR registration_number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  CHECK (type <> 'tan'   OR registration_number ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  UNIQUE (client_id, registration_number)
);

CREATE INDEX idx_client_registrations_firm   ON public.client_registrations(firm_id);
CREATE INDEX idx_client_registrations_client ON public.client_registrations(client_id);
CREATE INDEX idx_client_registrations_type   ON public.client_registrations(type);

CREATE TRIGGER on_client_registration_updated BEFORE UPDATE ON public.client_registrations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.client_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view registrations of visible clients"
  ON public.client_registrations FOR SELECT TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.is_firm_staff()
    AND (
      public.get_user_role() = 'partner'
      OR public.has_permission('clients.view')
      OR public.employee_has_task_for_client(client_id)
    )
  );

CREATE POLICY "Client users can view their own client registrations"
  ON public.client_registrations FOR SELECT TO authenticated
  USING (client_id = public.get_user_client_id());

CREATE POLICY "Super admins can view all client registrations"
  ON public.client_registrations FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Client managers can create registrations"
  ON public.client_registrations FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

CREATE POLICY "Client managers can update registrations"
  ON public.client_registrations FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

CREATE POLICY "Client managers can delete registrations"
  ON public.client_registrations FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

-- ----------------------------------------------------------------------------
-- 5. tasks — structured period + provenance columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN financial_year TEXT CHECK (financial_year IS NULL OR financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  ADD COLUMN period_type TEXT CHECK (period_type IS NULL OR period_type IN ('monthly', 'quarterly', 'annual', 'event')),
  ADD COLUMN period_key TEXT,
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'recurring', 'statutory')),
  ADD COLUMN category TEXT NOT NULL DEFAULT 'routine' CHECK (category IN ('routine', 'notice')),
  ADD COLUMN compliance_type_id UUID REFERENCES public.compliance_types(id) ON DELETE RESTRICT;

CREATE INDEX idx_tasks_compliance_type ON public.tasks(compliance_type_id) WHERE compliance_type_id IS NOT NULL;
CREATE INDEX idx_tasks_source          ON public.tasks(source);

CREATE UNIQUE INDEX uq_statutory_task_per_period
  ON public.tasks (client_id, compliance_type_id, period_key)
  WHERE compliance_type_id IS NOT NULL AND period_key IS NOT NULL;

COMMIT;

-- ============================================================================
-- ROLLBACK (manual — review before running; NOT executed as part of this file)
-- Run only if this migration needs to be fully reverted. Written in reverse
-- dependency order. Any statutory tasks/registrations created after apply
-- will be destroyed by this (compliance_type_id/period data, and every
-- client_registrations row, are dropped with their columns/table).
-- ============================================================================
-- BEGIN;
-- DROP INDEX IF EXISTS public.uq_statutory_task_per_period;
-- DROP INDEX IF EXISTS public.idx_tasks_source;
-- DROP INDEX IF EXISTS public.idx_tasks_compliance_type;
-- ALTER TABLE public.tasks
--   DROP COLUMN IF EXISTS compliance_type_id,
--   DROP COLUMN IF EXISTS category,
--   DROP COLUMN IF EXISTS source,
--   DROP COLUMN IF EXISTS period_key,
--   DROP COLUMN IF EXISTS period_type,
--   DROP COLUMN IF EXISTS financial_year;
-- DROP TABLE IF EXISTS public.client_registrations;
-- ALTER TABLE public.clients
--   DROP COLUMN IF EXISTS audit_type,
--   DROP COLUMN IF EXISTS is_audit_applicable;
-- DROP TABLE IF EXISTS public.compliance_types;
-- DROP TYPE IF EXISTS public.compliance_periodicity;
-- DROP TYPE IF EXISTS public.gst_scheme;
-- DROP TYPE IF EXISTS public.registration_type;
-- COMMIT;
