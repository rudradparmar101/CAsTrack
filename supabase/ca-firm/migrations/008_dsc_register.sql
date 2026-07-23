-- ============================================================================
-- Migration 008 — Phase 13.2: DSC (Digital Signature Certificate) register
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ✅ APPLIED 2026-07-23 (Phase 13.2) — confirmed clean in Supabase Studio by
-- Jay; verified via scripts/verify/10-dsc-register.mjs (17/17) and
-- 11-dsc-playwright.mjs (17/17). Folded into schema.sql in the same session.
-- This header was stale ("NOT YET APPLIED") until Phase 14.2's systemic
-- audit caught it (2026-07-23) — see project_context.md §4.14 for the
-- original application record and docs/DECISIONS.md for the migration
-- convention this gap motivated.
--
-- docs/ROADMAP.md Phase 13.2: "DSC register: dsc_records (holder client/
-- person, expiry, storage location) + custody movements (in/out, who, when);
-- expiry alerts into the Ph11 scheduler." A DSC is a physical USB token used
-- to digitally sign statutory filings; a CA firm typically holds tokens on
-- behalf of many clients. The real pain is custody ("who has the Sharma
-- Industries token?") and expiry (a token expiring mid-filing-season blocks
-- filings). Capture only — this register does not generate, validate, or
-- interact with any DSC/token itself.
--
-- ⚠ HARD CONSTRAINT, deliberately upheld throughout this migration: NO
-- credential columns (PIN, password, or any other secret). The credentials
-- vault was explicitly deferred post-pilot (docs/DECISIONS.md, 2026-07-23)
-- specifically because it's the one feature whose failure mode is
-- unrecoverable — this register must not become a backdoor for storing
-- secrets in plaintext under a different table name. Every column below is
-- custody/expiry metadata only.
--
-- ----------------------------------------------------------------------------
-- Design notes — dsc_register
-- ----------------------------------------------------------------------------
--   - firm_id + client_id: firm-scoped register, one row per physical token.
--     client_id is NOT NULL (every real DSC in CA practice is held for a
--     specific client's signatory) and ON DELETE RESTRICT, same reasoning as
--     udin_register.client_id (migration 007) — clients have no DELETE
--     policy anyway, so this is belt-and-suspenders against a future direct-
--     DB delete orphaning custody history.
--   - holder_name / holder_designation: the DSC belongs to a PERSON (a
--     director/partner/proprietor — the authorized signatory), not the
--     client entity itself. One client can legitimately have several DSCs,
--     one per signatory (e.g. two directors of the same Pvt Ltd company).
--     designation is free text ('Director', 'Proprietor', 'Managing
--     Partner', ...) — no fixed enum, mirrors the reasoning below.
--   - issuing_authority: free TEXT, not an enum. Same reasoning as
--     udin_register.document_type (migration 007) and compliance_types'
--     free-text conventions generally — the certifying-authority list
--     (eMudhra, Sify, nCode, Capricorn, ...) changes over time and isn't this
--     schema's responsibility to hardcode.
--   - dsc_class: also free TEXT, not an enum, for the same reason —
--     CCA India's own DSC class taxonomy has changed over time (Class 2 was
--     phased out for new issuance in 2021 in favour of Class 3, but
--     previously issued Class 2 tokens can still be legitimately held and
--     tracked here) — an enum baked into this schema would need a migration
--     every time the regulator's own taxonomy moves, exactly the brittleness
--     issuing_authority/document_type already avoid.
--   - serial_number: the token's own reference/serial number, printed on the
--     physical token and certificate — NOT a secret (this is explicitly not
--     the PIN/password the hard constraint above forbids storing).
--   - issued_on nullable / expires_on NOT NULL: legacy tokens entered
--     retroactively may have an unknown issue date, but expires_on drives
--     the entire alerting feature below and must always be known to be
--     tracked at all.
--   - current_custodian_id: nullable FK to profiles (staff only, never a
--     client — clients have no operational reason to be represented in this
--     schema's custody chain). NULL means the token isn't currently checked
--     out to a staff member — it's sitting in physical_storage_location,
--     which may itself read something like "with client, collected in
--     person" (free text, not a separate state machine — same
--     don't-over-model philosophy as issuing_authority).
--   - UNIQUE (firm_id, issuing_authority, serial_number): serial numbers are
--     only unique within one certifying authority's own numbering scheme,
--     not globally — scoped the same defensive way udin_register scopes its
--     UNIQUE (firm_id, udin) to avoid a cross-tenant constraint leak.
--   - is_active: no hard delete, mirrors the clients/departments/
--     compliance_types/fee_masters precedent. No DELETE RLS policy at all
--     (not even a partner-only one) — stricter than udin_register's
--     unused-but-present DELETE policy, because a DSC custody record is
--     closer to clients/departments in spirit (an ongoing operational
--     register you retire, not a point-in-time historical certificate like a
--     UDIN entry) — see the RLS section below for the explicit call-out.
--   - last_expiry_alert_tier / last_expiry_alert_sent_for_expiry: idempotency
--     state for the expiry-reminder extension to /api/cron/send-reminders,
--     living directly on the row rather than a new table (Ph10/Ph11's no-
--     new-table house style, applied here as real columns since — unlike
--     those phases — this migration isn't under a no-migration constraint).
--     Storing sent_for_expiry alongside the tier (not just the tier alone)
--     makes a DSC renewal automatically re-arm future alerts: if expires_on
--     moves forward, the stored (tier, expiry) pair from the last send no
--     longer matches, so the next qualifying tier fires again on its own —
--     no reset trigger needed.
--
-- ----------------------------------------------------------------------------
-- Design notes — dsc_custody_movements
-- ----------------------------------------------------------------------------
--   - Shape mirrors task_stage_history deliberately: from_custodian_id /
--     to_custodian_id echo from_stage/to_stage, recorded_by echoes
--     changed_by. Same append-only spirit: NO INSERT/UPDATE/DELETE RLS
--     policy on this table at all — the only writer is the AFTER UPDATE
--     trigger on dsc_register (SECURITY DEFINER), exactly how
--     task_stage_history is written only by its own trigger.
--   - Unlike task_stage_history, `note` here IS writable — task_stage_history
--     .note being unwritable from the app is a known, flagged debt item
--     (project_context.md §6 / docs/ROADMAP.md Phase 14) precisely because
--     nothing in that trigger's design threads a note through. This table
--     avoids reproducing that gap from day one: the note travels through the
--     new record_dsc_movement() RPC below via a transaction-local
--     set_config() call, read back by the same AFTER UPDATE trigger within
--     the same statement's transaction. A direct raw UPDATE on
--     current_custodian_id (bypassing the RPC) still gets logged by the
--     trigger — just without a note, which is a strictly safe degrade, not a
--     silent failure.
--   - dsc_id ON DELETE CASCADE (unlike task_stage_history's task_id, which is
--     also CASCADE): a movement row is meaningless without its DSC and this
--     is a purely internal operational log, not itself a statutory record —
--     same precedent, not a new one.
--
-- ----------------------------------------------------------------------------
-- Permission gating — RECOMMENDATION, presented for Jay's decision, not
-- decided unilaterally. See the session's chat for the explicit question;
-- summarized here for the historical record this migration file becomes:
-- ----------------------------------------------------------------------------
--   - SELECT (read the whole register): gated on the EXISTING clients.view
--     permission (partner bypass as normal via has_permission(), no new
--     permission-catalog key) — REVISED from an initial draft that used bare
--     is_firm_staff() (any staff, unconditionally). That draft was wrong: an
--     employee with clients.view explicitly revoked (a real, tested
--     configuration — see rls-smoke.mjs's E2 case) must not be able to read
--     dsc_register.client_id / holder_name either, since both are client-
--     identifying data, exactly the data clients.view already exists to
--     gate. This is narrower than the original "operational, every staff
--     member needs it" framing but consistent with how the rest of this
--     schema treats client-identifying data — clients.view is the one
--     permission key that already means "may see which client this row
--     belongs to," so reusing it here (rather than inventing a new key) is
--     the correct, minimal fix. An employee who can't see clients also can't
--     see whose DSC a given row is, or record a movement on it (see below).
--   - INSERT / UPDATE (full record edit — holder, expiry, class, storage
--     location, is_active, etc.): PARTNER-ONLY at the RLS layer itself
--     (get_user_role() = 'partner', no permission-catalog key) — mirrors
--     udin_register's identical write-gating choice from migration 007.
--   - Custody movements (check-out / check-in): NOT gated through a broader
--     UPDATE RLS policy at all. Instead, a single narrow SECURITY DEFINER
--     RPC (record_dsc_movement(), below) is the only path any non-partner
--     staff member can use to change current_custodian_id — gated on the
--     SAME clients.view permission as the SELECT policies above (a staff
--     member who cannot see a client cannot record a movement on that
--     client's DSC either; consistent, not a second independent rule). This
--     was chosen over an alternative design (a broad "any staff can UPDATE"
--     RLS policy plus a BEFORE UPDATE guard trigger freezing every column
--     except current_custodian_id for non-partners, the same shape as
--     guard_firm_invoice's column-freeze pattern) because:
--       (a) it needed no new RLS UPDATE policy at all — dsc_register's
--           UPDATE policy stays simple and partner-only, identical in shape
--           to udin_register's;
--       (b) it is the SAME architectural pattern already proven in this
--           schema for "a narrow, validated write an ordinary policy is too
--           blunt to express" — create_notification() (flag F7 fix) and
--           get_client_assigned_contact() (Phase 11) are both exactly this
--           shape: SECURITY DEFINER, manual same-firm validation, no
--           permission-catalog key;
--       (c) it solves the note-writability problem (above) as a side effect,
--           for free, rather than needing a second mechanism.
--     No new permission-catalog key is introduced anywhere in this migration
--     — every read and write gate reuses the existing clients.view (reads +
--     movements) or a bare partner role check (full-record writes). The
--     alternative (a new dsc.manage-style key, paired the way
--     billing.manage pairs with billing.view) remains available later if a
--     firm ever needs to delegate full DSC-record editing to non-partner
--     staff — deliberately not built preemptively, same stance udin_register
--     took on a hypothetical compliance.manage key.
--
-- ----------------------------------------------------------------------------
-- Client isolation
-- ----------------------------------------------------------------------------
-- Staff-internal only, by design — mirrors udin_register exactly. No
-- /portal surface, no DEFINER view, no RPC side door for client_users:
--   - has_permission('clients.view') returns false for client_user
--     (has_permission() short-circuits to false for any role that isn't
--     'partner'/'employee', before ever consulting user_permissions), so
--     BOTH the SELECT policy on dsc_register and the SELECT policy on
--     dsc_custody_movements already exclude clients before checking
--     anything else.
--   - record_dsc_movement() explicitly re-checks has_permission('clients.view')
--     itself (it is SECURITY DEFINER and therefore bypasses table RLS by
--     default, so it cannot rely on the SELECT/UPDATE policies to do this
--     for it) — a client_user calling this RPC directly gets RAISE
--     EXCEPTION, not an empty result.
--   - No FK, view, or column anywhere in this migration references clients
--     in a way a client_user's own RLS could traverse into dsc_register —
--     the only relationship is dsc_register.client_id -> clients.id, read
--     from the dsc_register side, which clients can never SELECT into.
-- To be walked through role-by-role with Jay before this migration is
-- applied, the same way udin_register's isolation was verified twice
-- (migration 007's header) — not just asserted here.
--
-- ----------------------------------------------------------------------------
-- Expiry alerts (application code, not part of this migration's DDL)
-- ----------------------------------------------------------------------------
-- Extends the EXISTING /api/cron/send-reminders route (already CRON_SECRET-
-- gated, service-role, loops every firm, safe to re-run daily) with a third
-- sweep — sendDscExpiryAlerts() — rather than a new cron route. Tiers/
-- idempotency described above (last_expiry_alert_tier /
-- last_expiry_alert_sent_for_expiry columns). Built in the follow-up app-
-- layer commit, after this migration is applied.
--
-- ----------------------------------------------------------------------------
-- Safety notes
-- ----------------------------------------------------------------------------
--   - Zero behavior change for any existing table or row — every object in
--     this migration is new.
--   - No existing RLS policy is touched. No existing table is dropped or
--     narrowed.
--   - Not written to be idempotent (matches this project's existing
--     migration style) — intended to run ONCE.
--   - Apply as a single transaction (BEGIN/COMMIT, or the Supabase SQL
--     editor's implicit transaction).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- dsc_register
-- ----------------------------------------------------------------------------

CREATE TABLE public.dsc_register (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                         UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id                       UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  holder_name                     TEXT NOT NULL CHECK (length(trim(holder_name)) > 0),
  holder_designation              TEXT,
  issuing_authority               TEXT NOT NULL CHECK (length(trim(issuing_authority)) > 0),
  dsc_class                       TEXT NOT NULL CHECK (length(trim(dsc_class)) > 0),
  serial_number                   TEXT NOT NULL CHECK (length(trim(serial_number)) > 0),
  issued_on                       DATE,
  expires_on                      DATE NOT NULL,
  current_custodian_id            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  physical_storage_location       TEXT,
  is_active                       BOOLEAN NOT NULL DEFAULT true,
  notes                           TEXT,
  last_expiry_alert_tier          TEXT,
  last_expiry_alert_sent_for_expiry DATE,
  created_by                      UUID NOT NULL REFERENCES public.profiles(id),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (firm_id, issuing_authority, serial_number)
);

CREATE INDEX idx_dsc_register_firm       ON public.dsc_register(firm_id);
CREATE INDEX idx_dsc_register_client     ON public.dsc_register(client_id);
CREATE INDEX idx_dsc_register_custodian  ON public.dsc_register(current_custodian_id) WHERE current_custodian_id IS NOT NULL;
CREATE INDEX idx_dsc_register_expires_on ON public.dsc_register(expires_on) WHERE is_active;

CREATE TRIGGER on_dsc_register_updated
  BEFORE UPDATE ON public.dsc_register
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- dsc_custody_movements — append-only, trigger-only-writable (see header)
-- ----------------------------------------------------------------------------

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

CREATE INDEX idx_dsc_movements_firm ON public.dsc_custody_movements(firm_id);
CREATE INDEX idx_dsc_movements_dsc  ON public.dsc_custody_movements(dsc_id);

-- ----------------------------------------------------------------------------
-- Movement logging trigger — the sole writer of dsc_custody_movements.
-- GUARDED TWICE against firing on unrelated updates (e.g. the expiry-alert
-- cron writing last_expiry_alert_tier/last_expiry_alert_sent_for_expiry on
-- this same table): the WHEN clause on the trigger itself means the function
-- body isn't even invoked unless current_custodian_id changed, and the
-- function body repeats the same IS DISTINCT FROM check as defense in depth.
-- Creation with a NULL initial custodian logs nothing; that's correct —
-- there's no "movement" to record for a token that has never left the
-- register.
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- record_dsc_movement() — the validated entry point ANY staff member who can
-- see this client (has_permission('clients.view'), partner bypass as
-- normal) uses to check a DSC out to a custodian or check it back in.
-- SECURITY DEFINER so it can perform the UPDATE regardless of dsc_register's
-- own (partner-only) UPDATE RLS policy — but it re-validates the SAME
-- clients.view gate the SELECT policy below uses, plus same-firm scoping and
-- custodian eligibility, before touching anything. This check is not
-- optional: SECURITY DEFINER bypasses RLS entirely, so this function body is
-- the ONLY thing standing between a raw RPC call and an unauthorized custody
-- change — same shape as create_notification() and
-- get_client_assigned_contact() above in this schema, where the manual
-- in-body check is similarly load-bearing, not a redundant belt-and-braces
-- check on top of RLS.
-- ----------------------------------------------------------------------------

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

  -- Transaction-local; read back by log_dsc_custody_movement() below within
  -- this same statement's transaction. Cleared automatically at COMMIT.
  PERFORM set_config('app.dsc_movement_note', COALESCE(p_note, ''), true);

  UPDATE public.dsc_register
  SET current_custodian_id = p_new_custodian_id
  WHERE id = p_dsc_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

ALTER TABLE public.dsc_register           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dsc_custody_movements  ENABLE ROW LEVEL SECURITY;

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

-- Deliberately NO DELETE policy at all (stricter than udin_register's
-- unused-but-present partner DELETE policy) — retire via is_active, mirrors
-- the clients/departments precedent exactly, no exception carved out here.

CREATE POLICY "Clients.view holders can view DSC custody movements"
  ON public.dsc_custody_movements FOR SELECT TO authenticated
  USING (firm_id = public.get_user_firm_id() AND public.has_permission('clients.view'));

CREATE POLICY "Super admins can view all DSC custody movements"
  ON public.dsc_custody_movements FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- No INSERT/UPDATE/DELETE policy on dsc_custody_movements at all — the
-- AFTER UPDATE trigger above (log_dsc_custody_movement, SECURITY DEFINER)
-- is the only writer, exactly like task_stage_history.

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.record_dsc_movement(UUID, UUID, TEXT);
-- DROP TRIGGER IF EXISTS record_dsc_custody_movement ON public.dsc_register;
-- DROP FUNCTION IF EXISTS public.log_dsc_custody_movement();
-- DROP TABLE IF EXISTS public.dsc_custody_movements;
-- DROP TABLE IF EXISTS public.dsc_register;
-- COMMIT;
--
-- Dropping either table loses any DSC/custody data recorded between apply
-- and rollback — no other table holds a copy.
-- ============================================================================
