# Phase 7 — Runtime verification findings

Live-data runtime verification of the CA-firm fork, run against the real Supabase project (no mocks) via `scripts/verify/*.mjs` — service-role admin API for test-data setup/assertions, anon-key sign-ins for RLS-scoped checks, and Playwright (Chromium) driving the real UI for every user-facing flow. This is the first time the client portal, recurrence, and RLS have been exercised end-to-end rather than by code inspection.

## How to re-run

```
node scripts/verify/01-setup-test-data.mjs   # fresh firm/clients/tasks — run once
node scripts/verify/02-stage-matrix.mjs
node scripts/verify/03-comments-and-documents.mjs
node scripts/verify/04-portal-e2e.mjs
node scripts/verify/05-recurrence.mjs
node scripts/verify/rls-smoke.mjs
```

Each script after `01` mutates shared fixtures in `scripts/verify/.data/context.json`. Re-running `04-portal-e2e.mjs` or `05-recurrence.mjs` a second time requires resetting the client portal user / document / task-stage state it advanced — see "Re-running a script twice" below. Requires `npm run dev` already running on port 3000.

## Results by step

| Step | Script | Result |
|---|---|---|
| 1 — test data | `01-setup-test-data.mjs` | green |
| 2 — stage matrix | `02-stage-matrix.mjs` | 32/32 |
| 3 — comments & documents | `03-comments-and-documents.mjs` | 16/16 |
| 4 — portal e2e | `04-portal-e2e.mjs` | 18/19 (1 known-flaky, see below) |
| 5 — recurrence spawn | `05-recurrence.mjs` | 12/12 |
| 6 — RLS smoke | `rls-smoke.mjs` | 14/14 |

## Bugs found and fixed

### 1. Architectural — rejected documents invisible to the client (RLS)

**Found in step 4.** The portal task page showed "Documents (0)" for a task-linked document that was `visible_to_client = true` and rejected with a reason — the rejection reason and "Upload a corrected file" button never rendered because the client couldn't even `SELECT` the document row.

Root cause: `can_access_document()` and the `documents` SELECT policy both gated the client path on `uploaded_by = auth.uid() OR approval_status = 'approved'` — a rejected document uploaded by staff on the client's behalf (a realistic scenario) satisfied neither disjunct. This contradicted the documented design (reject requires a reason shown verbatim to the client, whose re-upload button reads "Upload a corrected file").

