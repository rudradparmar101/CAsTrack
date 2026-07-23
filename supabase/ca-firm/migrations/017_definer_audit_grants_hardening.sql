-- ============================================================================
-- Migration 017 — Phase 14.2, consolidated close-out: SECURITY DEFINER
-- consistency fix + default-privileges hardening (the last two open items
-- from Phase 14.2's original scope, plus the systemic SECURITY DEFINER
-- audit's one non-exploit finding)
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ✅ APPLIED 2026-07-23 — confirmed clean in Supabase Studio by Jay:
-- anon_table_grants = 0, authenticated TRUNCATE/TRIGGER/REFERENCES grants =
-- 0, enforce_task_assignment_permission prosecdef = true, ensure_rls event
-- trigger updated. Folded into schema.sql in the same session per the
-- migration convention (project_context.md header block / docs/DECISIONS.md)
-- — this fold ALSO added rls_auto_enable()/ensure_rls to schema.sql for the
-- first time (§9.8), since it existed live but was never in the greenfield
-- source of truth before this migration touched it.
--
-- The ENTIRE file is wrapped in one BEGIN;...COMMIT; block. Postgres DDL is
-- transactional: if ANY statement below fails, the WHOLE migration rolls
-- back atomically and the database is left exactly as it was before this
-- migration ran — there is no partial-application state to clean up or
-- reason about.
--
-- ============================================================================
-- PART 1 — SECURITY DEFINER audit result (Part A, full details in
-- project_context.md §4.24 and the commit message): a fresh enumeration of
-- EVERY SECURITY DEFINER function in the live schema via pg_proc (not a
-- remembered list) found NO further cross-tenant violations beyond the
-- already-fixed F0/F1-RPC. Every other function taking a caller-supplied
-- identifier was probed directly (cross-firm caller, client_user, and/or a
-- permission-less employee) and correctly rejects or resolves false/empty:
-- can_access_document, client_can_access_task, create_notification,
-- employee_has_task_for_client, get_client_assigned_contact,
-- lookup_client_invitation, lookup_firm_by_invite_code, profile_in_my_firm,
-- record_dsc_movement, staff_can_access_task. issue_firm_invoice is
-- SECURITY INVOKER by deliberate design (RLS governs it directly) and is
-- correctly out of this audit's scope.
--
-- ONE consistency finding, NOT an exploit: enforce_task_assignment_
-- permission() (migrations 014-016) was never declared SECURITY DEFINER --
-- every other trigger function in this schema is. Not exploitable today,
-- confirmed two ways: (a) profiles/departments SELECT RLS already grants
-- ANY staff member firm-wide read visibility ("Firm staff can view
-- profiles/departments in their firm", no department-membership
-- restriction), so the function's own `p.firm_id = NEW.firm_id` /
-- `d.firm_id = NEW.firm_id` predicates are what enforce correctness,
-- independent of how broad or narrow that underlying RLS happens to be --
-- and (b) it is not directly RPC-callable at all: PostgREST's schema cache
-- structurally excludes RETURNS TRIGGER functions (confirmed empirically --
-- calling it via rpc() returns "Could not find the function ... in the
-- schema cache"). Upgraded here anyway, for consistency with every other
-- trigger function in this schema and to remove the implicit dependency on
-- profiles/departments RLS staying exactly this broad forever.
-- ============================================================================
--
-- ============================================================================
-- PART 2 — Default-privileges audit result (Part A2, full list in
-- project_context.md §4.24): EVERY table and view in the public schema --
-- not just client_outstanding, which is the only one previously flagged --
-- has full GRANT (DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE)
-- to BOTH anon and authenticated. Root cause confirmed via pg_default_acl:
-- this is Supabase's own project-level default ACL (set for roles
-- `postgres` and `supabase_admin` in schema public at project creation),
-- not something this project's own migrations added per-object -- every new
-- table has inherited it automatically at CREATE TABLE time.
--
-- NOT exploitable today, confirmed empirically, not assumed: zero RLS
-- policies in this entire schema target `anon` or `PUBLIC` (every single
-- policy is `TO authenticated` only, confirmed via pg_policies) -- and a
-- pure anon-key client with NO signed-in session gets ZERO rows on SELECT
-- and an explicit RLS-violation error on INSERT against every table tested
-- (clients, firm_invoices, profiles, receipts, tasks, client_outstanding,
-- firms). RLS default-denies anon correctly everywhere; the over-broad
-- GRANT is a least-privilege hygiene gap, not a live hole.
--
-- ONE latent risk worth flagging even though it is not reachable through
-- Supabase's normal client access surface (the REST/RPC API, which is what
-- every RLS policy in this project governs): TRUNCATE is NOT filtered by
-- RLS at all -- Postgres RLS only applies to SELECT/INSERT/UPDATE/DELETE.
-- Granting TRUNCATE to `authenticated` (or `anon`) means a raw-SQL
-- connection authenticated as that Postgres role could empty an entire
-- table, firm-wide, with RLS providing zero protection. Not reachable via
-- PostgREST (which never exposes TRUNCATE), and requires direct database
-- credentials rather than an app-level JWT -- a different threat model than
-- everything else this Phase 14 sweep has tested -- but there is no reason
-- `authenticated`/`anon` need TRUNCATE, TRIGGER, or REFERENCES at runtime,
-- so this migration revokes them as a straightforward defense-in-depth
-- measure. SELECT/INSERT/UPDATE/DELETE for `authenticated` are UNTOUCHED --
-- those are exactly what RLS governs and the app needs them.
--
-- FIX, in two parts:
--  (a) One-time REVOKE on every EXISTING table and view (client_outstanding
--      included -- "ALL TABLES IN SCHEMA" REVOKE syntax covers views too).
--  (b) Extend the existing rls_auto_enable() event trigger (which already
--      auto-enables RLS on every newly created table, regardless of which
--      role ran CREATE TABLE, via its own SECURITY DEFINER context) to ALSO
--      revoke anon's default grant and trim authenticated's TRUNCATE/
--      TRIGGER/REFERENCES on every FUTURE table, so this gap cannot recur
--      the same way migration 006's stale-header gap or F0/F1-RPC's missing
--      ownership checks recurred before a standing mechanism existed. This
--      reuses an EXISTING, already-proven automation mechanism rather than
--      introducing a second, parallel one (e.g. ALTER DEFAULT PRIVILEGES
--      for multiple roles, which risks a partial-privilege failure this
--      project cannot fully verify via read-only MCP access). Deliberately
--      scoped to TABLES only, matching rls_auto_enable()'s existing scope --
--      this project's house convention for new VIEWS is an explicit REVOKE
--      written directly in the migration that creates them (see migrations
--      004/005), which is unchanged by this migration.
-- ============================================================================

