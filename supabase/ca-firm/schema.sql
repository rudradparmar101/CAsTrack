-- ============================================================================
-- CA Firm Management SaaS — Greenfield Schema (Phase 1 draft)
-- Target: a FRESH Supabase project. Do NOT run against the DeadlineTracker DB.
--
-- Extends the DeadlineTracker multi-tenant pattern:
--   organizations -> firms, profiles keep the SECURITY DEFINER helper pattern,
--   every tenant table carries firm_id, RLS is the primary enforcement layer.
--
-- Roles:
--   super_admin  — platform owner; membership in platform_admins (NOT a
--                  profiles.role value, so no NULL-firm profiles exist)
--   partner      — firm owner; full access within their firm
--   employee     — scoped to (departments they belong to) UNION (work assigned
--                  to them), further gated by granular permissions
--   client_user  — a real login bound to exactly ONE clients row; sees only
--                  curated, client-safe data for that client
--
-- Provisioning note: profiles are created ONLY by the service-role client in
-- the auth callback (as in DeadlineTracker §5.2/5.3). There is deliberately
-- NO self-insert policy on profiles — see ROLES_AND_RLS.md §5, flag F3.
-- ============================================================================

-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================

-- Compliance stage machine (extends, does not replace, status/priority):
-- created -> assigned -> in_progress -> (waiting_client <->) -> under_review
--   -> completed -> archived
CREATE TYPE public.task_stage AS ENUM (
  'created', 'assigned', 'in_progress', 'waiting_client',
  'under_review', 'completed', 'archived'
);

CREATE TYPE public.task_priority AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE public.task_recurrence AS ENUM (
  'none', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'
);

CREATE TYPE public.doc_approval_status AS ENUM ('pending', 'approved', 'rejected');

-- Phase 9 — CA compliance core.
CREATE TYPE public.registration_type AS ENUM ('gstin', 'tan', 'pf', 'esi', 'pt', 'other');
CREATE TYPE public.gst_scheme AS ENUM ('regular', 'composition', 'qrmp');
CREATE TYPE public.compliance_periodicity AS ENUM ('monthly', 'quarterly', 'annual', 'event');

CREATE TYPE public.billing_cycle AS ENUM ('monthly', 'yearly');

CREATE TYPE public.subscription_status AS ENUM (
  'trialing', 'active', 'past_due', 'cancelled', 'expired'
);

-- ============================================================================
-- 2. PLATFORM-LEVEL TABLES (no firm_id — owned by the platform)
-- ============================================================================

-- Super admins. Bootstrap the first row from the SQL editor / service role;
-- after that, existing super admins can add more (see policies §9.1).
CREATE TABLE public.platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscription plans. Feature flags live in `features` JSONB so gating new
-- features never needs a schema change.
CREATE TABLE public.plans (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT NOT NULL UNIQUE,          -- 'starter' | 'professional' | ...
  name               TEXT NOT NULL,
  price_monthly_inr  INTEGER NOT NULL DEFAULT 0,    -- paise are overkill; whole rupees
  price_yearly_inr   INTEGER NOT NULL DEFAULT 0,
  max_users          INTEGER NOT NULL DEFAULT 5,    -- staff seats (partner + employees)
  max_clients        INTEGER,                       -- NULL = unlimited
  storage_gb         INTEGER NOT NULL DEFAULT 5,
  features           JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"client_portal": true, ...}
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permission catalog (platform-wide, seeded in §8). Keys are dot-namespaced.
CREATE TABLE public.permissions (
  key         TEXT PRIMARY KEY,        -- e.g. 'clients.view', 'billing.view'
  description TEXT NOT NULL,
  category    TEXT NOT NULL            -- 'clients' | 'tasks' | 'documents' | ...
);

-- Platform-wide default grants per role. Only 'employee' rows matter today:
-- partner short-circuits to TRUE in has_permission(), client_user to FALSE.
CREATE TABLE public.role_permissions (
  role           TEXT NOT NULL CHECK (role IN ('partner', 'employee', 'client_user')),
  permission_key TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  allowed        BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (role, permission_key)
);

-- Compliance type catalog (Phase 9). Platform-wide, like `permissions` above —
-- shared across every firm, not per-tenant. Drives calendar-driven statutory
-- task generation (Phase 10): for each active client whose registrations/
-- flags satisfy the applicability predicate, one task per period is upserted.
-- department_code is a loose reference to departments.code (TEXT, not an FK) —
-- departments are per-firm rows seeded from that same fixed code set, so a
-- code match is resolved to the firm's own department at generation time.
-- No hard delete: retire a type via is_active, mirroring clients/departments.
CREATE TABLE public.compliance_types (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                        TEXT NOT NULL UNIQUE,     -- 'gstr3b_monthly', 'tds_24q', ...
  name                        TEXT NOT NULL,
  department_code             TEXT NOT NULL,            -- 'gst' | 'income_tax' | 'audit' | 'roc' | 'accounting' | 'payroll'
  periodicity                 public.compliance_periodicity NOT NULL,
  -- Structured due-date rule interpreted by the Phase 10 generation engine.
  -- Convention: {"due_day": 20, "months_after_period_end": 1} for monthly/
  -- quarterly types due N months after the period closes; {"due_day": 31,
  -- "due_month": 7} for a fixed calendar month/day annual due date. Statutory
  -- due-date shifts (govt extensions) are NOT modeled here — see clients.notes.
  due_day_rule                JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Applicability predicate vs. a client's registrations/flags — ALL non-null
  -- conditions must hold. NULL in any column = that condition doesn't apply.
  requires_registration_type  public.registration_type,          -- e.g. 'gstin'
  requires_gst_scheme          public.gst_scheme,                 -- narrows within gstin, e.g. 'qrmp'
  requires_flag                TEXT,                              -- e.g. 'is_audit_applicable' (a clients boolean column)
  applicable_business_types    TEXT[],                            -- NULL = all business types
  is_active                    BOOLEAN NOT NULL DEFAULT true,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. FIRM & MEMBERSHIP TABLES
-- ============================================================================

-- Firms (rename of organizations). CA-specific identity fields added.
CREATE TABLE public.firms (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  invite_code         TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(6), 'hex'),
  frn                 TEXT,             -- ICAI Firm Registration Number
  gstin               TEXT CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan                 TEXT CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  contact_email       TEXT,
  contact_phone       TEXT,
  address             JSONB,            -- single office address; firms rarely need N
  storage_used_bytes  BIGINT NOT NULL DEFAULT 0,  -- maintained by document_versions triggers
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Departments. Seeded with the 6 standard CA practice areas per firm by
-- trigger (§7.3); partners can add custom ones.
CREATE TABLE public.departments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,             -- 'gst' | 'income_tax' | 'audit' | 'roc' | 'accounting' | 'payroll' | custom
  name       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (firm_id, code)
);

-- Profiles. role has 3 values; super_admin lives in platform_admins instead.
-- client_id is added by ALTER after clients exists (circular FK ordering).
CREATE TABLE public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  firm_id     UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('partner', 'employee', 'client_user')),
  designation TEXT,                     -- 'Article Assistant', 'Senior Associate', ...
  phone       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Employees belong to one or more departments (replaces DeadlineTracker teams).
CREATE TABLE public.department_members (
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, user_id)
);

-- Per-user permission overrides on top of role_permissions defaults.
-- granted=true  -> grant even if the role default is false
-- granted=false -> revoke even if the role default is true
CREATE TABLE public.user_permissions (
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  granted        BOOLEAN NOT NULL,
  granted_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_key)
);

-- ============================================================================
-- 4. BILLING TABLES
-- ============================================================================

-- One live subscription per firm (enforced by partial unique index below).
-- Writes happen via super_admin or the service-role client (payment webhooks).
CREATE TABLE public.firm_subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                  UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  plan_id                  UUID NOT NULL REFERENCES public.plans(id),
  billing_cycle            public.billing_cycle NOT NULL DEFAULT 'monthly',
  status                   public.subscription_status NOT NULL DEFAULT 'trialing',
  current_period_start     TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end       TIMESTAMPTZ NOT NULL,
  trial_ends_at            TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  payment_provider         TEXT,        -- 'razorpay' | 'stripe' | ...
  provider_subscription_id TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_one_live_subscription_per_firm
  ON public.firm_subscriptions (firm_id)
  WHERE status IN ('trialing', 'active', 'past_due');

CREATE TABLE public.subscription_invoices (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id              UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  subscription_id      UUID NOT NULL REFERENCES public.firm_subscriptions(id) ON DELETE CASCADE,
  amount_inr           INTEGER NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('due', 'paid', 'failed', 'refunded')) DEFAULT 'due',
  period_start         TIMESTAMPTZ NOT NULL,
  period_end           TIMESTAMPTZ NOT NULL,
  provider_invoice_id  TEXT,
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. CLIENT TABLES
-- ============================================================================

