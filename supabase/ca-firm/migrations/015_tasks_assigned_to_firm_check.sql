-- ============================================================================
-- Migration 015 — Phase 14.2, follow-up finding (not in the original F0-F5
-- list): tasks.assigned_to has no firm-membership validation at all
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ⚠ NOT YET APPLIED — drafted for Jay's review in Supabase Studio. Do not
-- apply via MCP or any automated path; this is a manual-apply-only gate,
-- same as every migration before it (001–014). Per the migration convention
-- (project_context.md header block / docs/DECISIONS.md): once applied and
-- confirmed, THIS FILE'S OWN HEADER must be updated to APPLIED <date> in the
-- same session that folds it into schema.sql.
--
-- Found while probing migration 014's F4 fix, not part of the original
-- sweep's F0-F5 list: `assigned_to UUID REFERENCES public.profiles(id)` has
-- NO check anywhere — not RLS, not a trigger — that the referenced profile
-- belongs to the SAME firm as the task. Empirically confirmed live: E0
-- (Firm A, holding tasks.create) created a brand-new Firm A task with
-- assigned_to set directly to EVB, a Firm B employee, and the INSERT
-- succeeded with no error. Migration 014's enforce_task_assignment trigger
-- only checks WHO may change assigned_to (tasks.assign); it says nothing
-- about whether the VALUE being assigned is even a valid target.
--
-- DECISION (Jay, 2026-07-23): fix now, in the same session, rather than
-- deferring to 14.1b — the tasks-assignment trigger is already open in
-- context from migration 014, and this is a genuine cross-tenant
-- data-integrity gap (a firm's task can point its assignee at a user who has
-- no relationship to that firm at all), not merely a missing nicety.
--
-- FIX: extend enforce_task_assignment_permission() (added in migration 014)
-- to also fire BEFORE INSERT (not just BEFORE UPDATE), and add a second,
-- independent check: whenever assigned_to is being SET (a fresh INSERT with
-- a non-null assigned_to, or an UPDATE that changes it), the referenced
-- profile must belong to NEW.firm_id. This is a DATA-INTEGRITY check, not a
-- permission gate — unlike the tasks.assign permission check (which
-- deliberately exempts auth.uid() IS NULL / service role), this check
-- applies unconditionally, including to service-role writes, because a
-- cross-firm assignee reference is never correct regardless of who writes
-- it. The permission-gate branch is UNCHANGED and stays UPDATE-only — this
-- migration does not touch the already-recorded decision that tasks.create
-- alone may set an initial assignee at INSERT time (see project_context.md
-- §4.22 / docs/DECISIONS.md); it only adds a same-firm VALIDITY check on top
-- of whatever permission already allowed the write.
--
-- No regression: every legitimate task in this schema already has an
-- assigned_to (or NULL) belonging to its own firm — nothing in the app ever
-- constructs a cross-firm assignee, so this check only ever rejects what
-- was already a bug waiting to happen.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_task_assignment_permission()
RETURNS TRIGGER AS $$
BEGIN
  -- Permission gate (migration 014, F4): reassigning an EXISTING task
  -- requires tasks.assign. UPDATE-only, unchanged by this migration — initial
  -- assignment via INSERT stays governed by tasks.create alone (a recorded
  -- decision, not an oversight; see project_context.md §4.22).
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    IF auth.uid() IS NOT NULL THEN  -- service role / SQL editor bypasses the permission gate only
      IF NOT public.has_permission('tasks.assign') THEN
        RAISE EXCEPTION 'You do not have permission to reassign this task';
      END IF;
    END IF;
  END IF;

  -- Firm-membership validation (migration 015): assigned_to must reference a
  -- profile in the SAME firm as the task, whenever it is being set (a fresh
  -- INSERT with a non-null assigned_to, or any UPDATE that changes it). A
  -- data-integrity check, not a permission gate — applies even to
  -- service-role writes.
  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.assigned_to AND p.firm_id = NEW.firm_id
    ) THEN
      RAISE EXCEPTION 'assigned_to must be a member of the same firm as the task';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS enforce_task_assignment ON public.tasks;

CREATE TRIGGER enforce_task_assignment
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_task_assignment_permission();

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.enforce_task_assignment_permission()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
--     IF auth.uid() IS NULL THEN RETURN NEW; END IF;
--     IF NOT public.has_permission('tasks.assign') THEN
--       RAISE EXCEPTION 'You do not have permission to reassign this task';
--     END IF;
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql SET search_path = public;
--
-- DROP TRIGGER IF EXISTS enforce_task_assignment ON public.tasks;
-- CREATE TRIGGER enforce_task_assignment
--   BEFORE UPDATE ON public.tasks
--   FOR EACH ROW EXECUTE FUNCTION public.enforce_task_assignment_permission();
-- COMMIT;
--
-- Rolling back RESTORES the ability to create/assign a task to a user
-- outside the task's own firm with no error at all — only do this to
-- re-diagnose, never as a standing state.
-- ============================================================================
