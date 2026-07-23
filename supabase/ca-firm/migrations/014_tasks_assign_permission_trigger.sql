-- ============================================================================
-- Migration 014 — Phase 14.2, finding F4 (MEDIUM): give tasks.assign a real
-- RLS-layer enforcement point
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ⚠ NOT YET APPLIED — drafted for Jay's review in Supabase Studio. Do not
-- apply via MCP or any automated path; this is a manual-apply-only gate,
-- same as every migration before it (001–013). Per the migration convention
-- (project_context.md header block / docs/DECISIONS.md): once applied and
-- confirmed, THIS FILE'S OWN HEADER must be updated to APPLIED <date> in the
-- same session that folds it into schema.sql.
--
-- Found by: docs/verification/phase-14-rls-sweep.md, finding F4 — check #58.
-- `tasks.assign` is a real key in the permissions catalog ("Assign/reassign
-- tasks to employees") but no RLS policy anywhere references it. Reassignment
-- (changing assigned_to) currently rides entirely on
-- "Department updaters can update department tasks" (tasks.update_department
-- + department membership), which is meant to be a broad "update any task in
-- own departments" permission ("Update any task in own departments (not just
-- assigned)" per its own catalog description) — not an assignment-specific
-- gate. Empirically confirmed live: E0, with tasks.assign explicitly REVOKED
-- and only tasks.update_department explicitly GRANTED, successfully changed
-- assigned_to on a department task she was not even the assignee of.
-- updateTaskAssignmentAction() (src/app/(dashboard)/tasks/actions.ts) already
-- checks has_permission('tasks.assign') at the app layer before touching this
-- column — the gap is that RLS has no matching enforcement, so a direct
-- RPC/PostgREST call bypassing the app layer (or any other UPDATE path that
-- happens to touch assigned_to) is unprotected.
--
-- DECISION (Jay, 2026-07-23): add a real RLS-layer enforcement point, not
-- formally accept tasks.update_department as sufficient and correct the
-- docs/catalog instead. tasks.assign should mean what its name and catalog
-- description say.
--
-- WHY A TRIGGER, NOT A FOURTH RLS POLICY: Postgres RLS policies are
-- row-scoped, not column-scoped — a USING/WITH CHECK clause can decide
-- whether an UPDATE on this ROW is allowed at all, but cannot say "this
-- policy may change department_id but not assigned_to." The existing
-- "Department updaters" policy is intentionally broad (any column, any
-- department task) — narrowing it there would break its own intended scope
-- (updating stage/status/dates/etc. on a department task, which correctly
-- needs no tasks.assign). This project already has an established pattern
-- for exactly this shape of problem — column-level protection that RLS alone
-- cannot express — in enforce_profile_protected_fields() (§9.2, migration
-- 001/DeadlineTracker-era fix) and guard_firm_invoice's frozen-column list.
-- This migration adds the same kind of BEFORE UPDATE trigger, scoped to the
-- one column tasks.assign is meant to gate.
--
-- has_permission('tasks.assign') ALONE is sufficient inside the check — no
-- separate partner/is_super_admin branch is needed, because has_permission()
-- already resolves true for both internally (its own pre-existing
-- "super_admin -> true" / "partner -> true" branches, migration-006-era
-- comment above its definition) — a partner or super admin reassigning a
-- task always passes.
--
-- auth.uid() IS NULL is the correct, unambiguous "service role / SQL editor"
-- signal HERE (unlike migration 010/011's SECURITY DEFINER RPCs, which used
-- auth.role() = 'service_role' instead): this is a BEFORE UPDATE TRIGGER on
-- a table whose every UPDATE policy is "TO authenticated" only — an anon-key
-- caller with no session can never pass RLS to reach this trigger at all
-- (anon holds no UPDATE grant on tasks whatsoever), so the auth.uid() IS
-- NULL / anon-with-no-session ambiguity that motivated auth.role() in
-- those migrations does not exist for a trigger gated behind a
-- TO-authenticated-only policy set. This exact reasoning, and this exact
-- signal, already match the precedent in enforce_profile_protected_fields()
-- (§9.2) — reused here rather than introducing a third convention.
--
-- No regression for the legitimate path: updateTaskAssignmentAction() already
-- checks has_permission('tasks.assign') before ever issuing the UPDATE, so
-- every real assignment change made through the app already satisfies this
-- trigger trivially. Every OTHER column tasks.update_department is meant to
-- cover (stage/status/dates/department_id itself/etc.) is untouched — this
-- trigger only fires when assigned_to specifically changes.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_task_assignment_permission()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- service role / SQL editor
    IF NOT public.has_permission('tasks.assign') THEN
      RAISE EXCEPTION 'You do not have permission to reassign this task';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER enforce_task_assignment
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_task_assignment_permission();

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS enforce_task_assignment ON public.tasks;
-- DROP FUNCTION IF EXISTS public.enforce_task_assignment_permission();
-- COMMIT;
--
-- Rolling back RESTORES the gap this migration closes (F4 — tasks.assign has
-- no RLS-layer enforcement at all, so an employee with tasks.update_department
-- alone can reassign any department task regardless of tasks.assign) — only
-- do this to re-diagnose, never as a standing state.
-- ============================================================================