-- Clients of a firm. NO hard delete in policy layer — statutory records must
-- survive; deactivate via is_active instead (see ROLES_AND_RLS.md, flag F6).
CREATE TABLE public.clients (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id               UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,             -- legal name
  trade_name            TEXT,
  business_type         TEXT NOT NULL CHECK (business_type IN (
                          'individual', 'huf', 'proprietorship', 'partnership', 'llp',
                          'opc', 'pvt_ltd', 'public_ltd', 'trust', 'society',
                          'aop_boi', 'government', 'other'
                        )) DEFAULT 'individual',
  -- Statutory identifiers. Regex CHECKs validate format only, not existence.
  gstin                 TEXT CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan                   TEXT CHECK (pan  IS NULL OR pan  ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  tan                   TEXT CHECK (tan  IS NULL OR tan  ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  cin                   TEXT CHECK (cin  IS NULL OR cin  ~ '^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$'),
  incorporation_date    DATE,
  gst_registration_date DATE,
  -- Audit applicability (Phase 9): drives whether a tax-audit compliance_types
  -- row generates a task for this client, and (via requires_flag / due_day_rule
  -- interpretation in Phase 10) shifts the ITR due date to the audit deadline.
  is_audit_applicable   BOOLEAN NOT NULL DEFAULT false,
  audit_type            TEXT CHECK (audit_type IS NULL OR audit_type IN (
                          'tax_audit', 'statutory_audit', 'gst_audit', 'other'
                        )),
  email                 TEXT,
  phone                 TEXT,
  notes                 TEXT,                      -- internal; never exposed to client_user UI
  -- Phase 12: "fees pending — hold work" advisory flag. Banner on tasks and
  -- the filing-status grid; does not block any action. clients.manage-gated.
  fees_hold             BOOLEAN NOT NULL DEFAULT false,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_by            UUID NOT NULL REFERENCES public.profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Now the circular FK: a client_user profile is bound to exactly one client.
ALTER TABLE public.profiles
  ADD COLUMN client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  ADD CONSTRAINT profiles_client_binding
    CHECK ((role = 'client_user') = (client_id IS NOT NULL));

CREATE TABLE public.client_addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('registered', 'business', 'branch', 'warehouse', 'other')) DEFAULT 'registered',
  line1       TEXT NOT NULL,
  line2       TEXT,
  city        TEXT NOT NULL,
  state       TEXT NOT NULL,
  state_code  TEXT,                     -- GST state code, e.g. '27'
  pincode     TEXT CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$'),
  country     TEXT NOT NULL DEFAULT 'India',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.client_authorized_persons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  designation TEXT,                     -- 'Director', 'Partner', 'Karta', ...
  pan         TEXT CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  din         TEXT CHECK (din IS NULL OR din ~ '^[0-9]{8}$'),
  email       TEXT,
  phone       TEXT,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Statutory registrations (Phase 9): a client can hold several — multiple
-- GSTINs (one per state), a TAN, PF/ESI/PT codes. Replaces the earlier
-- single gstin/tan/pan columns on `clients` as the applicability source for
-- compliance_types generation; those columns stay for the client's PRIMARY
-- identifiers and search, this table is the full per-registration list.
CREATE TABLE public.client_registrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id           UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type                public.registration_type NOT NULL,
  registration_number TEXT NOT NULL,
  state               TEXT,             -- GST is state-wise; NULL for non-gstin types
  state_code          TEXT,             -- GST state code, e.g. '27' (mirrors client_addresses)
  gst_scheme          public.gst_scheme, -- only meaningful when type = 'gstin'
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type <> 'gstin' OR registration_number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  CHECK (type <> 'tan'   OR registration_number ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  UNIQUE (client_id, registration_number)
);

-- Portal invitations: how a client_user gets bound to exactly one client.
-- Signup consumes the token via lookup_client_invitation() (§6) and the
-- service-role client creates the profile with role='client_user' + client_id.
CREATE TABLE public.client_portal_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  token       TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  invited_by  UUID NOT NULL REFERENCES public.profiles(id),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5B. CLIENT BILLING & RECEIVABLES (Phase 12 / migration 004)
-- Firm→client billing — distinct from §4's SaaS-level billing (us→firm).
-- Key legal properties, DB-enforced (triggers in §9.6):
--   - GAPLESS per-firm-per-FY invoice numbering: numbers assigned only at
--     issue time by issue_firm_invoice() from firm_invoice_counters (drafts
--     carry no number; a failed issue rolls the counter back atomically).
--   - Issued invoices are IMMUTABLE — cancel + reissue, never edit.
--   - TDS u/s 194J: tds_expected on the invoice, actual tds_amount on
--     receipts; settlement counts TDS as money received, so the outstanding
--     ledger stays right for corporate clients.
-- ============================================================================

-- Firm rate card (client_id IS NULL) + per-client overrides, per service.
-- Feeds invoice-line defaults; invoices never reference it (lines snapshot).
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

-- GST-compliant firm→client invoices (SAC 9982 default per line;
-- CGST/SGST vs IGST by place of supply).
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

-- Manual payment entry (Razorpay is Phase 15 by decision). invoice_id is
-- nullable: NULL = "on-account" receipt, not yet allocated to any invoice
-- (migration 006, Phase 12 review finding 2 — originally NOT NULL and
-- deferred pending pilot demand; reflected in client_outstanding as
-- on_account_credit, netted into outstanding). A single cheque covering
-- several invoices is entered as several rows sharing reference_no.
-- Every mutation is logged by the log_receipt_change() trigger (§9.6) into
-- receipt_history — receipts stay billing.manage-mutable (not made
-- immutable; see migration 006's header for why), but every INSERT/UPDATE/
-- DELETE now leaves an audit trail (migration 006, review finding 3).
CREATE TABLE public.receipts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  invoice_id   UUID REFERENCES public.firm_invoices(id) ON DELETE RESTRICT, -- NULL = on-account (migration 006)
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

-- Trigger-only audit trail for every receipts mutation (migration 006,
-- review finding 3). Same pattern as task_stage_history: RLS enabled, no
-- INSERT/UPDATE/DELETE policy at all (direct writes denied by RLS
-- default-deny), the SECURITY DEFINER trigger function (§9.6) is the only
-- writer. Not FK'd to receipts — a DELETE's history row must outlive the
-- receipt it describes.
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

-- ============================================================================
-- 6. WORK TABLES (tasks, documents, comments, activity, notifications)
-- ============================================================================

-- Tasks. Extends the DeadlineTracker model: status/priority/recurrence/
-- parent_task_id/reviewer_id survive; `stage` is the new compliance pipeline;
-- `status` is now DERIVED from stage by trigger (kept for dashboards and to
-- reuse existing aggregate queries). assigned_team_id is replaced by
-- department_id (flag F5).
CREATE TABLE public.tasks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id          UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT, -- statutory: never cascade work away
  department_id      UUID NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  stage              public.task_stage NOT NULL DEFAULT 'created',
  status             TEXT NOT NULL CHECK (status IN ('pending', 'completed')) DEFAULT 'pending', -- derived; do not set directly
  priority           public.task_priority NOT NULL DEFAULT 'medium',
  recurring_rule     public.task_recurrence NOT NULL DEFAULT 'none',
  parent_task_id     UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  due_date           DATE NOT NULL,               -- internal working deadline
  statutory_due_date DATE,                        -- government deadline, if different
  period_label       TEXT,                        -- 'FY 2025-26', 'May 2026 GSTR-3B', ... (free-text, kept for manual/internal tasks)
  -- Structured period fields (Phase 9) — statutory tasks use these instead of
  -- (or alongside) period_label so the filing-status grid can group by period.
  financial_year     TEXT CHECK (financial_year IS NULL OR financial_year ~ '^[0-9]{4}-[0-9]{2}$'), -- '2026-27'
  period_type        TEXT CHECK (period_type IS NULL OR period_type IN ('monthly', 'quarterly', 'annual', 'event')),
  period_key         TEXT,                        -- 'YYYY-MM' | 'YYYY-QN' (FY-aligned) | financial_year | event label
  -- Provenance + classification (Phase 9).
  source             TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'recurring', 'statutory')),
  category           TEXT NOT NULL DEFAULT 'routine' CHECK (category IN ('routine', 'notice')),
  compliance_type_id UUID REFERENCES public.compliance_types(id) ON DELETE RESTRICT,
  assigned_to        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewer_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  visible_to_client  BOOLEAN NOT NULL DEFAULT true, -- curated portal: flip off for internal tasks
  -- Per-task copy of the originating template's checklist_items (Phase 11) —
  -- same {id, text, completed} shape as task_templates.checklist_items.
  -- Copied once at task creation (not synced afterward); staff toggle
  -- 'completed' (rendered as received/pending); covered by the existing
  -- tasks SELECT/UPDATE RLS policies, no new policy needed.
  checklist_items    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Structured filing outcome (Phase 12.5 / migration 007) — promoted out of
  -- task_activities (staff-only readable) for the same reason checklist_items
  -- was: the filing-status grid and the client portal both need to read
  -- this, and only a plain column on tasks is covered by the existing
  -- SELECT/UPDATE RLS. task_activities keeps logging filing_outcome_recorded
  -- as the audit trail; these columns are the display source of truth.
  arn                TEXT,
  filed_date         DATE,
  created_by         UUID NOT NULL REFERENCES public.profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable stage-transition audit; written ONLY by trigger (§7.4) — RLS has
-- no INSERT policy, so direct inserts are denied. Staff-only reading.
CREATE TABLE public.task_stage_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  task_id    UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  from_stage public.task_stage,
  to_stage   public.task_stage NOT NULL,
  changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comments. visible_to_client defaults FALSE: internal remarks stay internal
-- unless a staff member deliberately publishes one. client_user comments are
-- forced visible_to_client=true by their INSERT policy (they can't whisper
-- to a hidden thread, and staff always see everything on the task).
CREATE TABLE public.task_comments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id           UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  task_id           UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  content           TEXT NOT NULL,
  mentions          UUID[] NOT NULL DEFAULT '{}',
  visible_to_client BOOLEAN NOT NULL DEFAULT false,
  created_by        UUID NOT NULL REFERENCES public.profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Documents (logical file + approval state). Replaces task_attachments
-- (flag F4). client_id is denormalized NOT NULL so client-portal RLS never
-- depends on task existence; task_id is SET NULL so statutory documents
-- survive task deletion.
CREATE TABLE public.documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id           UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  task_id           UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  doc_type          TEXT,               -- 'gst_return', 'bank_statement', 'itr_ack', free-form
  approval_status   public.doc_approval_status NOT NULL DEFAULT 'pending',
  reviewed_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  current_version   INTEGER NOT NULL DEFAULT 1,   -- bumped by trigger (§7.5)
  visible_to_client BOOLEAN NOT NULL DEFAULT true, -- staff can keep workpapers internal
  uploaded_by       UUID NOT NULL REFERENCES public.profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Version history: every physical file ever uploaded for a document.
-- Uploading a new version resets the parent's approval_status to 'pending'
-- via trigger — a re-uploaded file must be re-approved.
CREATE TABLE public.document_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id        UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  document_id    UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  file_name      TEXT NOT NULL,
  file_path      TEXT NOT NULL,         -- storage: {firm_id}/{client_id}/{document_id}/{uuid}.{ext}
  file_type      TEXT,
  file_size      BIGINT NOT NULL DEFAULT 0,
  note           TEXT,
  uploaded_by    UUID NOT NULL REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);

