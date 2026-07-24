-- ============================================================================
-- Test-data cleanup for the PRODUCTION Supabase project (fwmmdyebvzncpezdwnxm)
-- ============================================================================
-- Generated 2026-07-24 by the pre-pilot readiness follow-up (Part C).
--
-- ⚠ REVIEW-ONLY. This file was NOT executed by the agent — not via MCP, not any
--   other way. Deleting from production is the same risk class as DDL. Run it
--   yourself, in the Supabase SQL Editor (Studio), as the postgres role, only
--   after you have read SECTION 1's dry-run output and are satisfied.
--
-- WHAT IT REMOVES
--   The firms (and everything cascading from them) that the committed
--   scripts/verify/*.mjs suite seeded into the live DB over Phases 7–14, plus
--   the seeded auth users, the one seeded super-admin, and their uploaded
--   storage objects.
--
-- HOW IT TELLS SEEDED ROWS FROM YOUR REAL DATA  (the safety argument)
--   Every verify script authenticates its fixtures with @example.com addresses
--   (RFC 2606 reserved domain — chosen precisely so they can never collide with
--   a real signup). Every REAL firm in this project has members on gmail.com.
--   So the discriminator is:
--
--       a firm is "seeded" IFF it has NO member with a non-@example.com email
--       AND (it has at least one @example.com member, OR it is the known
--            member-less probe firm 99999999-0000-4000-8000-000000000007).
--
--   This NEVER matches a firm that has even one real (gmail) member. As of
--   generation there were 81 firms; 74 match this rule; the 7 it deliberately
--   LEAVES ALONE are your real ones:
--       RudraTestFirm, Rudy and Co, memer's hub, Kunjan parmar, D D PARMAR,
--       and two early gmail test firms ("Test Firm 1783498993901",
--       "Race Test Firm — Renamed") — those two look like abandoned early
--       tests, but they carry a real email, so this script will NOT touch
--       them. Delete them by hand if you recognise them as disposable.
--
-- RE-RUNNABLE: every statement is set-based and idempotent. A second run finds
--   nothing left to delete and is a no-op.
--
-- NOT TOUCHED (by design): the global catalogs (plans, permissions,
--   role_permissions, compliance_types) — they are platform data, never seeded
--   by tests — and every gmail-owned firm.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — DRY RUN.  Run this FIRST. It mutates NOTHING. It prints how many
--             rows each table would lose so you can eyeball the blast radius.
-- ============================================================================
WITH seed_firms AS (
  SELECT f.id
  FROM public.firms f
  WHERE NOT EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.firm_id = f.id AND p.email NOT ILIKE '%@example.com')
    AND (
          EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.firm_id = f.id AND p.email ILIKE '%@example.com')
          OR f.id = '99999999-0000-4000-8000-000000000007'
        )
),
seed_users AS (
  SELECT id FROM auth.users WHERE email ILIKE '%@example.com'
)
SELECT * FROM (
  SELECT 1 AS ord, 'firms (seeded)'            AS table_name, count(*) AS rows_to_delete FROM seed_firms
  UNION ALL SELECT 2,  'profiles',              count(*) FROM public.profiles              WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 3,  'departments',           count(*) FROM public.departments           WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 4,  'department_members',    count(*) FROM public.department_members     WHERE user_id IN (SELECT id FROM public.profiles WHERE firm_id IN (SELECT id FROM seed_firms))
  UNION ALL SELECT 5,  'clients',               count(*) FROM public.clients                WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 6,  'client_addresses',      count(*) FROM public.client_addresses       WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 7,  'client_authorized_persons', count(*) FROM public.client_authorized_persons WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 8,  'client_registrations',  count(*) FROM public.client_registrations   WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 9,  'client_portal_invitations', count(*) FROM public.client_portal_invitations WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 10, 'tasks',                 count(*) FROM public.tasks                  WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 11, 'task_comments',         count(*) FROM public.task_comments          WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 12, 'task_stage_history',    count(*) FROM public.task_stage_history     WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 13, 'task_activities',       count(*) FROM public.task_activities        WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 14, 'task_templates',        count(*) FROM public.task_templates         WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 15, 'documents',             count(*) FROM public.documents              WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 16, 'document_versions',     count(*) FROM public.document_versions      WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 17, 'notifications',         count(*) FROM public.notifications          WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 18, 'fee_masters',           count(*) FROM public.fee_masters            WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 19, 'firm_invoices',         count(*) FROM public.firm_invoices          WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 20, 'firm_invoice_items',    count(*) FROM public.firm_invoice_items     WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 21, 'firm_invoice_counters', count(*) FROM public.firm_invoice_counters  WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 22, 'receipts',              count(*) FROM public.receipts               WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 23, 'receipt_history',       count(*) FROM public.receipt_history        WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 24, 'firm_subscriptions',    count(*) FROM public.firm_subscriptions     WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 25, 'subscription_invoices', count(*) FROM public.subscription_invoices  WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 26, 'udin_register',         count(*) FROM public.udin_register          WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 27, 'dsc_register',          count(*) FROM public.dsc_register           WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 28, 'dsc_custody_movements', count(*) FROM public.dsc_custody_movements  WHERE firm_id IN (SELECT id FROM seed_firms)
  UNION ALL SELECT 29, 'platform_admins (seeded super-admin)', count(*) FROM public.platform_admins WHERE user_id IN (SELECT id FROM seed_users)
  UNION ALL SELECT 30, 'auth.users (@example.com)', count(*) FROM seed_users
  UNION ALL SELECT 31, 'storage.objects (client-documents, under seeded firms)',
                       count(*) FROM storage.objects
                       WHERE bucket_id = 'client-documents'
                         AND split_part(name, '/', 1) IN (SELECT id::text FROM seed_firms)
  UNION ALL SELECT 32, 'rate_limit_buckets (ALL — test noise, self-expiring)', count(*) FROM public.rate_limit_buckets
) t
ORDER BY ord;


-- ============================================================================
-- SECTION 2 — THE DELETE.  Runs as ONE transaction: any error rolls the whole
--             thing back, and the temporarily-disabled triggers are restored
--             either way. Uncomment/execute only after SECTION 1 looks right.
-- ============================================================================
-- Why triggers are disabled below: several test firms have ISSUED invoices, and
-- guard_firm_invoice_no_delete BLOCKS deleting a non-draft invoice (statutory
-- retention). guard_invoice_items_frozen does the same for its line items. The
-- receipt/document AFTER-DELETE triggers recompute invoices / touch storage and
-- would error mid-cascade. We disable exactly those five, delete, and re-enable
-- them — all inside the transaction, so a rollback restores everything.

BEGIN;

-- Freeze the seed set into temp tables BEFORE deleting (the discriminator is
-- derived from firms+profiles, which the delete itself removes).
CREATE TEMP TABLE _seed_firm_ids ON COMMIT DROP AS
  SELECT f.id
  FROM public.firms f
  WHERE NOT EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.firm_id = f.id AND p.email NOT ILIKE '%@example.com')
    AND (
          EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.firm_id = f.id AND p.email ILIKE '%@example.com')
          OR f.id = '99999999-0000-4000-8000-000000000007'
        );

CREATE TEMP TABLE _seed_user_ids ON COMMIT DROP AS
  SELECT id FROM auth.users WHERE email ILIKE '%@example.com';

-- 1) Storage objects (no FK to firms → no cascade). Path = firm_id/client/doc/file.
DELETE FROM storage.objects
 WHERE bucket_id = 'client-documents'
   AND split_part(name, '/', 1) IN (SELECT id::text FROM _seed_firm_ids);

-- 2) Disable the five DELETE-firing triggers that would block or misfire.
ALTER TABLE public.firm_invoices      DISABLE TRIGGER guard_firm_invoice_no_delete;
ALTER TABLE public.firm_invoice_items DISABLE TRIGGER guard_invoice_items_frozen;
ALTER TABLE public.receipts           DISABLE TRIGGER on_receipt_change;
ALTER TABLE public.receipts           DISABLE TRIGGER log_receipt_mutation;
ALTER TABLE public.document_versions  DISABLE TRIGGER on_document_version_removed;

-- 3) Delete the firms. Every public child table is ON DELETE CASCADE from
--    firm_id (verified via pg_constraint), so this removes profiles, clients
--    and their children, departments/members, tasks and their children,
--    documents, notifications, billing, dsc, udin, subscriptions — all of it.
DELETE FROM public.firms WHERE id IN (SELECT id FROM _seed_firm_ids);

-- 4) Re-enable the triggers.
ALTER TABLE public.firm_invoices      ENABLE TRIGGER guard_firm_invoice_no_delete;
ALTER TABLE public.firm_invoice_items ENABLE TRIGGER guard_invoice_items_frozen;
ALTER TABLE public.receipts           ENABLE TRIGGER on_receipt_change;
ALTER TABLE public.receipts           ENABLE TRIGGER log_receipt_mutation;
ALTER TABLE public.document_versions  ENABLE TRIGGER on_document_version_removed;

-- 5) The seeded super-admin + all @example.com auth users. Deleting the auth
--    user cascades to any leftover profile; we remove the platform_admins row
--    first explicitly (it is the ONLY platform_admins row today — a seeded
--    test super-admin, rlssweep1.psa@example.com. ⚠ After this you will have
--    ZERO super-admins. If you want one, seed your OWN before the pilot.)
DELETE FROM public.platform_admins WHERE user_id IN (SELECT id FROM _seed_user_ids);
DELETE FROM auth.users             WHERE id      IN (SELECT id FROM _seed_user_ids);

-- 6) OPTIONAL: rate-limit buckets are transient test noise and self-expire via
--    the send-reminders cron. Uncomment to clear them now instead of waiting.
-- DELETE FROM public.rate_limit_buckets;

COMMIT;

-- After COMMIT, re-run SECTION 1: every count should read 0 (bar the optional
-- rate_limit_buckets line if you left step 6 commented out).
-- ============================================================================
