-- ============================================================================
-- Migration 016 — Phase 14.2, follow-up finding (not in the original F0-F5
-- list): tasks.reviewer_id and tasks.department_id also have no firm-
-- membership validation
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ⚠ NOT YET APPLIED — drafted for Jay's review in Supabase Studio. Do not
-- apply via MCP or any automated path; this is a manual-apply-only gate,
-- same as every migration before it (001–015). Per the migration convention
-- (project_context.md header block / docs/DECISIONS.md): once applied and
-- confirmed, THIS FILE'S OWN HEADER must be updated to APPLIED <date> in the
-- same session that folds it into schema.sql.
--
-- Found while confirming migration 015's assigned_to fix, per Jay's explicit
-- ask to check whether the same class of bug existed on tasks' other two
-- profile/department FKs before moving past F4. Both do:
--
--  - reviewer_id: IDENTICAL exposure to assigned_to before migration 015 --
--    no check anywhere, on INSERT or UPDATE. Confirmed live: E0 created a
--    Firm A task with reviewer_id set to EVB (Firm B) on INSERT (succeeded),
--    and separately UPDATEd an EXISTING task's reviewer_id to EVB via the
--    department-updater policy alone, with no tasks.assign permission
--    check of any kind (also succeeded) -- reviewer_id was never gated by
--    tasks.assign even before this migration, unlike assigned_to.
--  - department_id: a related but narrower, PARTNER-ONLY gap. The employee
--    branch of "Task creators can create tasks in their departments"
--    (department_id = ANY(get_user_department_ids())) is implicitly
--    firm-safe, since department membership only ever grants own-firm
--    departments. But the partner branch bypasses that check entirely
--    (role = 'partner' OR department_id = ANY(...)), and nothing separately
--    validates department_id's firm match for a partner. Confirmed live: PA
--    created a task with firm_id = Firm A but department_id pointing at
--    Firm B's GST department, and it succeeded. The same gap exists on
--    UPDATE via "Partners can update any firm task", whose implicit
--    WITH CHECK (Postgres defaults it to the USING clause) checks role and
--    firm_id but never department_id's own firm match either.
--
-- FIX: extend enforce_task_assignment_permission() (migrations 014/015)
-- with two more unconditional, data-integrity checks -- same shape as
-- assigned_to's: reviewer_id (when non-null and being set) must belong to
-- NEW.firm_id; department_id (always required, so checked on every INSERT
-- and on every UPDATE that changes it) must belong to NEW.firm_id. Neither
-- new check touches the tasks.assign permission gate -- that question
-- (should reviewer_id assignment also require tasks.assign) is a separate,
-- not-yet-raised decision, out of scope for this migration, which is
-- data-integrity-only, matching exactly what was asked.
--
-- No regression: every legitimate task in this schema already has a
-- reviewer_id (or NULL) and a department_id belonging to its own firm --
-- nothing in the app ever constructs a cross-firm reference for either
-- column, so these checks only ever reject what was already a bug waiting
-- to happen. The function is kept as enforce_task_assignment_permission()
-- (not renamed) to avoid churn -- its scope has grown to cover all three
-- reference-validity concerns on tasks, documented in the comment above it.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_task_assignment_permission()
RETURNS TRIGGER AS $$
BEGIN
  -- Permission gate (migration 014): reassigning an EXISTING task requires
  -- tasks.assign. UPDATE-only — initial assignment via INSERT stays governed
  -- by tasks.create alone (a recorded decision, not an oversight).
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    IF auth.uid() IS NOT NULL THEN  -- service role / SQL editor bypasses the permission gate only
      IF NOT public.has_permission('tasks.assign') THEN
        RAISE EXCEPTION 'You do not have permission to reassign this task';
      END IF;
    END IF;
  END IF;

  -- Firm-membership validation (migration 015): assigned_to must reference a
  -- profile in the SAME firm as the task, whenever it is being set. Applies
  -- unconditionally, including to service-role writes.
  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.assigned_to AND p.firm_id = NEW.firm_id
    ) THEN
      RAISE EXCEPTION 'assigned_to must be a member of the same firm as the task';
    END IF;
  END IF;

  -- Firm-membership validation (migration 016): reviewer_id, same shape as
  -- assigned_to above. Data integrity, not a permission gate.
  IF NEW.reviewer_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.reviewer_id AND p.firm_id = NEW.firm_id
    ) THEN
      RAISE EXCEPTION 'reviewer_id must be a member of the same firm as the task';
    END IF;
  END IF;

  -- Firm-membership validation (migration 016): department_id is NOT NULL,
  -- so checked on every INSERT and every UPDATE that changes it. Closes the
  -- partner-only gap ("Partners can update any firm task" / the partner
  -- branch of the INSERT policy never validated this).
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
$$ LANGUAGE plpgsql SET search_path = public;

-- Trigger definition is unchanged (already BEFORE INSERT OR UPDATE as of
-- migration 015) — only the function body grew, so no DROP/CREATE TRIGGER
-- needed here.

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.enforce_task_assignment_permission()
-- RETURNS TRIGGER AS $$
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
--     IF NOT EXISTS (
--       SELECT 1 FROM public.profiles p
--       WHERE p.id = NEW.assigned_to AND p.firm_id = NEW.firm_id
--     ) THEN
--       RAISE EXCEPTION 'assigned_to must be a member of the same firm as the task';
--     END IF;
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql SET search_path = public;
-- COMMIT;
--
-- Rolling back RESTORES the ability to create/update a task with reviewer_id
-- or department_id referencing a DIFFERENT firm's profile/department, with
-- no error at all — only do this to re-diagnose, never as a standing state.
-- ============================================================================