-- Immutable audit log (same shape as DeadlineTracker's task_activities).
-- Staff-only reading; clients get their curated view from tasks/documents.
CREATE TABLE public.task_activities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id    UUID NOT NULL REFERENCES public.profiles(id),
  action_type TEXT NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notifications. Same shape as DeadlineTracker; INSERT is now restricted to
-- staff + the create_notification() SECURITY DEFINER helper (flag F7).
CREATE TABLE public.notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id        UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  message        TEXT NOT NULL,
  reference_id   UUID,
  reference_type TEXT,
  is_read        BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Task templates (kept from DeadlineTracker; now department-aware so a GST
-- template can pre-select the GST department).
CREATE TABLE public.task_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  department_id      UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  default_priority   public.task_priority NOT NULL DEFAULT 'medium',
  recurring_rule     public.task_recurrence NOT NULL DEFAULT 'none',
  checklist_items    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by         UUID NOT NULL REFERENCES public.profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UDIN register (Phase 12.5 / migration 007) — firm-side record of a UDIN a
-- signing CA member generated on ICAI's own portal for a certified document;
-- capture only, never a generator/validator against ICAI. See migration
-- 007's header for the full column-by-column design rationale (udin format,
-- why document_type stays free text, why signing_partner_id isn't role-
-- restricted at the DB layer, why there's no soft-delete column).
CREATE TABLE public.udin_register (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id          UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  udin               TEXT NOT NULL CHECK (udin ~ '^[0-9A-Z]{18}$'), -- ICAI UDINs are always 18 alphanumeric chars; sub-structure not validated
  document_type      TEXT NOT NULL CHECK (length(trim(document_type)) > 0), -- free text: firm's own document/certificate description
  generated_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  signing_partner_id UUID NOT NULL REFERENCES public.profiles(id), -- the CA member who generated the UDIN; app defaults the picker to partners, not DB-enforced
  task_id            UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  document_id        UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  notes              TEXT,
  created_by         UUID NOT NULL REFERENCES public.profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (firm_id, udin) -- scoped to firm, not global, so one firm's insert can't leak whether another firm holds a given UDIN
);

-- DSC (Digital Signature Certificate) register (Phase 13.2 / migration 008) —
-- firm-side record of physical USB tokens held on behalf of client
-- signatories. Belongs to a PERSON (holder_name/holder_designation), not
-- necessarily the client entity — one client can have several, one per
-- authorized signatory. NO credential columns anywhere (PIN/password) — see
-- migration 008's header for the full column-by-column rationale, why reads
-- and movements are gated on the existing clients.view permission rather
-- than udin_register's reports.view, and why there's no DELETE policy at
-- all (stricter than udin_register, mirrors clients/departments instead).
CREATE TABLE public.dsc_register (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                           UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id                         UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  holder_name                       TEXT NOT NULL CHECK (length(trim(holder_name)) > 0), -- the signatory the token belongs to, not the client entity
  holder_designation                TEXT, -- 'Director' | 'Proprietor' | 'Partner' | ... free text
  issuing_authority                 TEXT NOT NULL CHECK (length(trim(issuing_authority)) > 0), -- eMudhra/Sify/nCode/Capricorn/... free text, same reasoning as udin_register.document_type
  dsc_class                         TEXT NOT NULL CHECK (length(trim(dsc_class)) > 0), -- free text: CCA's own class taxonomy has changed over time (Class 2 phased out 2021)
  serial_number                     TEXT NOT NULL CHECK (length(trim(serial_number)) > 0), -- printed on the token/certificate — NOT a secret
  issued_on                         DATE,
  expires_on                        DATE NOT NULL,
  current_custodian_id              UUID REFERENCES public.profiles(id) ON DELETE SET NULL, -- NULL = not checked out to staff (may be with the client — see physical_storage_location)
  physical_storage_location         TEXT,
  is_active                         BOOLEAN NOT NULL DEFAULT true, -- no hard delete, mirrors clients/departments/compliance_types/fee_masters
  notes                             TEXT,
  last_expiry_alert_tier            TEXT, -- idempotency for the /api/cron/send-reminders expiry sweep; no new table
  last_expiry_alert_sent_for_expiry DATE, -- paired with the tier so a renewal (expires_on change) naturally re-arms future alerts
  created_by                        UUID NOT NULL REFERENCES public.profiles(id),
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (firm_id, issuing_authority, serial_number) -- serials are only unique within one authority's own numbering scheme
);

-- Append-only custody trail, mirrors task_stage_history's shape
-- (from_stage/to_stage -> from_custodian_id/to_custodian_id, changed_by ->
-- recorded_by) and its no-INSERT-policy enforcement (§11.25). Unlike
-- task_stage_history, `note` IS writable here — see migration 008's header
-- for how record_dsc_movement() (§8) threads a note through without
-- reproducing task_stage_history.note's known unwritable-from-the-app gap.
CREATE TABLE public.dsc_custody_movements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id           UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  dsc_id            UUID NOT NULL REFERENCES public.dsc_register(id) ON DELETE CASCADE,
  movement_type     TEXT NOT NULL CHECK (movement_type IN ('check_out', 'check_in')),
  from_custodian_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  to_custodian_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  note              TEXT,
  recorded_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 7. INDEXES
-- ============================================================================

CREATE INDEX idx_profiles_firm            ON public.profiles(firm_id);
CREATE INDEX idx_profiles_client          ON public.profiles(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_departments_firm         ON public.departments(firm_id);
CREATE INDEX idx_dept_members_user        ON public.department_members(user_id);
CREATE INDEX idx_user_permissions_user    ON public.user_permissions(user_id);
CREATE INDEX idx_subscriptions_firm       ON public.firm_subscriptions(firm_id);
CREATE INDEX idx_invoices_firm            ON public.subscription_invoices(firm_id);
CREATE INDEX idx_clients_firm             ON public.clients(firm_id);
CREATE INDEX idx_client_addresses_client  ON public.client_addresses(client_id);
CREATE INDEX idx_client_auth_persons_client ON public.client_authorized_persons(client_id);
CREATE INDEX idx_client_registrations_firm   ON public.client_registrations(firm_id);
CREATE INDEX idx_client_registrations_client ON public.client_registrations(client_id);
CREATE INDEX idx_client_registrations_type   ON public.client_registrations(type);
CREATE INDEX idx_compliance_types_department ON public.compliance_types(department_code);
CREATE INDEX idx_portal_invites_client    ON public.client_portal_invitations(client_id);
CREATE INDEX idx_portal_invites_token     ON public.client_portal_invitations(token);
CREATE INDEX idx_tasks_firm               ON public.tasks(firm_id);
CREATE INDEX idx_tasks_client             ON public.tasks(client_id);
CREATE INDEX idx_tasks_department         ON public.tasks(department_id);
CREATE INDEX idx_tasks_assigned           ON public.tasks(assigned_to);
CREATE INDEX idx_tasks_stage              ON public.tasks(stage);
CREATE INDEX idx_tasks_due_date           ON public.tasks(due_date);
CREATE INDEX idx_tasks_parent             ON public.tasks(parent_task_id);
CREATE INDEX idx_tasks_compliance_type    ON public.tasks(compliance_type_id) WHERE compliance_type_id IS NOT NULL;
CREATE INDEX idx_tasks_source             ON public.tasks(source);
-- One statutory task per client per compliance type per period — the
-- idempotency key the Phase 10 generation engine upserts against.
CREATE UNIQUE INDEX uq_statutory_task_per_period
  ON public.tasks (client_id, compliance_type_id, period_key)
  WHERE compliance_type_id IS NOT NULL AND period_key IS NOT NULL;
CREATE INDEX idx_stage_history_task       ON public.task_stage_history(task_id);
CREATE INDEX idx_comments_task            ON public.task_comments(task_id);
CREATE INDEX idx_documents_firm           ON public.documents(firm_id);
CREATE INDEX idx_documents_client         ON public.documents(client_id);
CREATE INDEX idx_documents_task           ON public.documents(task_id);
CREATE INDEX idx_documents_approval       ON public.documents(approval_status);
CREATE INDEX idx_doc_versions_document    ON public.document_versions(document_id);
CREATE INDEX idx_activities_task          ON public.task_activities(task_id);
CREATE INDEX idx_notifications_user       ON public.notifications(user_id, is_read);
CREATE INDEX idx_templates_firm           ON public.task_templates(firm_id);
CREATE INDEX idx_udin_register_firm       ON public.udin_register(firm_id);
CREATE INDEX idx_udin_register_client     ON public.udin_register(client_id);
CREATE INDEX idx_udin_register_task       ON public.udin_register(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_udin_register_document   ON public.udin_register(document_id) WHERE document_id IS NOT NULL;

CREATE INDEX idx_dsc_register_firm       ON public.dsc_register(firm_id);
CREATE INDEX idx_dsc_register_client     ON public.dsc_register(client_id);
CREATE INDEX idx_dsc_register_custodian  ON public.dsc_register(current_custodian_id) WHERE current_custodian_id IS NOT NULL;
CREATE INDEX idx_dsc_register_expires_on ON public.dsc_register(expires_on) WHERE is_active;
CREATE INDEX idx_dsc_movements_firm      ON public.dsc_custody_movements(firm_id);
CREATE INDEX idx_dsc_movements_dsc       ON public.dsc_custody_movements(dsc_id);

-- ============================================================================
-- 8. HELPER FUNCTIONS
-- All SECURITY DEFINER + STABLE, same pattern as DeadlineTracker's
-- get_user_org_id()/get_user_role(): they read profiles WITHOUT triggering
-- profiles' own RLS, which is what prevents policy recursion.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_firm_id()
RETURNS UUID AS $$
  SELECT firm_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- NULL for staff; the bound client for client_users.
CREATE OR REPLACE FUNCTION public.get_user_client_id()
RETURNS UUID AS $$
  SELECT client_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_firm_staff()
RETURNS BOOLEAN AS $$
  SELECT public.get_user_role() IN ('partner', 'employee');
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_user_department_ids()
RETURNS UUID[] AS $$
  SELECT COALESCE(array_agg(department_id), '{}')
  FROM public.department_members WHERE user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Granular permission resolution:
--   super_admin -> true; partner -> true; client_user -> false;
--   employee -> per-user override, else role default, else false.
-- billing.manage implies billing.view (migration 006, Phase 12 review
-- finding 4): issue_firm_invoice() is SECURITY INVOKER and opens with
-- SELECT ... FOR UPDATE, which needs the firm_invoices SELECT policy
-- (billing.view). Checked BEFORE the user_permissions override lookup below
-- so an explicit billing.view=false override cannot defeat a billing.manage
-- grant — this is a functional dependency (the RPC literally cannot work
-- without it), not a revocable policy preference.
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

-- Staff task visibility: partner sees all firm tasks; employee sees
-- (assigned to them) UNION (in one of their departments).
CREATE OR REPLACE FUNCTION public.staff_can_access_task(p_task_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = p_task_id
      AND t.firm_id = public.get_user_firm_id()
      AND (
        public.get_user_role() = 'partner'
        OR t.assigned_to = auth.uid()
        OR t.department_id = ANY (public.get_user_department_ids())
      )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Client-portal task visibility (the curated view): the task belongs to THE
-- ONE client this user is bound to, is flagged client-visible, and is past
-- the internal 'created' stage / not archived.
CREATE OR REPLACE FUNCTION public.client_can_access_task(p_task_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = p_task_id
      AND t.client_id = public.get_user_client_id()   -- NULL for staff -> false
      AND t.visible_to_client
      AND t.stage NOT IN ('created', 'archived')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Employees without clients.view still need the client rows their own tasks
-- reference (to render a task's client name).
CREATE OR REPLACE FUNCTION public.employee_has_task_for_client(p_client_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.client_id = p_client_id
      AND (t.assigned_to = auth.uid()
           OR t.department_id = ANY (public.get_user_department_ids()))
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Shared document visibility (used by document_versions policies so the
-- version rows always inherit exactly the parent document's rules).
CREATE OR REPLACE FUNCTION public.can_access_document(p_document_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = p_document_id
      AND (
        -- staff path
        (public.is_firm_staff()
         AND d.firm_id = public.get_user_firm_id()
         AND (
           public.get_user_role() = 'partner'
           OR (d.task_id IS NOT NULL AND public.staff_can_access_task(d.task_id))
           OR (d.task_id IS NULL AND (public.has_permission('clients.view')
                                      OR public.employee_has_task_for_client(d.client_id)))
         ))
        OR
        -- client path (curated): own client + client-visible + (own upload OR
        -- a decided outcome — approved so they can see the file, rejected so
        -- they can see the reason and correct it; pending staff drafts stay hidden)
        (d.client_id = public.get_user_client_id()
         AND d.visible_to_client
         AND (d.uploaded_by = auth.uid() OR d.approval_status IN ('approved', 'rejected')))
      )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Replaces DeadlineTracker's `USING (true)` SELECT-any-org policy (flag F2):
-- signup validates an invite code without being able to enumerate firms.
CREATE OR REPLACE FUNCTION public.lookup_firm_by_invite_code(p_code TEXT)
RETURNS TABLE (firm_id UUID, firm_name TEXT) AS $$
  SELECT id, name FROM public.firms WHERE invite_code = p_code;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.lookup_client_invitation(p_token TEXT)
RETURNS TABLE (invitation_id UUID, firm_id UUID, client_id UUID, email TEXT) AS $$
  SELECT id, firm_id, client_id, email
  FROM public.client_portal_invitations
  WHERE token = p_token AND accepted_at IS NULL AND expires_at > now();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Cross-role notification creation (e.g. a client upload notifying the
-- assignee) without a permissive INSERT policy. Validates same-firm.
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id UUID, p_type TEXT, p_title TEXT, p_message TEXT,
  p_reference_id UUID DEFAULT NULL, p_reference_type TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_target_firm UUID;
BEGIN
  SELECT firm_id INTO v_target_firm FROM public.profiles WHERE id = p_user_id;
  IF v_target_firm IS NULL OR v_target_firm IS DISTINCT FROM public.get_user_firm_id() THEN
    RAISE EXCEPTION 'Cannot notify a user outside your firm';
  END IF;
  INSERT INTO public.notifications (firm_id, user_id, type, title, message, reference_id, reference_type)
  VALUES (v_target_firm, p_user_id, p_type, p_title, p_message, p_reference_id, p_reference_type);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Portal "who is my contact" (Phase 11) — a narrow SECURITY DEFINER RPC
-- instead of a widened profiles SELECT policy (which would let clients
-- enumerate all firm staff). Only the client_user bound to p_client_id gets
-- a result; resolves to the assignee of their most recently touched
-- visible, non-archived task, falling back to the firm's earliest active
-- partner.
CREATE OR REPLACE FUNCTION public.get_client_assigned_contact(p_client_id UUID)
RETURNS TABLE(name TEXT, email TEXT, phone TEXT, designation TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contact_id UUID;
  v_firm_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'client_user' AND client_id = p_client_id
  ) THEN
    RETURN;
  END IF;

  SELECT t.assigned_to INTO v_contact_id
  FROM public.tasks t
  WHERE t.client_id = p_client_id
    AND t.visible_to_client = true
    AND t.stage <> 'archived'
    AND t.assigned_to IS NOT NULL
  ORDER BY t.updated_at DESC
  LIMIT 1;

  IF v_contact_id IS NULL THEN
    SELECT c.firm_id INTO v_firm_id FROM public.clients c WHERE c.id = p_client_id;
    SELECT p.id INTO v_contact_id
    FROM public.profiles p
    WHERE p.firm_id = v_firm_id AND p.role = 'partner' AND p.is_active = true
    ORDER BY p.created_at ASC
    LIMIT 1;
  END IF;

  RETURN QUERY
    SELECT p.name, p.email, p.phone, p.designation
    FROM public.profiles p
    WHERE p.id = v_contact_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_assigned_contact(UUID) TO authenticated;

-- Same-firm membership check used by user_permissions policies.
CREATE OR REPLACE FUNCTION public.profile_in_my_firm(p_user_id UUID, p_role TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id
      AND firm_id = public.get_user_firm_id()
      AND (p_role IS NULL OR role = p_role)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Plan/feature gating helpers (enforced in server actions; DB triggers for
-- hard limits are deliberately deferred — see ROLES_AND_RLS.md §7).
CREATE OR REPLACE FUNCTION public.get_firm_plan(p_firm_id UUID)
RETURNS public.plans AS $$
  SELECT p.* FROM public.plans p
  JOIN public.firm_subscriptions s ON s.plan_id = p.id
  WHERE s.firm_id = p_firm_id AND s.status IN ('trialing', 'active', 'past_due')
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.firm_has_feature(p_flag TEXT)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    ((public.get_firm_plan(public.get_user_firm_id())).features ->> p_flag)::boolean,
    false
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- 9. TRIGGERS
-- ============================================================================

-- 9.1 updated_at maintenance (same as DeadlineTracker)
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_firm_updated          BEFORE UPDATE ON public.firms                 FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_profile_updated       BEFORE UPDATE ON public.profiles              FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_plan_updated          BEFORE UPDATE ON public.plans                 FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_subscription_updated  BEFORE UPDATE ON public.firm_subscriptions    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_client_updated        BEFORE UPDATE ON public.clients               FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_client_address_updated BEFORE UPDATE ON public.client_addresses     FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_client_person_updated  BEFORE UPDATE ON public.client_authorized_persons FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_client_registration_updated BEFORE UPDATE ON public.client_registrations FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_compliance_type_updated BEFORE UPDATE ON public.compliance_types      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_task_updated          BEFORE UPDATE ON public.tasks                 FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_comment_updated       BEFORE UPDATE ON public.task_comments         FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_document_updated      BEFORE UPDATE ON public.documents             FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_template_updated      BEFORE UPDATE ON public.task_templates        FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_fee_master_updated    BEFORE UPDATE ON public.fee_masters           FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_firm_invoice_updated  BEFORE UPDATE ON public.firm_invoices         FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_receipt_updated       BEFORE UPDATE ON public.receipts              FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_udin_register_updated BEFORE UPDATE ON public.udin_register         FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_dsc_register_updated  BEFORE UPDATE ON public.dsc_register           FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 9.2 Profile privilege lockdown (fixes flag F1: the DeadlineTracker
-- "update own profile" policy would otherwise let a user self-escalate role,
-- since Postgres RLS cannot restrict WHICH columns an UPDATE touches).
-- Only a partner of the same firm (or super admin / service role) may change
-- role, firm_id, or client_id.
CREATE OR REPLACE FUNCTION public.enforce_profile_protected_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role      IS DISTINCT FROM OLD.role
     OR NEW.firm_id   IS DISTINCT FROM OLD.firm_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;          -- service role / SQL editor
    IF public.is_super_admin() THEN RETURN NEW; END IF;
    IF public.get_user_role() = 'partner'
       AND OLD.firm_id = public.get_user_firm_id()
       AND auth.uid() <> OLD.id THEN                        -- partner can't demote self silently
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Not allowed to change role, firm, or client binding';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER guard_profile_protected_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_protected_fields();

-- 9.3 Seed the six standard CA departments for every new firm.
CREATE OR REPLACE FUNCTION public.seed_default_departments()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.departments (firm_id, code, name) VALUES
    (NEW.id, 'gst',        'GST'),
    (NEW.id, 'income_tax', 'Income Tax'),
    (NEW.id, 'audit',      'Audit'),
    (NEW.id, 'roc',        'ROC'),
    (NEW.id, 'accounting', 'Accounting'),
    (NEW.id, 'payroll',    'Payroll');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_firm_created_seed_departments
  AFTER INSERT ON public.firms
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_departments();

-- 9.4 Stage machine enforcement + status derivation + history logging.
-- Rules (partner and service role may force any transition):
--   created -> assigned
--   assigned -> in_progress
--   in_progress -> waiting_client | under_review
--                | completed (only when no reviewer is set)
--   waiting_client -> in_progress
--   under_review -> completed | in_progress (reviewer sends it back)
--   completed -> archived
CREATE OR REPLACE FUNCTION public.handle_task_stage()
RETURNS TRIGGER AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  -- Auto-advance created -> assigned when an assignee lands on the task.
  IF NEW.stage = 'created' AND NEW.assigned_to IS NOT NULL THEN
    NEW.stage := 'assigned';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF auth.uid() IS NOT NULL AND public.get_user_role() NOT IN ('partner') AND NOT public.is_super_admin() THEN
      v_ok := CASE OLD.stage
        WHEN 'created'        THEN NEW.stage = 'assigned'
        WHEN 'assigned'       THEN NEW.stage = 'in_progress'
        WHEN 'in_progress'    THEN NEW.stage IN ('waiting_client', 'under_review')
                                   OR (NEW.stage = 'completed' AND NEW.reviewer_id IS NULL)
        WHEN 'waiting_client' THEN NEW.stage = 'in_progress'
        WHEN 'under_review'   THEN NEW.stage IN ('completed', 'in_progress')
        WHEN 'completed'      THEN NEW.stage = 'archived'
        ELSE false
      END;
      IF NOT v_ok THEN
        RAISE EXCEPTION 'Invalid stage transition: % -> %', OLD.stage, NEW.stage;
      END IF;
    END IF;
  END IF;

  -- `status` is derived — keeps DeadlineTracker-style dashboard queries alive.
  NEW.status := CASE WHEN NEW.stage IN ('completed', 'archived') THEN 'completed' ELSE 'pending' END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER validate_task_stage
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_task_stage();

-- History row on every stage change (task_stage_history has no INSERT policy;
-- this SECURITY DEFINER trigger is the only writer).
CREATE OR REPLACE FUNCTION public.log_task_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.task_stage_history (firm_id, task_id, from_stage, to_stage, changed_by)
    VALUES (NEW.firm_id, NEW.id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage END,
            NEW.stage, auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER record_task_stage_history
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_stage_change();

-- 9.5 New document version -> bump parent pointer, force re-approval, and
-- maintain the firm's storage counter. SECURITY DEFINER so a client_user's
-- version upload can update the parent row they have no UPDATE policy for.
CREATE OR REPLACE FUNCTION public.handle_new_document_version()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.documents
  SET current_version  = NEW.version_number,
      approval_status  = 'pending',
      reviewed_by      = NULL,
      reviewed_at      = NULL,
      rejection_reason = NULL,
      updated_at       = now()
  WHERE id = NEW.document_id
    AND NEW.version_number >= current_version;

  UPDATE public.firms
  SET storage_used_bytes = storage_used_bytes + COALESCE(NEW.file_size, 0)
  WHERE id = NEW.firm_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_document_version_added
  AFTER INSERT ON public.document_versions
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_document_version();

CREATE OR REPLACE FUNCTION public.handle_document_version_removed()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.firms
  SET storage_used_bytes = GREATEST(storage_used_bytes - COALESCE(OLD.file_size, 0), 0)
  WHERE id = OLD.firm_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_document_version_removed
  AFTER DELETE ON public.document_versions
  FOR EACH ROW EXECUTE FUNCTION public.handle_document_version_removed();

-- 9.6 Client billing (Phase 12 / migration 004): invoice immutability,
-- receipt validity + settlement maintenance, gapless issue RPC, ledger view.

-- Invoice immutability guard (legal requirement: issued invoices are never
-- edited — cancel + reissue). Same guard-trigger pattern as 9.2 (F1).
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

-- Migration 005: guard_firm_invoice (above) freezes status transitions on
-- UPDATE once issued, but a BEFORE UPDATE trigger cannot see a DELETE.
-- Issued invoices are statutory records — cancel, never delete.
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

-- A receipt must reference a live (issued-family) invoice of the SAME
-- client and firm — the doc↔task cross-client gap is not repeated here.
-- invoice_id IS NULL (on-account, migration 006) skips this entirely: there
-- is nothing to validate against.
CREATE OR REPLACE FUNCTION public.guard_receipt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv public.firm_invoices%ROWTYPE;
BEGIN
  IF NEW.invoice_id IS NULL THEN
    RETURN NEW; -- on-account: unallocated, nothing to validate against (migration 006)
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

CREATE TRIGGER guard_receipt
  BEFORE INSERT OR UPDATE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_receipt();

-- Trigger-only audit trail writer for receipt_history (migration 006,
-- review finding 3). Logs every INSERT/UPDATE/DELETE with a before/after
-- JSONB snapshot; receipt_history has no INSERT policy, so this is the
-- only writer.
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

-- Recompute the affected invoice(s)' settlement columns and derive status
-- (issued ⇄ partially_paid ⇄ paid). SECURITY DEFINER — same denormalization-
-- by-trigger precedent as the document-version counters (9.5). Settlement
-- counts amount + TDS actually deducted (u/s 194J): a 90%-cash + 10%-TDS
-- receipt fully settles the invoice.
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

-- invoice_id IS NULL (on-account, migration 006) is skipped in both
-- directions — there is no invoice to settle.
CREATE OR REPLACE FUNCTION public.handle_receipt_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.invoice_id IS NOT NULL THEN
    PERFORM public.apply_receipts_to_invoice(NEW.invoice_id);
  END IF;
  -- OLD is only ever referenced when TG_OP is DELETE or UPDATE (it is
  -- unassigned, not merely NULL, on INSERT).
  IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id))
     AND OLD.invoice_id IS NOT NULL THEN
    PERFORM public.apply_receipts_to_invoice(OLD.invoice_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER on_receipt_change
  AFTER INSERT OR UPDATE OR DELETE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.handle_receipt_change();

-- issue_firm_invoice() — the ONLY path from draft to issued. SECURITY
-- INVOKER: the caller's own RLS (billing.manage) governs both the counter
-- write and the invoice UPDATE; the function exists purely for atomicity
-- (number assignment + totals snapshot + status flip in one transaction —
-- a failure anywhere rolls the counter back, keeping the series gapless).
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

-- client_outstanding — per-client receivables with aged buckets
-- (by due_date, falling back to invoice_date), netted against on-account
-- credit (migration 006, Phase 12 review finding 2). security_invoker: the
-- caller's RLS on firm_invoices AND receipts applies — staff-only in
-- practice (billing.view); client_users have no policy on either table and
-- get nothing here, by design. Aged buckets stay invoice-only — on-account
-- money isn't attached to any one invoice's due date — but on_account_credit
-- is exposed as its own column and netted into the top-level `outstanding`.
-- A FULL OUTER JOIN so a client with ONLY on-account receipts (no open
-- invoice at all) still appears, with a negative outstanding (a credit).
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

-- client_invoices / client_invoice_items — the ONLY read path for
-- client_users (Phase 12 review finding 1). RLS is row-level, not
-- column-level: a direct SELECT policy on firm_invoices would hand the
-- client internal_notes and cancellation_reason. These are DEFINER-RIGHTS
-- views (deliberately NOT security_invoker — with no client policy on the
-- base table an invoker view would return nothing) with the client
-- predicate baked in and an explicit safe column list; security_barrier
-- stops leaky functions from seeing rows before the predicate. Staff and
-- anon resolve get_user_client_id() to NULL and get zero rows. Same
-- curated-access-via-definer pattern as get_client_assigned_contact().
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

-- Migration 005: PUBLIC != authenticated. Supabase's default privileges
-- grant `authenticated` full DML on newly created objects in `public`, so
-- the GRANT SELECT above is additive, not exclusive — without this explicit
-- REVOKE, `authenticated` retained residual INSERT/UPDATE/DELETE on these
-- auto-updatable DEFINER views, and a portal client's own JWT could rewrite
-- or delete rows in firm_invoices under the view owner's rights (found live,
-- docs/verification/portal-isolation.md §7 checks C12b/C12c).
REVOKE INSERT, UPDATE, DELETE
  ON public.client_invoices, public.client_invoice_items
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE
  ON public.client_outstanding
  FROM authenticated;
GRANT SELECT ON public.client_outstanding TO authenticated;

-- 9.7 DSC register (Phase 13.2 / migration 008): movement logging + the
-- validated custody-recording RPC. See migration 008's header for the full
-- design rationale (why a narrow RPC was chosen over a column-freeze guard
-- trigger, and how it solves the note-writability gap task_stage_history has).

-- Sole writer of dsc_custody_movements (no INSERT policy exists on that
-- table). GUARDED TWICE against firing on unrelated dsc_register updates
-- (e.g. the expiry-alert cron writing last_expiry_alert_tier /
-- last_expiry_alert_sent_for_expiry): the trigger's own WHEN clause means
-- this function isn't invoked at all unless current_custodian_id changed,
-- and the function body repeats the same IS DISTINCT FROM check as defense
-- in depth. Creation with a NULL initial custodian logs nothing.
CREATE OR REPLACE FUNCTION public.log_dsc_custody_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_custodian_id IS DISTINCT FROM OLD.current_custodian_id THEN
    INSERT INTO public.dsc_custody_movements
      (firm_id, dsc_id, movement_type, from_custodian_id, to_custodian_id, note, recorded_by)
    VALUES (
      NEW.firm_id,
      NEW.id,
      CASE WHEN NEW.current_custodian_id IS NOT NULL THEN 'check_out' ELSE 'check_in' END,
      OLD.current_custodian_id,
      NEW.current_custodian_id,
      NULLIF(current_setting('app.dsc_movement_note', true), ''),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER record_dsc_custody_movement
  AFTER UPDATE ON public.dsc_register
  FOR EACH ROW
  WHEN (NEW.current_custodian_id IS DISTINCT FROM OLD.current_custodian_id)
  EXECUTE FUNCTION public.log_dsc_custody_movement();

-- The only path any non-partner staff member can use to change
-- current_custodian_id — SECURITY DEFINER so it can UPDATE regardless of
-- dsc_register's own partner-only UPDATE RLS policy, but re-validates the
-- SAME clients.view permission the SELECT policies below use, plus same-firm
-- scoping and custodian eligibility, before touching anything. This check is
-- load-bearing, not redundant: SECURITY DEFINER bypasses RLS entirely, so
-- this function body is the ONLY thing enforcing who may call it. Same shape
-- as create_notification()/get_client_assigned_contact() above.
CREATE OR REPLACE FUNCTION public.record_dsc_movement(
  p_dsc_id UUID,
  p_new_custodian_id UUID,
  p_note TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_firm_id UUID;
BEGIN
  IF NOT public.has_permission('clients.view') THEN
    RAISE EXCEPTION 'You do not have permission to view this client''s DSC records';
  END IF;

  SELECT firm_id INTO v_firm_id FROM public.dsc_register WHERE id = p_dsc_id;
  IF v_firm_id IS NULL OR v_firm_id IS DISTINCT FROM public.get_user_firm_id() THEN
    RAISE EXCEPTION 'DSC record not found in your firm';
  END IF;

  IF p_new_custodian_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_new_custodian_id AND firm_id = v_firm_id AND role IN ('partner', 'employee')
  ) THEN
    RAISE EXCEPTION 'Custodian must be a staff member of this firm';
  END IF;

  -- Transaction-local; read back by log_dsc_custody_movement() above within
  -- this same statement's transaction. Cleared automatically at COMMIT.
  PERFORM set_config('app.dsc_movement_note', COALESCE(p_note, ''), true);

  UPDATE public.dsc_register
  SET current_custodian_id = p_new_custodian_id
  WHERE id = p_dsc_id;
END;
$$;

-- ============================================================================
-- 10. SEED DATA
-- ============================================================================

INSERT INTO public.permissions (key, description, category) VALUES
  ('clients.view',            'View client records, addresses, authorized persons', 'clients'),
  ('clients.manage',          'Create/update clients and portal invitations',       'clients'),
  ('tasks.create',            'Create tasks in own departments',                    'tasks'),
  ('tasks.assign',            'Assign/reassign tasks to employees',                 'tasks'),
  ('tasks.update_department', 'Update any task in own departments (not just assigned)', 'tasks'),
  ('documents.upload',        'Upload documents and new versions',                  'documents'),
  ('documents.approve',       'Approve or reject client/staff documents',           'documents'),
  ('billing.view',            'View firm subscription and invoices',                'billing'),
  ('billing.manage',          'Change plan / manage billing',                       'billing'),
  ('reports.view',            'View firm-wide analytics dashboards',                'reports'),
  ('team.view',               'View employee list and department membership',       'team'),
  ('team.manage',             'Manage departments and department membership',       'team'),
  ('templates.manage',        'Create/update/delete task templates',                'templates'),
  ('settings.manage',         'Update firm settings',                               'settings');

-- Employee defaults ("sensible junior CA staff"). Partners bypass this table;
-- client_users always resolve to false.
INSERT INTO public.role_permissions (role, permission_key, allowed) VALUES
  ('employee', 'clients.view',            true),
  ('employee', 'clients.manage',          false),
  ('employee', 'tasks.create',            true),
  ('employee', 'tasks.assign',            false),
  ('employee', 'tasks.update_department', false),
  ('employee', 'documents.upload',        true),
  ('employee', 'documents.approve',       false),
  ('employee', 'billing.view',            false),
  ('employee', 'billing.manage',          false),
  ('employee', 'reports.view',            false),
  ('employee', 'team.view',               false),
  ('employee', 'team.manage',             false),
  ('employee', 'templates.manage',        false),
  ('employee', 'settings.manage',         false);

-- Compliance type catalog (Phase 9) — the confidently-known core set from the
-- feature-gap review. `due_day_rule` conventions: {"due_day": N,
-- "months_after_period_end": N} for monthly/quarterly types due N months
-- after the period closes; {"due_day": N, "due_month": N} for a fixed
-- calendar month/day annual due date. Government due-date extensions are not
-- modeled. ITR audit/non-audit are mutually exclusive by `requires_flag` —
-- the Phase 10 generation engine picks exactly one per client per FY.
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

INSERT INTO public.plans (code, name, price_monthly_inr, price_yearly_inr, max_users, max_clients, storage_gb, features) VALUES
  ('starter',      'Starter',      999,  9990,  3,  50,   5,  '{"client_portal": false, "document_approvals": true,  "recurring_tasks": true, "reports": false}'),
  ('professional', 'Professional', 2499, 24990, 10, 250,  25, '{"client_portal": true,  "document_approvals": true,  "recurring_tasks": true, "reports": true}'),
  ('enterprise',   'Enterprise',   5999, 59990, 50, NULL, 100,'{"client_portal": true,  "document_approvals": true,  "recurring_tasks": true, "reports": true, "api_access": true}');

-- ============================================================================
-- 11. ROW LEVEL SECURITY — written out in full for every table
-- ============================================================================

ALTER TABLE public.platform_admins            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firms                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_subscriptions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_addresses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_authorized_persons  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_registrations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_types           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_invitations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_stage_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_versions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activities            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_templates             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_masters                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_invoice_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_invoice_counters      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_history            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.udin_register              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dsc_register               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dsc_custody_movements      ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 11.1 platform_admins
-- Bootstrap: insert the first row with the service role (bypasses RLS).
-- ---------------------------------------------------------------------------
CREATE POLICY "Users can check their own super admin row"
  ON public.platform_admins FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Super admins can view all platform admins"
  ON public.platform_admins FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Super admins can add platform admins"
  ON public.platform_admins FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Super admins can remove platform admins"
  ON public.platform_admins FOR DELETE TO authenticated
  USING (public.is_super_admin() AND user_id <> auth.uid());  -- can't remove yourself: no lockout

-- ---------------------------------------------------------------------------
-- 11.2 plans — public catalog, super-admin managed
-- ---------------------------------------------------------------------------
CREATE POLICY "Anyone authenticated can view active plans"
  ON public.plans FOR SELECT TO authenticated
  USING (is_active OR public.is_super_admin());

CREATE POLICY "Super admins can create plans"
  ON public.plans FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Super admins can update plans"
  ON public.plans FOR UPDATE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Super admins can delete plans"
  ON public.plans FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 11.3 permissions / role_permissions — readable catalog, super-admin managed
-- ---------------------------------------------------------------------------
CREATE POLICY "Anyone authenticated can view the permission catalog"
  ON public.permissions FOR SELECT TO authenticated
  USING (true);   -- catalog of keys only; contains no tenant data

CREATE POLICY "Super admins manage the permission catalog"
  ON public.permissions FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Anyone authenticated can view role defaults"
  ON public.role_permissions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Super admins manage role defaults"
  ON public.role_permissions FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 11.4 firms
-- NOTE: deliberately NO general INSERT policy and NO `USING (true)` SELECT
-- (both existed in DeadlineTracker). Firm creation and invite-code lookup go
-- through the service-role client / lookup_firm_by_invite_code() (flag F2/F3).
-- ---------------------------------------------------------------------------
CREATE POLICY "Members and clients can view their own firm"
  ON public.firms FOR SELECT TO authenticated
  USING (id = public.get_user_firm_id());   -- includes client_users: firm name/branding only

CREATE POLICY "Super admins can view all firms"
  ON public.firms FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Partners can update their firm"
  ON public.firms FOR UPDATE TO authenticated
  USING (id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

CREATE POLICY "Super admins can update any firm"
  ON public.firms FOR UPDATE TO authenticated
  USING (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 11.5 departments — staff-only (client_user has NO path to this table)
-- ---------------------------------------------------------------------------
CREATE POLICY "Firm staff can view departments"
  ON public.departments FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.is_firm_staff());

CREATE POLICY "Super admins can view all departments"
  ON public.departments FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Team managers can create departments"
  ON public.departments FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.get_user_firm_id() AND public.has_permission('team.manage'));

CREATE POLICY "Team managers can update departments"
  ON public.departments FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('team.manage'));

CREATE POLICY "Team managers can delete departments"
  ON public.departments FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('team.manage'));

-- ---------------------------------------------------------------------------
-- 11.6 profiles
-- Staff see all firm profiles. A client_user sees ONLY their own row — they
-- can never enumerate employees or sibling client_users. Staff contact info
-- for the portal is exposed via a dedicated RPC in a later phase, not by
-- widening this policy.
-- NOTE: no INSERT policy — profiles are provisioned by the service-role
-- client in the auth callback (flag F3).
-- ---------------------------------------------------------------------------
CREATE POLICY "Staff can view profiles in their firm"
  ON public.profiles FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.is_firm_staff());

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Super admins can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- Column-level protection of role/firm_id/client_id is enforced by the
-- guard_profile_protected_fields trigger (§9.2), not by these policies.
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Partners can update profiles in their firm"
  ON public.profiles FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

CREATE POLICY "Partners can remove profiles in their firm"
  ON public.profiles FOR DELETE TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.get_user_role() = 'partner'
    AND id <> auth.uid()          -- a partner cannot delete themselves
  );

-- ---------------------------------------------------------------------------
-- 11.7 department_members — staff-only
-- ---------------------------------------------------------------------------
CREATE POLICY "Firm staff can view department membership"
  ON public.department_members FOR SELECT TO authenticated
  USING (
    public.is_firm_staff()
    AND EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = department_id AND d.firm_id = public.get_user_firm_id()
    )
  );

CREATE POLICY "Super admins can view all department membership"
  ON public.department_members FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Team managers can add department members"
  ON public.department_members FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('team.manage')
    AND EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = department_id AND d.firm_id = public.get_user_firm_id()
    )
    AND public.profile_in_my_firm(user_id)          -- target must be same-firm
    AND NOT public.profile_in_my_firm(user_id, 'client_user')  -- clients can't join departments
  );

CREATE POLICY "Team managers can remove department members"
  ON public.department_members FOR DELETE TO authenticated
  USING (
    public.has_permission('team.manage')
    AND EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = department_id AND d.firm_id = public.get_user_firm_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 11.8 user_permissions
-- Partners manage overrides for EMPLOYEES in their firm only (not for other
-- partners, and never for client_users — their access is structural).
-- ---------------------------------------------------------------------------
-- Scoped to employees only (migration 009): only an employee row can ever
-- legitimately exist here (see the INSERT/UPDATE/DELETE policies below), so
-- an unscoped USING (user_id = auth.uid()) would let a client_user or
-- partner read a stray row via raw PostgREST if one ever existed.
CREATE POLICY "Employees can view their own permission overrides"
  ON public.user_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.get_user_role() = 'employee');

CREATE POLICY "Partners can view overrides in their firm"
  ON public.user_permissions FOR SELECT TO authenticated
  USING (public.get_user_role() = 'partner' AND public.profile_in_my_firm(user_id));

CREATE POLICY "Super admins can view all overrides"
  ON public.user_permissions FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Partners can grant overrides to their employees"
  ON public.user_permissions FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'partner'
    AND public.profile_in_my_firm(user_id, 'employee')
    AND granted_by = auth.uid()
  );

CREATE POLICY "Partners can update overrides for their employees"
  ON public.user_permissions FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'partner'
    AND public.profile_in_my_firm(user_id, 'employee')
  );

CREATE POLICY "Partners can revoke overrides for their employees"
  ON public.user_permissions FOR DELETE TO authenticated
  USING (
    public.get_user_role() = 'partner'
    AND public.profile_in_my_firm(user_id, 'employee')
  );

-- ---------------------------------------------------------------------------
-- 11.9 firm_subscriptions / subscription_invoices
-- The granular-permission showcase: an employee needs billing.view to read
-- these even though they can see clients/tasks. client_user: no path at all.
-- Writes: super_admin in-band; payment webhooks use the service role.
-- ---------------------------------------------------------------------------
CREATE POLICY "Billing viewers can see their firm subscription"
  ON public.firm_subscriptions FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.view'));

CREATE POLICY "Super admins can view all subscriptions"
  ON public.firm_subscriptions FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Super admins manage subscriptions"
  ON public.firm_subscriptions FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Billing viewers can see their firm invoices"
  ON public.subscription_invoices FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.view'));

CREATE POLICY "Super admins can view all invoices"
  ON public.subscription_invoices FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Super admins manage invoices"
  ON public.subscription_invoices FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 11.10 clients — THE sibling-isolation table
-- A client_user's ONLY path is `id = get_user_client_id()`: exactly one row.
-- Sibling clients of the same firm fail this predicate; clients of other
-- firms fail it too. There is no other SELECT policy a client_user can
-- satisfy (they are not staff, not super admin).
-- ---------------------------------------------------------------------------
CREATE POLICY "Partners can view all firm clients"
  ON public.clients FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

CREATE POLICY "Employees can view permitted or task-linked clients"
  ON public.clients FOR SELECT TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.get_user_role() = 'employee'
    AND (
      public.has_permission('clients.view')
      OR public.employee_has_task_for_client(id)   -- needs the client name on own tasks
    )
  );

