-- ============================================================================
-- Migration 012 — Phase 14.2, finding F2 (HIGH): scope the staff storage
-- SELECT policy to can_access_document(), same as the client-side policy
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- ⚠ NOT YET APPLIED — drafted for Jay's review in Supabase Studio. Do not
-- apply via MCP or any automated path; this is a manual-apply-only gate,
-- same as every migration before it (001–011). Per the migration convention
-- (project_context.md header block / docs/DECISIONS.md): once applied and
-- confirmed, THIS FILE'S OWN HEADER must be updated to APPLIED <date> in the
-- same session that folds it into schema.sql.
--
-- Found by: docs/verification/phase-14-rls-sweep.md, finding F2 —
-- scripts/verify/14-rls-sweep.mjs, checks #71/#74/#75. `"Staff can read their
-- firm's document files"` (the storage SELECT policy for staff) checked only
-- is_firm_staff() and a matching firm-id folder segment -- it never consulted
-- staff_can_access_task(), has_permission('clients.view'), or the documents
-- table at all. Empirically confirmed live: E0 was correctly DENIED at the
-- documents table layer for docInternalOtherDept (a document on a task in a
-- department she does not belong to), but the SAME E0 could download that
-- exact object's raw bytes from storage, and list its folder, via the
-- firm-wide staff storage policy every staff member shares. Architecturally
-- the same shape as the historical client-side portal-isolation.md #7 gap
-- (storage broader than the table layer it's supposed to mirror), on the
-- staff side instead of the client side.
--
-- DECISION (Jay, 2026-07-23): option (b) from the sweep's two choices --
-- rewrite the policy to actually enforce department/task scoping, not accept
-- and document the firm-wide reach as intentional. The schema.sql comment
-- calling this "the firm-wide defense-in-depth floor" for staff directly
-- contradicted the department-scoping model already documented and enforced
-- for the tasks/documents tables themselves, so this is a real gap to close,
-- not a deliberate design choice to record.
--
-- FIX: reuse can_access_document(document_id) -- the exact function the
-- client storage policy already calls, and the exact function the documents
-- table's own SELECT policy is built from -- on the document_id path segment
-- (segment [3] of the object path: {firm_id}/{client_id}/{document_id}/...).
-- can_access_document() already has a full staff branch internally (partner
-- sees everything; employee needs staff_can_access_task() for a task-linked
-- document, or clients.view/employee_has_task_for_client() for a task-less
-- one) -- this is not new logic, it is the SAME logic the documents table
-- already enforces, now also enforced at the storage layer. The is_firm_staff()
-- + firm-folder-segment check is KEPT (not removed) as an outer guard so a
-- malformed document_id segment still fails closed on a non-UUID string
-- (can_access_document(NULL) is false, same CASE-safe cast pattern the
-- client policy already uses) rather than depending on can_access_document()
-- alone to reject non-staff/cross-firm callers.
--
-- No regression for the legitimate path: a partner, or an employee whose
-- department/assignment already gives her staff_can_access_task() or
-- clients.view/employee_has_task_for_client() at the table layer, resolves
-- can_access_document() true for exactly the same documents she can already
-- see and download today -- this migration only removes access an employee
-- should never have had at the table layer either.
--
-- PATH PARSING (verified against schema.sql's own §12 comment and the client
-- policy already in production): the object path convention is
-- {firm_id}/{client_id}/{document_id}/{uuid}.{ext} -- storage.foldername(name)
-- is 1-indexed, so [1]=firm_id, [2]=client_id, [3]=document_id. This migration
-- uses index [3] for document_id, the SAME index the existing client storage
-- policy already uses (see "Client users can read their own client's files"
-- above it in schema.sql) -- not a new guess, a match against a path index
-- already live and correct in production. The same CASE-guarded regex-then-
-- cast is reused so a malformed/non-UUID segment [3] yields NULL rather than
-- a cast error, and can_access_document(NULL) is false -- fails closed, not
-- open, on a malformed path.
--
-- UPLOAD ORDERING (verified against src/lib/documents/actions.ts, not
-- assumed): both uploadDocumentAction() (new document) and
-- uploadDocumentVersionAction() (new version) create/read the documents row
-- BEFORE the storage.upload() call -- uploadDocumentAction INSERTs the
-- documents row as step 1 and only calls storage.upload() as step 2 with the
-- resulting doc.id; uploadDocumentVersionAction does an RLS-scoped SELECT on
-- documents (which only resolves if can_access_document() already holds) as
-- its very first step, before ever touching storage. So by the time either
-- flow reaches the storage write, the documents row exists AND the uploader
-- already satisfies can_access_document() for it (uploadDocumentAction's own
-- documents-table INSERT policy requires staff_can_access_task(task_id) for
-- a task-linked doc; uploadDocumentVersionAction's read literally cannot
-- succeed otherwise). Neither upload path writes the storage object first --
-- this migration's ordering dependency holds for both.
--
-- WRITE-SIDE SCOPING GAP -- found and fixed in the same migration: the
-- staff storage INSERT policy ("Staff can upload files under their firm")
-- has the IDENTICAL gap as the SELECT policy -- it checks only
-- is_firm_staff() + documents.upload + the firm-folder segment, never the
-- document_id segment. Without a fix, a staff member holding documents.upload
-- (but no department/task access to some OTHER document) could hand-craft an
-- object path using that other document's real UUID and successfully write
-- bytes into its folder -- an unauthorized-write / storage-pollution gap,
-- narrower than the SELECT finding (it doesn't itself leak a read, and it
-- can never produce a legitimate document_versions row, since that table's
-- own INSERT policy already calls can_access_document(document_id) and would
-- reject it) but still a real integrity gap: once this migration's SELECT fix
-- lands, whichever staff member legitimately CAN access that target document
-- would then see the injected orphan object via list()/download, since
-- bucket listing has no way to know a document_versions row doesn't
-- reference it. Fixed here with the same can_access_document(document_id)
-- check, added to the staff INSERT policy's WITH CHECK. The ordering
-- argument above applies identically -- can_access_document() already
-- resolves true for the uploader's own legitimate document by the time this
-- INSERT runs.
--
-- NOT changed, and no gap found: the storage DELETE policy ("Partners can
-- delete their firm's document files") is intentionally partner-only and
-- firm-wide with no document_id check -- consistent with every other partner
-- path in this schema (can_access_document's own partner branch, and
-- staff_can_access_task's, are unconditional "partner -> true"), not a
-- department-scoping gap. There is no storage UPDATE policy at all --
-- every revision is a brand-new object at a brand-new path (document_versions
-- is append-only), so there is nothing to scope. The client-side storage
-- INSERT policy is unchanged -- it is already scoped to the client's own
-- client_id folder segment, the tightest possible scope, with no
-- document_id-level ambiguity to close.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Staff can read their firm's document files" ON storage.objects;

CREATE POLICY "Staff can read their firm's document files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND public.is_firm_staff()
    AND (storage.foldername(name))[1] = public.get_user_firm_id()::text
    AND public.can_access_document(
          CASE
            WHEN (storage.foldername(name))[3] ~
                 '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN ((storage.foldername(name))[3])::uuid
          END
        )
  );

DROP POLICY IF EXISTS "Staff can upload files under their firm" ON storage.objects;

CREATE POLICY "Staff can upload files under their firm"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-documents'
    AND public.is_firm_staff()
    AND public.has_permission('documents.upload')
    AND (storage.foldername(name))[1] = public.get_user_firm_id()::text
    AND public.can_access_document(
          CASE
            WHEN (storage.foldername(name))[3] ~
                 '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN ((storage.foldername(name))[3])::uuid
          END
        )
  );

COMMIT;

-- ============================================================================
-- ROLLBACK (reviewed, NOT run):
--
-- BEGIN;
-- DROP POLICY IF EXISTS "Staff can read their firm's document files" ON storage.objects;
-- CREATE POLICY "Staff can read their firm's document files"
--   ON storage.objects FOR SELECT TO authenticated
--   USING (
--     bucket_id = 'client-documents'
--     AND public.is_firm_staff()
--     AND (storage.foldername(name))[1] = public.get_user_firm_id()::text
--   );
-- DROP POLICY IF EXISTS "Staff can upload files under their firm" ON storage.objects;
-- CREATE POLICY "Staff can upload files under their firm"
--   ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (
--     bucket_id = 'client-documents'
--     AND public.is_firm_staff()
--     AND public.has_permission('documents.upload')
--     AND (storage.foldername(name))[1] = public.get_user_firm_id()::text
--   );
-- COMMIT;
--
-- Rolling back RESTORES the firm-wide, department-blind staff storage read
-- AND write this migration closes (F2 -- any staff member could download/list
-- any document under their own firm's folder regardless of task/department
-- membership, and could write bytes into another document's folder the same
-- way) -- only do this to re-diagnose, never as a standing state.
-- ============================================================================