BEGIN;

-- PART 1: SECURITY DEFINER consistency fix (enforce_task_assignment_permission)
-- Function body is UNCHANGED from migration 016 -- only SECURITY DEFINER is
-- added. The trigger definition itself (BEFORE INSERT OR UPDATE) is
-- untouched by a CREATE OR REPLACE FUNCTION, so no DROP/CREATE TRIGGER is
-- needed here.
CREATE OR REPLACE FUNCTION public.enforce_task_assignment_permission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    IF auth.uid() IS NOT NULL THEN  -- service role / SQL editor bypasses the permission gate only
      IF NOT public.has_permission('tasks.assign') THEN
        RAISE EXCEPTION 'You do not have permission to reassign this task';
      END IF;
    END IF;
  END IF;

  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.assigned_to AND p.firm_id = NEW.firm_id
    ) THEN
      RAISE EXCEPTION 'assigned_to must be a member of the same firm as the task';
    END IF;
  END IF;

  IF NEW.reviewer_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.reviewer_id AND p.firm_id = NEW.firm_id
    ) THEN
      RAISE EXCEPTION 'reviewer_id must be a member of the same firm as the task';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = NEW.department_id AND d.firm_id = NEW.firm_id
    ) THEN
      RAISE EXCEPTION 'department_id must belong to the same firm as the task';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- PART 2a: one-time revoke on every EXISTING table and view.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;

-- PART 2b: extend rls_auto_enable() so every FUTURE table gets the same
-- treatment automatically, regardless of which role runs CREATE TABLE
-- (matches this function's own existing SECURITY DEFINER, schema-public-only
-- scope -- only the two new EXECUTE lines inside the existing loop are new).
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
      BEGIN
        EXECUTE format('revoke all privileges on %s from anon', cmd.object_identity);
        EXECUTE format('revoke truncate, trigger, references on %s from authenticated', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: revoked anon grants / trimmed authenticated grants on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to revoke default grants on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.enforce_task_assignment_permission()
-- RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
-- BEGIN
--   IF TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
--     IF auth.uid() IS NOT NULL THEN
--       IF NOT public.has_permission('tasks.assign') THEN
--         RAISE EXCEPTION 'You do not have permission to reassign this task';
--       END IF;
--     END IF;
--   END IF;
--   IF NEW.assigned_to IS NOT NULL
--      AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
--     IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.assigned_to AND p.firm_id = NEW.firm_id) THEN
--       RAISE EXCEPTION 'assigned_to must be a member of the same firm as the task';
--     END IF;
--   END IF;
--   IF NEW.reviewer_id IS NOT NULL
--      AND (TG_OP = 'INSERT' OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id) THEN
--     IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.reviewer_id AND p.firm_id = NEW.firm_id) THEN
--       RAISE EXCEPTION 'reviewer_id must be a member of the same firm as the task';
--     END IF;
--   END IF;
--   IF TG_OP = 'INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id THEN
--     IF NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = NEW.department_id AND d.firm_id = NEW.firm_id) THEN
--       RAISE EXCEPTION 'department_id must belong to the same firm as the task';
--     END IF;
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
--
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon;
-- GRANT TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public TO authenticated;
--
-- CREATE OR REPLACE FUNCTION public.rls_auto_enable()
-- RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
-- DECLARE cmd record;
-- BEGIN
--   FOR cmd IN
--     SELECT * FROM pg_event_trigger_ddl_commands()
--     WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
--       AND object_type IN ('table','partitioned table')
--   LOOP
--      IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
--       BEGIN
--         EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
--       EXCEPTION WHEN OTHERS THEN NULL;
--       END;
--      END IF;
--   END LOOP;
-- END;
-- $$;
-- COMMIT;
--
-- Rolling back RESTORES: (1) enforce_task_assignment_permission() as
-- SECURITY INVOKER (functionally equivalent today, per the analysis above --
-- this is a hardening rollback, not a functional regression); (2) anon's
-- blanket grants on every table/view, and authenticated's TRUNCATE/TRIGGER/
-- REFERENCES grants; (3) rls_auto_enable() without the grant-hardening
-- addition, so future tables would silently regain anon's default over-grant.
-- Only do this to re-diagnose, never as a standing state.
-- ============================================================================