CREATE POLICY "Client users can view ONLY their own client record"
  ON public.clients FOR SELECT TO authenticated
  USING (id = public.get_user_client_id());

CREATE POLICY "Super admins can view all clients"
  ON public.clients FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Client managers can create clients"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND public.has_permission('clients.manage')
    AND created_by = auth.uid()
  );

CREATE POLICY "Client managers can update clients"
  ON public.clients FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

-- NO DELETE policy on purpose: statutory records are deactivated
-- (is_active = false), never hard-deleted from the app (flag F6).

-- ---------------------------------------------------------------------------
-- 11.11 client_addresses / client_authorized_persons
-- Mirror the clients visibility rules; client_users read ONLY their own
-- client's rows, read-only (changes go through the firm).
-- ---------------------------------------------------------------------------
CREATE POLICY "Staff can view addresses of visible clients"
  ON public.client_addresses FOR SELECT TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.is_firm_staff()
    AND (
      public.get_user_role() = 'partner'
      OR public.has_permission('clients.view')
      OR public.employee_has_task_for_client(client_id)
    )
  );

CREATE POLICY "Client users can view their own client addresses"
  ON public.client_addresses FOR SELECT TO authenticated
  USING (client_id = public.get_user_client_id());

CREATE POLICY "Super admins can view all client addresses"
  ON public.client_addresses FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Client managers can create addresses"
  ON public.client_addresses FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