This is a live-DB RLS policy change, so per protocol it stopped for approval rather than being patched inline. Jay approved widening both predicates to `approval_status IN ('approved', 'rejected')`. Applied to `supabase/ca-firm/schema.sql` and `ROLES_AND_RLS.md`, then run manually against the live project via the Supabase Studio SQL Editor (no scripted DDL path exists — the app's Supabase JS client is PostgREST-only, no `DATABASE_URL`/`pg`/Supabase CLI available in this environment). Confirmed live via a direct RPC probe (`can_access_document()` returned `true` post-fix, `false` before) before re-running the full suite.

### 2. Product bug — "Upload a corrected file" button gated stricter than the backend

**Found while re-verifying fix #1.** After widening RLS, the rejection reason rendered correctly but the "Upload a corrected file" button still didn't appear for a document the client didn't originally upload.

Root cause: `DocumentsSection`'s `isOwnRejected` check required `doc.uploaded_by === currentUserId` — i.e. the client had to be the *original* uploader. This is stricter than both the just-widened RLS visibility and the `document_versions` INSERT policy (`WITH CHECK (... AND can_access_document(document_id))`, no uploader match required) — so a client could see why a document was rejected but never had a way to act on it if staff had uploaded it on their behalf.

Fixed in `src/components/documents-section.tsx`: gated on `viewer === 'client' && canUpload && doc.approval_status === 'rejected'` instead of uploader identity. `currentUserId` then had no remaining use in that component and was removed, cascading out of 4 call sites (`task-documents.tsx`, `client-detail-client.tsx`, and their own page-level callers) to keep lint at the documented baseline (2 pre-existing `notification-bell.tsx` errors + 4 unused-var warnings — unchanged).

### 3. Test-script bugs (not product bugs)

- **Accept-invite → `/portal` redirect timeout too tight.** The original 6s `waitForURL` budget wasn't enough for a cold Turbopack compile on the first hit of `/portal/accept-invite` + `/portal` in a fresh `next dev` process; the single-shot fallback `goto('/portal')` fired while the server action's cookie-setting was still in flight, bouncing to `/login`. Widened to 20s + a 3× retry loop. **Still intermittently fails** even after widening — see "Known flaky" below.
- **Hardcoded expected welcome-name.** Asserted literal text `"Client Alpha Contact"`, which can never appear: `provisionClientFromInvite()` deliberately defaults the display name to the email prefix (the accept-invite form only collects a password). Fixed to assert against the email-prefix-derived name.
- **Lint regression in `02-stage-matrix.mjs`.** Unused imports (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `createClient as createSbClient`) added 3 warnings beyond baseline. Removed.
- **"N tasks are waiting on you" banner check — strict-mode locator violation swallowed to false negative.** `getByText(/task.*waiting on you/i)` matched both the inner `<span>` (whose own text already satisfies the regex) and its parent `<p>` (whose combined text also satisfies it) — a strict-mode violation that `.catch(() => false)` silently turned into a false FAIL. A direct body-text dump proved the banner was rendering correctly the whole time. Fixed with `.first()`.
- **Activity-feed check read before the third sequential server-side step landed.** `addTaskCommentAction` awaits the comment insert, then `notifyUsers`, then `logTaskActivity` — three sequential DB round-trips. The comment-row assertion polls (`waitForCond`) and passes; the activity-row assertion was a one-shot query right after a fixed 800ms wait, which occasionally read before step 3 finished. Switched to the same polling pattern as the comment-row check.

## Known-flaky (not a product bug, not fixed further)

**"Accept-invite → auto-confirmed login → middleware lands on `/portal`"** (step 4) intermittently reports FAIL even after the timeout widening in fix #3. In every occurrence, every *subsequent* assertion on the same page — welcome text, task list, comment isolation, document visibility — passes moments later, proving the portal does load correctly; the assertion is just reading the URL at a moment that doesn't yet reflect the final redirect in this dev-mode / Turbopack-cold-compile environment. Same issue class as the already-documented `/onboarding` client-router-redirect flakiness. Not reinvested in further since it doesn't block any other assertion and isn't reproducible on demand (passed clean on at least one full run during this phase).

## Deferred / verified by inspection, not live exercise

- **Cross-client document attach block** (step 3): the task detail page's `attachableDocuments` query is itself scoped to `client_id = task.client_id`, so a cross-client document never reaches the picker to click in the first place; the belt-and-suspenders app-layer check in `attachDocumentToTaskAction` (`doc.client_id !== task.client_id`) can only be exercised by calling the `'use server'` action directly, which isn't reachable from outside a real form submit without reverse-engineering the Next.js Server Action wire protocol. Verified by code inspection only.

## Re-running a script twice

`04-portal-e2e.mjs` and `05-recurrence.mjs` advance real state (creates the client portal auth user, consumes the invite, uploads document versions, completes tasks). To re-run either from a clean slate:

- **Client portal user**: delete the `client_portal_invitations` row's `accepted_at` (set to `null`) for the reused token; delete any `task_comments`/`task_activities` rows the client profile created (FK `RESTRICT` blocks user deletion otherwise); delete the `auth.users` row via the admin API (cascades `profiles`).
- **taskN document** (the rejected-doc fixture): if a correction was uploaded, delete the `document_versions` row with `version_number = 4` and reset `documents` back to `current_version = 3, approval_status = 'rejected', rejection_reason = <original reason>` (the version-add trigger nulls `rejection_reason` — it is not restored automatically).
- **Task M** (`taskMatrixWithReviewer`): reset `stage` back to `'in_progress'` (not `'assigned'` — the stage machine requires `in_progress` before "Waiting on client" is available) if a prior run advanced it to `waiting_client`.
- **Task R** (`taskRecurring`): each successful run spawns a new occurrence and leaves the original at `stage = 'completed'`; re-running from the original fixture task requires resetting its stage back to `'assigned'` and deleting the spawned child row.

None of this cleanup is scripted yet (each phase-7 session did it ad hoc via short inline `node -e` snippets against the admin client) — worth a `scripts/verify/reset-portal-fixtures.mjs` if this suite becomes something run repeatedly rather than once per phase.
