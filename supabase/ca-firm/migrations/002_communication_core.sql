-- ============================================================================
-- Migration 002 — Communication core (Phase 11)
-- Target: the LIVE CA Firm Manager Supabase project (fwmmdyebvzncpezdwnxm).
-- This is the DELTA to apply to the running database. NOT yet folded into
-- schema.sql — that happens after this is reviewed/approved and applied
-- (same order as migration 001 / Phase 9).
--
-- Adds two independent, additive pieces needed by Phase 11's checklist that
-- the rest of the phase (Resend wiring, reminder cron, client notification
-- surfacing, portal pagination) did NOT need a migration for:
--
--   1. tasks.checklist_items — per-task copy of a template's checklist,
--      staff-toggleable, client-readable. Needed so "surface template
--      checklist_items on portal tasks as per-item received/pending" is
--      actually visible to the client_user role: task_activities (which
--      Phase 10 used for filing outcomes to avoid a migration) is
--      STAFF-ONLY readable by RLS ("Immutable audit log... clients get
--      their curated view from tasks/documents" — schema.sql §7.4), so it
--      cannot carry client-visible state. A plain column on tasks, by
--      contrast, is already covered by the EXISTING tasks SELECT/UPDATE
--      policies (visible_to_client-gated read for clients; assignee/
--      department/partner-gated write for staff) — no new RLS needed.
--
--   2. get_client_assigned_contact(client_id) — SECURITY DEFINER RPC so the
--      portal can show "who is my contact at the firm" without a widened
--      profiles SELECT policy (which would let clients enumerate all staff
--      — explicitly ruled out in docs/ROADMAP.md Phase 11). Resolves to the
--      assignee of the client's most recently touched visible, non-archived
--      task, falling back to the firm's earliest active partner. Only the
--      client_user bound to the requested client_id gets a result — never a
--      lookup on another client, never usable by staff to enumerate anyone
--      (staff already have their own profiles-read path).
--
-- Safety notes:
--   - Zero behavior change for existing rows: checklist_items DEFAULTs to
--     '[]'::jsonb, NOT NULL is safe to add with a default on an existing
--     table (Postgres backfills in one pass, no rewrite lock beyond that).
--   - No existing RLS policy is touched. No existing table is dropped or
--     narrowed.
--   - Not written to be idempotent (matches this project's existing
--     migration style) — intended to run ONCE.
--   - Apply as a single transaction (BEGIN/COMMIT, or the Supabase SQL
--     editor's implicit transaction).
--
-- Rollback: see the bottom of this file (commented out, reviewed not run).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. tasks.checklist_items
-- ----------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN checklist_items JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.tasks.checklist_items IS
  'Per-task copy of the originating template''s checklist_items (Phase 11) — '
  'same {id, text, completed} shape as task_templates.checklist_items. Copied '
  'once at task creation (not synced afterward); staff toggle ''completed'' '
  '(rendered as received/pending); covered by the existing tasks SELECT/'
  'UPDATE RLS policies, no new policy needed.';

-- ----------------------------------------------------------------------------
-- 2. get_client_assigned_contact() — narrow SECURITY DEFINER RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_client_assigned_contact(p_client_id UUID)
RETURNS TABLE(name TEXT, email TEXT, phone TEXT, designation TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contact_id UUID;
  v_firm_id UUID;
BEGIN
  -- Only the client_user bound to THIS client may resolve their own contact.
  -- No lookup on someone else's client; not usable by staff.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'client_user' AND client_id = p_client_id
  ) THEN
    RETURN;
  END IF;

  -- Prefer the assignee of the most recently touched visible, active task.
  SELECT t.assigned_to INTO v_contact_id
  FROM public.tasks t
  WHERE t.client_id = p_client_id
    AND t.visible_to_client = true
    AND t.stage <> 'archived'
    AND t.assigned_to IS NOT NULL
  ORDER BY t.updated_at DESC
  LIMIT 1;

  -- Fallback: the firm's earliest-created active partner.
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

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.get_client_assigned_contact(UUID);
-- ALTER TABLE public.tasks DROP COLUMN IF EXISTS checklist_items;
-- COMMIT;
--
-- Dropping checklist_items loses any per-task received/pending state
-- recorded between apply and rollback (no other table holds a copy).
-- ============================================================================