CREATE POLICY "Client managers can update addresses"
  ON public.client_addresses FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

CREATE POLICY "Client managers can delete addresses"
  ON public.client_addresses FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

CREATE POLICY "Staff can view authorized persons of visible clients"
  ON public.client_authorized_persons FOR SELECT TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.is_firm_staff()
    AND (
      public.get_user_role() = 'partner'
      OR public.has_permission('clients.view')
      OR public.employee_has_task_for_client(client_id)
    )
  );

CREATE POLICY "Client users can view their own authorized persons"
  ON public.client_authorized_persons FOR SELECT TO authenticated
  USING (client_id = public.get_user_client_id());

CREATE POLICY "Super admins can view all authorized persons"
  ON public.client_authorized_persons FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Client managers can create authorized persons"
  ON public.client_authorized_persons FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

CREATE POLICY "Client managers can update authorized persons"
  ON public.client_authorized_persons FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

CREATE POLICY "Client managers can delete authorized persons"
  ON public.client_authorized_persons FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

-- ---------------------------------------------------------------------------
-- 11.12 client_portal_invitations — staff-only; signup uses the
-- lookup_client_invitation() RPC, never direct SELECT.
-- ---------------------------------------------------------------------------
CREATE POLICY "Client managers can view portal invitations"
  ON public.client_portal_invitations FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

