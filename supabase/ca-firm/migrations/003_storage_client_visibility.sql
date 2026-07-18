-- ============================================================================
-- Migration 003 — Storage client-visibility fix (portal-isolation finding #7)
-- Target: the LIVE Praxida Supabase project (fwmmdyebvzncpezdwnxm).
-- STATUS: Applied 2026-07-16 — applied live to project fwmmdyebvzncpezdwnxm,
--         verified in force via pg_policies. Folded into schema.sql alongside
--         this file (same convention as migrations 001/002).
--
-- WHY -----------------------------------------------------------------------
-- docs/verification/portal-isolation.md finding #7: the storage SELECT policy
-- "Client users can read their own client's files" gated ONLY on the client_id
-- path segment ((storage.foldername(name))[2]) and never joined back to
-- public.documents. A portal user, using their own JWT against the Storage API
-- directly, could therefore:
--   * DOWNLOAD the bytes of documents under their own client folder that are
--     visible_to_client = false and/or approval_status = 'pending' (staff-only
--     workpapers / drafts), and mint signed URLs for them; and
--   * LIST their client folder to enumerate the exact document_id sub-folder
--     and object filename, defeating the random-UUID path "secrecy".
-- The public.documents / public.document_versions TABLE policies correctly hid
-- these rows (via can_access_document()); only the STORAGE layer disagreed, and
-- storage is the authoritative store of the actual bytes.
--
-- DECISION (made outside this migration): storage MUST mirror the table-layer
-- curated view. RLS is the authority; app-generated signed URLs are NOT an
-- acceptable sole gate.
--
-- WHAT THIS CHANGES ---------------------------------------------------------
-- Rewrites the ONE client SELECT policy to reuse can_access_document() as the
-- single source of truth for document access, applied to the document_id path
-- segment ((storage.foldername(name))[3] — path is {firm}/{client}/{doc}/{uuid}).
-- Because the acting user is a client_user, can_access_document()'s staff branch
-- is inert and the check reduces to exactly the curated client predicate it
-- already enforces on public.documents:
--     d.client_id = get_user_client_id()
--     AND d.visible_to_client
--     AND (d.uploaded_by = auth.uid() OR d.approval_status IN ('approved','rejected'))
--
-- This governs BOTH download and list/enumeration: Supabase's list() queries
-- storage.objects under this same SELECT policy, so objects that fail it are
-- neither listable nor downloadable (verified conceptually; re-verification is
-- a separate testing session).
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE ------------------------------------
--   * "Staff can read their firm's document files" (partner + employee reads):
--     NOT touched. Partner/employee storage access is unchanged — they satisfy
--     the staff SELECT policy, never this client policy (the get_user_role() =
--     'client_user' guard makes this policy contribute nothing for staff).
--   * INSERT/DELETE storage policies: NOT touched.
--   * can_access_document() itself: NOT touched (document_versions policies and
--     the documents-table rules share it — reused, not duplicated or forked).
--
-- CAST SAFETY ---------------------------------------------------------------
-- The client INSERT policy validates only path segments [1]/[2], so segment [3]
-- is attacker-controlled: a client could upload an object named
-- {firm}/{client}/not-a-uuid/x. A bare ((...)[3])::uuid would raise inside the
-- policy on such an object (SQL does not guarantee the role/regex guard is
-- evaluated before the cast). A CASE expression is used because its
-- non-selected THEN branch is guaranteed NOT to be evaluated: the cast happens
-- only when segment [3] strictly matches the UUID shape, otherwise the argument
-- is NULL and can_access_document(NULL) is false. No object name can error the
-- policy or widen access.
--
-- PERFORMANCE ---------------------------------------------------------------
-- Per storage object evaluated (one on download; N on a folder list), the
-- policy adds, for client_users only: a foldername() array split + a bounded
-- 36-char regex match + one can_access_document() call, which is a single
-- EXISTS on public.documents by PRIMARY KEY (documents.id) — an index lookup,
-- no sequential scan. A list of N objects is N such PK lookups: linear and
-- negligible at realistic per-client object counts. For staff/partner the
-- get_user_role() guard yields false without touching the join. Net added cost
-- vs. the old policy is one indexed PK lookup per object for client reads.
--
-- Not written to be idempotent beyond the DROP ... IF EXISTS (matches this
-- project's migration style); intended to run ONCE. Apply as one transaction.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Client users can read their own client's files" ON storage.objects;

CREATE POLICY "Client users can read their own client's files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND public.get_user_role() = 'client_user'
    -- Reuse the table-layer access predicate on the document_id path segment
    -- ({firm}/{client}/{document_id}/{uuid}); CASE keeps the ::uuid cast safe
    -- against attacker-controlled (client-uploadable) segment-[3] values.
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
-- ROLLBACK (reviewed, NOT run) — restores the pre-fix (vulnerable) policy:
--
-- BEGIN;
-- DROP POLICY IF EXISTS "Client users can read their own client's files" ON storage.objects;
-- CREATE POLICY "Client users can read their own client's files"
--   ON storage.objects FOR SELECT TO authenticated
--   USING (
--     bucket_id = 'client-documents'
--     AND (storage.foldername(name))[2] = public.get_user_client_id()::text
--   );
-- COMMIT;
--
-- NOTE: rolling back reopens finding #7. Do not roll back on the live project
-- without re-flagging the isolation gap.
-- ============================================================================
