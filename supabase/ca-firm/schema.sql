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
  ('employee', 'team.view',               true),
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
CREATE POLICY "Users can view their own permission overrides"
  ON public.user_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

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

-- ============================================================================
-- 12. STORAGE POLICIES (bucket: 'client-documents')
-- Prerequisite: create a PRIVATE bucket named exactly 'client-documents' in
-- the Supabase dashboard first, then run this section.
-- Object path convention: {firm_id}/{client_id}/{document_id}/{uuid}.{ext}
--   (storage.foldername(name))[1] = firm_id, [2] = client_id
-- Downloads should still use short-lived signed URLs generated server-side
-- (as DeadlineTracker does); these policies are the defense-in-depth floor.
-- ============================================================================

CREATE POLICY "Staff can read their firm's document files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND public.is_firm_staff()
    AND (storage.foldername(name))[1] = public.get_user_firm_id()::text
  );

CREATE POLICY "Client users can read their own client's files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND (storage.foldername(name))[2] = public.get_user_client_id()::text
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