CREATE POLICY "Client managers can create portal invitations"
  ON public.client_portal_invitations FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND public.has_permission('clients.manage')
    AND invited_by = auth.uid()
    AND EXISTS (   -- invitation must point at a client of the same firm
      SELECT 1 FROM public.clients c
      WHERE c.id = client_id AND c.firm_id = public.get_user_firm_id()
    )
  );

CREATE POLICY "Client managers can update portal invitations"
  ON public.client_portal_invitations FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

CREATE POLICY "Client managers can delete portal invitations"
  ON public.client_portal_invitations FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.manage'));

-- ---------------------------------------------------------------------------
-- 11.13 tasks
-- Partner: all firm tasks. Employee: assigned ∪ own-department. Client_user:
-- curated — only their client's, only client-visible, only active stages.
-- ---------------------------------------------------------------------------
CREATE POLICY "Partners can view all firm tasks"
  ON public.tasks FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

CREATE POLICY "Employees can view assigned or department tasks"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.get_user_role() = 'employee'
    AND (
      assigned_to = auth.uid()
      OR department_id = ANY (public.get_user_department_ids())
    )
  );

CREATE POLICY "Client users can view their client's visible tasks"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    client_id = public.get_user_client_id()      -- exactly one client; NULL for staff
    AND visible_to_client
    AND stage NOT IN ('created', 'archived')     -- unstarted/archived work stays internal
  );

CREATE POLICY "Super admins can view all tasks"
  ON public.tasks FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Task creators can create tasks in their departments"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND created_by = auth.uid()
    AND public.has_permission('tasks.create')
    AND (   -- partners anywhere; employees only into their own departments
      public.get_user_role() = 'partner'
      OR department_id = ANY (public.get_user_department_ids())
    )
    AND EXISTS (   -- task must reference a client of the same firm
      SELECT 1 FROM public.clients c
      WHERE c.id = client_id AND c.firm_id = public.get_user_firm_id()
    )
  );

CREATE POLICY "Partners can update any firm task"
  ON public.tasks FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

CREATE POLICY "Employees can update assigned tasks"
  ON public.tasks FOR UPDATE TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.get_user_role() = 'employee'
    AND assigned_to = auth.uid()
  );

CREATE POLICY "Department updaters can update department tasks"
  ON public.tasks FOR UPDATE TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.get_user_role() = 'employee'
    AND public.has_permission('tasks.update_department')
    AND department_id = ANY (public.get_user_department_ids())
  );

-- Client users have NO update path on tasks: "Waiting Client" is resolved by
-- their document/comment activity; staff move the stage.

CREATE POLICY "Partners can delete firm tasks"
  ON public.tasks FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

-- ---------------------------------------------------------------------------
-- 11.14 task_stage_history — staff-only read; trigger-only writes
-- (no INSERT/UPDATE/DELETE policies at all: RLS default-denies them).
-- ---------------------------------------------------------------------------
CREATE POLICY "Staff can view stage history of accessible tasks"
  ON public.task_stage_history FOR SELECT TO authenticated
  USING (public.is_firm_staff() AND public.staff_can_access_task(task_id));

CREATE POLICY "Super admins can view all stage history"
  ON public.task_stage_history FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 11.15 task_comments
-- Staff see every comment on tasks they can access. Client_users see only
-- comments explicitly flagged visible_to_client on tasks they can see, and
-- everything THEY write is forced client-visible (no hidden client writes).
-- ---------------------------------------------------------------------------
CREATE POLICY "Staff can view comments on accessible tasks"
  ON public.task_comments FOR SELECT TO authenticated
  USING (public.is_firm_staff() AND public.staff_can_access_task(task_id));

CREATE POLICY "Client users can view client-visible comments on their tasks"
  ON public.task_comments FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'client_user'
    AND visible_to_client
    AND public.client_can_access_task(task_id)
  );

CREATE POLICY "Super admins can view all comments"
  ON public.task_comments FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Staff can comment on accessible tasks"
  ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND created_by = auth.uid()
    AND public.is_firm_staff()
    AND public.staff_can_access_task(task_id)
  );

CREATE POLICY "Client users can comment on their visible tasks"
  ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND created_by = auth.uid()
    AND public.get_user_role() = 'client_user'
    AND public.client_can_access_task(task_id)
    AND visible_to_client = true        -- client comments can never hide from staff view
  );

CREATE POLICY "Authors can update their own comments"
  ON public.task_comments FOR UPDATE TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "Authors can delete their own comments"
  ON public.task_comments FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- 11.16 documents
-- Client_user read rule (curated): own client + client-visible + (they
-- uploaded it OR it has a decided outcome — approved OR rejected, so a
-- rejection reason is always visible to the client who needs to act on it).
-- Pending staff drafts stay hidden until a decision is made.
-- ---------------------------------------------------------------------------
CREATE POLICY "Partners can view all firm documents"
  ON public.documents FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

CREATE POLICY "Employees can view documents on accessible work"
  ON public.documents FOR SELECT TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.get_user_role() = 'employee'
    AND (
      (task_id IS NOT NULL AND public.staff_can_access_task(task_id))
      OR (task_id IS NULL AND (public.has_permission('clients.view')
                               OR public.employee_has_task_for_client(client_id)))
    )
  );

CREATE POLICY "Client users can view their own, approved, or rejected client documents"
  ON public.documents FOR SELECT TO authenticated
  USING (
    client_id = public.get_user_client_id()
    AND visible_to_client
    AND (uploaded_by = auth.uid() OR approval_status IN ('approved', 'rejected'))
  );

CREATE POLICY "Super admins can view all documents"
  ON public.documents FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Staff can upload documents to accessible tasks"
  ON public.documents FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND uploaded_by = auth.uid()
    AND public.is_firm_staff()
    AND public.has_permission('documents.upload')
    AND (task_id IS NULL OR public.staff_can_access_task(task_id))
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_id AND c.firm_id = public.get_user_firm_id()
    )
  );

CREATE POLICY "Client users can upload documents for their client"
  ON public.documents FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND uploaded_by = auth.uid()
    AND public.get_user_role() = 'client_user'
    AND client_id = public.get_user_client_id()   -- can only file under their own client
    -- task-less uploads allowed: clients can proactively share files (e.g. bank
    -- statements) not tied to a task; task-linked uploads still require a
    -- client-visible task
    AND (task_id IS NULL OR public.client_can_access_task(task_id))
    AND approval_status = 'pending'               -- clients can never self-approve
    AND visible_to_client = true
  );

CREATE POLICY "Document approvers can update documents"
  ON public.documents FOR UPDATE TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.is_firm_staff()
    AND public.has_permission('documents.approve')
  );

-- Client users have NO UPDATE path on documents: a corrected file is a new
-- row in document_versions (trigger resets approval to 'pending').

CREATE POLICY "Partners can delete documents"
  ON public.documents FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

CREATE POLICY "Uploaders can delete their own pending documents"
  ON public.documents FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() AND approval_status = 'pending');

-- ---------------------------------------------------------------------------
-- 11.17 document_versions — inherit the parent document's visibility exactly
-- ---------------------------------------------------------------------------
CREATE POLICY "Users can view versions of accessible documents"
  ON public.document_versions FOR SELECT TO authenticated
  USING (public.can_access_document(document_id));

CREATE POLICY "Super admins can view all document versions"
  ON public.document_versions FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Users can add versions to accessible documents"
  ON public.document_versions FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND uploaded_by = auth.uid()
    AND public.can_access_document(document_id)
  );

CREATE POLICY "Partners can delete document versions"
  ON public.document_versions FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

-- No UPDATE policy: version rows are immutable once written.

-- ---------------------------------------------------------------------------
-- 11.18 task_activities — staff-only read; any task participant may write
-- their own entries (client uploads/comments still get logged).
-- ---------------------------------------------------------------------------
CREATE POLICY "Staff can view activity on accessible tasks"
  ON public.task_activities FOR SELECT TO authenticated
  USING (public.is_firm_staff() AND public.staff_can_access_task(task_id));

CREATE POLICY "Super admins can view all activity"
  ON public.task_activities FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Task participants can log their own activity"
  ON public.task_activities FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND actor_id = auth.uid()
    AND (public.staff_can_access_task(task_id) OR public.client_can_access_task(task_id))
  );

-- No UPDATE/DELETE policies: the audit log is immutable.

-- ---------------------------------------------------------------------------
-- 11.19 notifications — own rows only; creation via staff policy or the
-- create_notification() SECURITY DEFINER helper (for client-originated events)
-- ---------------------------------------------------------------------------
CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Staff can create notifications for firm members"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND public.is_firm_staff()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_id AND p.firm_id = public.get_user_firm_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 11.20 task_templates — staff-only
-- ---------------------------------------------------------------------------
CREATE POLICY "Firm staff can view task templates"
  ON public.task_templates FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.is_firm_staff());

CREATE POLICY "Super admins can view all task templates"
  ON public.task_templates FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Template managers can create templates"
  ON public.task_templates FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = public.get_user_firm_id()
    AND public.has_permission('templates.manage')
    AND created_by = auth.uid()
  );

CREATE POLICY "Template managers can update templates"
  ON public.task_templates FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('templates.manage'));

CREATE POLICY "Template managers can delete templates"
  ON public.task_templates FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('templates.manage'));

-- ---------------------------------------------------------------------------
-- 11.21 compliance_types (Phase 9) — platform-wide catalog, same shape as
-- §11.3 permissions/role_permissions: readable by every authenticated user
-- (no tenant data in it), managed only by super admins. No DELETE policy —
-- retire a type via is_active (mirrors clients/departments precedent).
-- ---------------------------------------------------------------------------
CREATE POLICY "Anyone authenticated can view active compliance types"
  ON public.compliance_types FOR SELECT TO authenticated
  USING (is_active OR public.is_super_admin());

CREATE POLICY "Super admins manage compliance types"
  ON public.compliance_types FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 11.22 client_registrations (Phase 9) — mirrors §11.11 client_addresses /
-- client_authorized_persons exactly: staff visibility follows clients.view
-- or an own task for that client; client_users read only their own client's
-- rows; writes are clients.manage-gated; no DELETE-by-clients precedent here
-- either but registrations are genuinely removable (e.g. a cancelled GSTIN
-- entered in error) so DELETE is permitted, unlike the parent `clients` row.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 11.23 Client billing (Phase 12 / migration 004) — fee_masters,
-- firm_invoices, firm_invoice_items, firm_invoice_counters, receipts.
-- Staff SELECT via billing.view, writes via billing.manage (both existing
-- catalog keys, employee-default false; partners bypass via has_permission).
-- client_users have NO policy on ANY billing table — they read only through
-- the §9.6 client_invoices / client_invoice_items definer views (finding 1:
-- a row-level policy would expose internal_notes / cancellation_reason);
-- never fee_masters, receipts, or counters. WHAT may change post-issue is
-- decided by the §9.6 guard triggers, not these policies.
-- ---------------------------------------------------------------------------
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

CREATE POLICY "Billing managers can delete draft invoices"
  ON public.firm_invoices FOR DELETE TO authenticated
  USING (
    firm_id = public.get_user_firm_id()
    AND public.has_permission('billing.manage')
    AND status = 'draft'      -- issued invoices are cancelled, never deleted
  );

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

-- firm_invoice_counters — written only inside issue_firm_invoice() under
-- the caller's rights; readable for diagnostics by billing viewers.
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

-- receipt_history (migration 006) — staff-only read via billing.view (same
-- as receipts); no INSERT/UPDATE/DELETE policy at all — RLS default-denies
-- every direct write, log_receipt_change() (§9.6) is the only writer.
CREATE POLICY "Billing viewers can see receipt history"
  ON public.receipt_history FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('billing.view'));

CREATE POLICY "Super admins can view all receipt history"
  ON public.receipt_history FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 11.24 udin_register (Phase 12.5 / migration 007) — reads via the SAME
-- reports.view permission the filing-status grid uses (no new permission
-- key); writes are PARTNER-ONLY at the RLS layer itself (get_user_role(),
-- not a permission-catalog key) — mirrors Phase 10's identical choice for
-- statutory-task generation. See migration 007's header for the full
-- reasoning, including the flagged alternative (a compliance.manage key).
-- ---------------------------------------------------------------------------
CREATE POLICY "Report viewers can see the UDIN register"
  ON public.udin_register FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('reports.view'));

CREATE POLICY "Super admins can view all UDIN register entries"
  ON public.udin_register FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Partners can create UDIN register entries"
  ON public.udin_register FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

CREATE POLICY "Partners can update UDIN register entries"
  ON public.udin_register FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

CREATE POLICY "Partners can delete UDIN register entries"
  ON public.udin_register FOR DELETE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

-- ---------------------------------------------------------------------------
-- 11.25 dsc_register / dsc_custody_movements (Phase 13.2 / migration 008) —
-- reads are gated on the EXISTING clients.view permission (partner bypass as
-- normal via has_permission(), no new permission key) — REVISED from an
-- initial is_firm_staff() draft after review: an employee with clients.view
-- revoked (a real, tested configuration — rls-smoke.mjs's E2 case) must not
-- be able to read dsc_register.client_id/holder_name, which is client-
-- identifying data exactly like the clients table itself. Full-record writes
-- (create/edit) are PARTNER-ONLY at the RLS layer (get_user_role(), no
-- permission key), mirroring udin_register. Custody movements (check-out/
-- check-in) do NOT ride a broader UPDATE policy at all — record_dsc_movement()
-- (§9.7) is the only path a non-partner staff member can use to change
-- current_custodian_id, gated on the SAME clients.view check inside that
-- SECURITY DEFINER function (not RLS — RLS is bypassed by SECURITY DEFINER,
-- so this in-function check is load-bearing, not redundant). dsc_custody_
-- movements has NO INSERT/UPDATE/DELETE policy whatsoever — the AFTER
-- UPDATE trigger on dsc_register is its only writer, mirroring
-- task_stage_history exactly. Client isolation: has_permission('clients.view')
-- resolves false for client_user before consulting anything else, so both
-- tables and the RPC are unreachable from the portal before any other check
-- runs.
-- ---------------------------------------------------------------------------
CREATE POLICY "Clients.view holders can view the DSC register"
  ON public.dsc_register FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.view'));

CREATE POLICY "Super admins can view all DSC register entries"
  ON public.dsc_register FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Partners can create DSC register entries"
  ON public.dsc_register FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

CREATE POLICY "Partners can update DSC register entries"
  ON public.dsc_register FOR UPDATE TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.get_user_role() = 'partner');

-- No DELETE policy — retire via is_active, mirrors clients/departments
-- (stricter than udin_register's unused-but-present partner DELETE policy).

CREATE POLICY "Clients.view holders can view DSC custody movements"
  ON public.dsc_custody_movements FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.view'));

CREATE POLICY "Super admins can view all DSC custody movements"
  ON public.dsc_custody_movements FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- ============================================================================
-- 12. STORAGE POLICIES (bucket: 'client-documents')
-- Prerequisite: create a PRIVATE bucket named exactly 'client-documents' in
-- the Supabase dashboard first, then run this section.
-- Object path convention: {firm_id}/{client_id}/{document_id}/{uuid}.{ext}
--   (storage.foldername(name))[1] = firm_id, [2] = client_id, [3] = document_id
-- Downloads should still use short-lived signed URLs generated server-side
-- (as DeadlineTracker does). For STAFF these policies are the firm-wide
-- defense-in-depth floor; for CLIENT users the SELECT policy is the AUTHORITY
-- for the curated portal view — it mirrors the public.documents table rules via
-- can_access_document() so a client cannot read (download, sign, or even list)
-- an internal / not-yet-visible / pending object under their own client folder
-- (portal-isolation finding #7; migration 003).
-- ============================================================================

CREATE POLICY "Staff can read their firm's document files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND public.is_firm_staff()
    AND (storage.foldername(name))[1] = public.get_user_firm_id()::text
  );

-- Client storage reads are curated, not just client-scoped: reuse the
-- table-layer predicate (can_access_document) on the document_id path segment
-- so visible_to_client / approval_status are honored at the storage layer too.
-- This governs both download AND list/enumeration (list() runs under this same
-- SELECT policy). CASE keeps the ::uuid cast safe against attacker-controlled
-- segment-[3] values (the client INSERT policy validates only [1]/[2]) — a
-- non-UUID segment yields NULL, and can_access_document(NULL) is false.
CREATE POLICY "Client users can read their own client's files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND public.get_user_role() = 'client_user'
    AND public.can_access_document(
          CASE
            WHEN (storage.foldername(name))[3] ~
                 '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN ((storage.foldername(name))[3])::uuid
          END
        )
  );

CREATE POLICY "Staff can upload files under their firm"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-documents'
    AND public.is_firm_staff()
    AND public.has_permission('documents.upload')
    AND (storage.foldername(name))[1] = public.get_user_firm_id()::text
  );

CREATE POLICY "Client users can upload files under their own client folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-documents'
    AND public.get_user_role() = 'client_user'
    AND (storage.foldername(name))[1] = public.get_user_firm_id()::text
    AND (storage.foldername(name))[2] = public.get_user_client_id()::text
  );

CREATE POLICY "Partners can delete their firm's document files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND public.get_user_role() = 'partner'
    AND (storage.foldername(name))[1] = public.get_user_firm_id()::text
  );

-- ============================================================================
-- END OF SCHEMA
-- Bootstrap checklist (fresh project):
--   1. Run this file in the SQL editor (after creating the storage bucket,
--      or comment out §12 and run it after bucket creation).
--   2. INSERT the first platform_admins row via the SQL editor.
--   3. Signup flows (create-firm / join-firm / accept-client-invitation) all
--      provision profiles through the SERVICE-ROLE client, mirroring
--      DeadlineTracker's /auth/callback pattern.
-- ============================================================================
