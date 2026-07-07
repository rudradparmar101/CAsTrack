# Project Context — CA Firm Management SaaS

> **Last updated:** 2026-07-07 (after Phase 4 — Task Management)
> **Repo:** `CA prod 1/` — a local copy of the **DeadlineTracker** codebase (a Next.js + Supabase multi-tenant deadline-tracking SaaS, fully documented in `REFERENCE_ARCHITECTURE.md`) being converted in place into a **Chartered Accountant Firm Management SaaS for the Indian market**.
> **Version control:** local git only — no GitHub, no remote of any kind. The repo has a single auto-generated commit from `create-next-app`; **all CA-firm work (Phases 1–4) is uncommitted in the working tree.**
> **This file is the single source of truth for project state.** Update it at the end of every phase.

---

## 0. Current status at a glance

| Question | Answer |
|---|---|
| What phase are we in? | **Phase 4 complete** (Tasks). Next: stand up the real DB + runtime verification, then Team→Departments (Phase 5). |
| Does it build? | ✅ `npm run build` clean (incl. TypeScript). ✅ `npm run lint` — only the 7 **pre-existing** problems (3 errors in `notification-bell.tsx`/`theme-provider.tsx`, 4 unused-var warnings in legacy files). Nothing from Phases 1–4 work. |
| Does it run? | ⚠️ **Never runtime-verified.** The greenfield schema has never been applied to any Supabase project. `.env.local` still points at the OLD DeadlineTracker DB — running the app today would hit a mismatched schema. |
| What works (once a DB exists)? | Auth + 3 onboarding paths, Clients (CRUD/addresses/persons/portal invites), Documents (upload/versions/approve-reject, staff + portal), **Tasks (list/detail/stage machine/assignment/comments/documents/activity), portal task view**. |
| What is still legacy (compiles, but coded against the old schema)? | `/dashboard`, `/team`, `/templates`, `/settings` pages; `components/task-card.tsx`; `lib/activity.ts`, `lib/notifications.ts` (now orphaned). |
| Biggest risks right now | (1) No commits — one bad script loses everything. (2) Zero runtime/RLS verification. (3) Legacy routes are live and reachable by staff logins. |
| Verification gates | `npm run build` and `npm run lint` only. No tests of any kind. |

---

## 1. What this product is

A multi-tenant SaaS where each tenant is a **CA firm**. Inside a firm:

- **Partners** run the firm (full access).
- **Employees** work compliance tasks (GST, Income Tax, Audit, ROC, Accounting, Payroll), scoped to what's assigned to them or their department, with granular permissions for everything else.
- **Clients** of the firm get a real login to a **curated portal**: they see only their own tasks/documents/comments that staff explicitly marked visible, upload documents, message the firm on shared tasks, and see approve/reject outcomes.
- A **platform super-admin** (us, the SaaS operator) manages plans, subscriptions, and the permission catalog across all firms.

Subscription billing (plans → firm_subscriptions → subscription_invoices) is modeled in the schema; payment-gateway integration (Razorpay/Stripe) is not built yet.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js **16.2.4** (App Router, Server Components, Server Actions) — ⚠️ this version has breaking changes vs. older Next.js; per `AGENTS.md`, consult `node_modules/next/dist/docs/` before writing framework code. Known conventions used: `params` **and** `searchParams` are Promises and must be awaited. |
| UI | React 19.2.4, Tailwind CSS 4, lucide-react icons, hand-rolled UI kit in `src/components/ui/` (Button/Input/Select/Textarea/Modal/Card/Badge/EmptyState) |
| Backend | Supabase (Postgres + Auth + Storage + RLS), accessed via `@supabase/ssr` / `@supabase/supabase-js`; **untyped client** (no generated `Database` generics) |
| Language | TypeScript 5, ESLint 9 |
| Email | **Not wired** — Resend planned; client invites currently `console.log` the link |

There is no test suite. `npm run build` and `npm run lint` are the current verification gates.

---

## 3. Directory structure (file-level, after Phase 4)

```
CA prod 1/
├── AGENTS.md / CLAUDE.md              # "This is NOT the Next.js you know" warning
├── REFERENCE_ARCHITECTURE.md          # Original DeadlineTracker writeup (the source pattern)
├── project_context.md                 # ★ THIS FILE — single source of truth for project state
├── .env.local                         # ⚠️ Still points at the OLD DeadlineTracker Supabase project
├── supabase/
│   ├── ca-firm/                       # ★ THE NEW SYSTEM (DB source of truth)
│   │   ├── schema.sql                 # Greenfield schema: 23 tables, helpers, triggers, RLS, storage policies (~1,680 lines)
│   │   └── ROLES_AND_RLS.md           # Role model + flags F1–F9 + client-isolation proof
│   └── schema.sql, migrations/, cron.sql, fix-rls-policies.sql, functions/send-reminders/
│                                      # ← legacy DeadlineTracker artifacts, reference only — DO NOT APPLY
├── src/
│   ├── middleware.ts                  # Thin wrapper → lib/supabase/middleware.ts (deprecated convention kept deliberately)
│   ├── app/
│   │   ├── (auth)/                    # login, signup (+actions), onboarding (+actions)      [PORTED, Ph2]
│   │   ├── auth/callback/route.ts     # OAuth/email-confirm callback → provisioning          [PORTED, Ph2]
│   │   ├── portal/                    # CLIENT PORTAL (client_user role only)
│   │   │   ├── page.tsx               # Home: task list + waiting-on-you banner + documents  [Ph3+Ph4]
│   │   │   ├── tasks/[id]/page.tsx    # Task view: stage, comments, task documents           [NEW Ph4]
│   │   │   ├── accept-invite/         # Public invite-accept flow (+actions)                 [Ph2]
│   │   │   └── sign-out-button.tsx
│   │   └── (dashboard)/               # STAFF SURFACE (partner/employee)
│   │       ├── layout.tsx             # getAuthContext + client_user redirect + DashboardShell
│   │       ├── clients/               # List, [id] detail, actions.ts, portal-actions.ts     [PORTED Ph3]
│   │       ├── tasks/                 # ★ Phase 4 (fully rebuilt)
│   │       │   ├── page.tsx           # Server list page — awaits searchParams, builds RLS-scoped query
│   │       │   ├── tasks-page-client.tsx  # Toolbar (search/tabs/filters/sort → URL), table, create modal
│   │       │   ├── filters.ts         # TaskFilters model: whitelist parser, URL serializer, applyTaskFilters()
│   │       │   ├── actions.ts         # create/update/changeStage/assign/visibility/delete/fetchMore
│   │       │   │                      #   + legacy-compat markTaskCompleteAction/deleteTaskAction
│   │       │   ├── loading.tsx        # skeleton
│   │       │   └── [id]/
│   │       │       ├── page.tsx       # Server detail page — composes all task components
│   │       │       └── loading.tsx
│   │       ├── dashboard/             # admin/member dashboards                              [LEGACY]
│   │       ├── team/                  # teams UI                                             [LEGACY]
│   │       ├── templates/             # template CRUD                                        [LEGACY]
│   │       ├── settings/              # org settings                                         [LEGACY]
│   │       └── notifications-actions.ts
│   ├── components/
│   │   ├── task/                      # ★ Phase 4 composable task components
│   │   │   ├── stage-badge.tsx        # Stage chip; viewer='client' renders portal wording
│   │   │   ├── task-form.tsx          # Create (full) / edit (metadata-only) form, template picker
│   │   │   ├── task-header.tsx        # Title/badges/description, edit modal, visibility toggle, partner delete
│   │   │   ├── task-stage-panel.tsx   # STAGE MACHINE UI: valid transitions, note, partner force, stage history
│   │   │   ├── task-assignment.tsx    # Assignee/reviewer/department (editable iff tasks.assign, else read-only)
│   │   │   ├── task-metadata.tsx      # Due/statutory dates, period, priority, recurrence, created-by (server-renderable)
│   │   │   ├── task-client-card.tsx   # Client summary + link (server-renderable)
│   │   │   ├── task-comments.tsx      # Shared staff+portal thread; visibility checkbox for staff
│   │   │   ├── task-activity-feed.tsx # Chronological audit from task_activities (server-renderable)
│   │   │   └── task-documents.tsx     # DocumentsSection wrapper + "attach existing document" modal
│   │   ├── documents-section.tsx      # SHARED staff+portal documents UI; Ph4: optional taskId prop, title prop
│   │   ├── client-form.tsx            # Ph3 client form (addresses/persons as JSON sub-forms)
│   │   ├── task-card.tsx              # LEGACY — kept ONLY because dashboard pages import it
│   │   ├── dashboard-shell.tsx / sidebar.tsx / topbar.tsx   # Shell; sidebar role-fixed in Ph4
│   │   ├── notification-bell.tsx      # Polls notifications; type→icon map (Ph4 added document_uploaded)
│   │   ├── priority-badge.tsx         # Used by both legacy and new code
│   │   ├── theme-provider.tsx
│   │   └── ui/                        # badge, button, card, empty-state, input, modal, select, textarea
│   └── lib/
│       ├── auth.ts                    # getAuthContext() / getAuthProfile() — the per-request auth helpers
│       ├── provisioning.ts            # Service-role provisioning (callback + onboarding retry)
│       ├── documents/actions.ts       # SHARED document actions (staff+portal+tasks): upload (task-aware),
│       │                              #   version, approve, reject, attachDocumentToTaskAction
│       ├── tasks/
│       │   ├── comments.ts            # SHARED comment actions ('use server'): add/update/delete — staff + portal
│       │   └── activity.ts            # logTaskActivity() + notifyUser(s)() via create_notification RPC
│       ├── supabase/                  # client.ts / server.ts / admin.ts (service-role) / middleware.ts
│       ├── types.ts                   # CA types (FirmTask*, Department, TaskStage, …) + LEGACY transitional aliases
│       ├── ca-options.ts              # Business/address types + GSTIN/PAN/TAN/CIN/DIN/PIN regexes
│       ├── task-options.ts            # ★ Stage machine map (mirrors DB trigger), stage/transition labels,
│       │                              #   priority/recurrence options, activity-feed label map
│       ├── pagination.ts              # TASKS_PAGE_SIZE=24, CLIENTS_PAGE_SIZE=20, MEMBERS_PAGE_SIZE=20
│       ├── recurrence.ts              # getNextDueDate() — reused by Ph4 recurrence spawning
│       ├── activity.ts                # LEGACY (organization_id) — ORPHANED after Ph4, delete with dashboard port
│       └── notifications.ts           # LEGACY (organization_id) — ORPHANED after Ph4, delete with dashboard port
```

**"PORTED" vs "LEGACY":** ported code uses `firm_id`, `getAuthContext()`, and the new role model. Legacy code still queries `organization_id`, `teams`, and `role IN ('admin','member')` — it compiles (via deliberate transitional aliases in `lib/types.ts`) but **will not work against the new schema** until ported.

**Files deleted in Phase 4:** `tasks/[id]/task-detail-client.tsx`, `tasks/[id]/actions.ts` (task_attachments-based), `components/task-form.tsx` (legacy standalone form).

---

## 4. Architecture

### 4.1 Multi-tenancy & roles

Every tenant-scoped table carries `firm_id`. Security is enforced **in the database via RLS** (the app layer is the second line, not the only line). Four roles:

| Role | Stored | Scope |
|---|---|---|
| `super_admin` | `platform_admins` table (not a profiles.role — avoids NULL-firm profiles) | Cross-firm read; write on platform tables |
| `partner` | `profiles.role` | Whole firm; `has_permission()` always true |
| `employee` | `profiles.role` | (tasks assigned to them) ∪ (tasks in their departments); everything else permission-gated |
| `client_user` | `profiles.role` + `profiles.client_id` | Exactly one client, enforced by table CHECK `(role='client_user') = (client_id IS NOT NULL)` |

**Granular permissions** (`permissions` catalog → `role_permissions` defaults → `user_permissions` per-user grant/revoke overrides) are resolved by `has_permission(key)` — a SECURITY DEFINER function used *inside RLS policies*, so a permission-less employee gets empty result sets even via raw PostgREST.

**Permission catalog & where each key is enforced (important for future work):**

| Key | Employee default | RLS enforcement | App-layer enforcement |
|---|---|---|---|
| `clients.view` | ✅ true | clients/addresses/persons SELECT; task-less document SELECT | — |
| `clients.manage` | ❌ false | clients/addresses/persons INSERT/UPDATE; portal invitations | `requireClientsManage()` in clients/actions.ts |
| `tasks.create` | ✅ true | tasks INSERT (employees only into own departments) | `createTaskAction` |
| `tasks.assign` | ❌ false | **⚠️ NO RLS branch references this key.** DB-level reassignment rides the partner / assigned-to-me / update_department UPDATE policies | `updateTaskAssignmentAction` (the only gate that actually checks it) |
| `tasks.update_department` | ❌ false | tasks UPDATE for dept tasks not assigned to you | mirrored in detail-page `canUpdate` computation |
| `documents.upload` | ✅ true | documents INSERT (staff path) | upload actions |
| `documents.approve` | ❌ false | documents UPDATE (approval fields **and any other column** — this is why "attach existing" needs it) | approve/reject/attach actions |
| `billing.view` / `billing.manage` | ❌ | subscriptions/invoices SELECT | not built yet |
| `team.view` / `team.manage` | ✅ / ❌ | departments + department_members CRUD | not built yet (Phase 5) |
| `templates.manage` | ❌ false | task_templates CUD | not built yet (templates page legacy) |

### 4.2 Schema (supabase/ca-firm/schema.sql — 23 tables)

- **Platform:** `platform_admins`, `plans`, `permissions`, `role_permissions`
- **Tenancy:** `firms`, `departments` (per-firm, seeded on firm creation: GST, Income Tax, Audit, ROC, Accounting, Payroll), `profiles`, `department_members`, `user_permissions`
- **Billing:** `firm_subscriptions`, `subscription_invoices`
- **Clients:** `clients`, `client_addresses`, `client_authorized_persons`, `client_portal_invitations`
- **Work:** `tasks`, `task_stage_history`, `task_comments`, `documents`, `document_versions`, `task_activities`, `notifications`, `task_templates`

Key mechanics (all trigger-enforced in the DB):

- **Task stage machine** (`handle_task_stage()` trigger): `created → assigned → in_progress ⇄ waiting_client`, `in_progress → under_review → completed → archived`, `under_review → in_progress` (send-back), `in_progress → completed` **only when reviewer_id IS NULL**. `created → assigned` **auto-advances** when `assigned_to` is set. Employees are held to the arrows; **partners and service-role may force any transition**. Every change is logged to `task_stage_history` by a SECURITY DEFINER trigger — that table has **no INSERT policy at all**; the trigger is its only writer (its `note` column is therefore currently unwritable from the app — see §6 debt).
- **Derived `status`:** `pending|completed` is computed from stage by the same trigger (`completed`/`archived` ⇒ 'completed') — never write it. Kept so DeadlineTracker-style aggregates and the portal "pending first" sort still work.
- **Document versioning:** `documents` = logical file + approval state; `document_versions` = immutable physical files. Inserting a new version auto-bumps `current_version` and **resets approval to `pending`** (+ maintains `firms.storage_used_bytes`).
- **Profile protection:** `guard_profile_protected_fields` trigger locks `role`, `firm_id`, `client_id` against self-escalation (fixes DeadlineTracker flaw F1).
- **Storage:** private bucket `client-documents`, path `{firm_id}/{client_id}/{document_id}/{uuid}.{ext}` so storage RLS pins client_users to their folder segment. Downloads are 1-hour signed URLs generated server-side.
- **Compliance-safe deletes:** no cascade from clients → tasks/documents (`ON DELETE RESTRICT`); clients have **no DELETE policy** — deactivation via `is_active` only. `documents.task_id` is `SET NULL` so documents outlive tasks. Task delete (partner-only) cascades comments/activities/stage history but **preserves documents**.
- **Notifications:** INSERT restricted to staff policy + the `create_notification()` SECURITY DEFINER RPC (validates same-firm; fixes flaw F7). The RPC is the only insert path that works for client_users.

`ROLES_AND_RLS.md` documents flags **F1–F9** — the nine places the DeadlineTracker pattern was unsafe or insufficient and what replaced it — plus the client-isolation proof.

### 4.3 Auth & onboarding (Phase 2)

Three onboarding paths, all converging on `lib/provisioning.ts` (service-role provisioning — there are deliberately **no INSERT policies** on profiles/firms, fixing flaw F3):

1. **Partner signup** → creates a firm; Supabase's built-in confirmation email (until Resend is wired) → `/auth/callback` provisions profile + firm.
2. **Employee join via invite code** → `lookup_firm_by_invite_code()` SECURITY DEFINER RPC (replaces the old `USING(true)` enumerable-orgs policy, flaw F2).
3. **Client portal invite** → partner/permitted staff creates `client_portal_invitations` row; accept flow at `/portal/accept-invite` is **auto-confirmed** (`admin.createUser` + `email_confirm: true` + immediate sign-in — possessing the invite token *is* the email proof). Invite email delivery is currently a `console.log` stub (`TODO(resend)` in `clients/portal-actions.ts`).

`getAuthContext()` (`lib/auth.ts`) is the single per-request auth helper: session → profile → firm + `is_super_admin()` RPC in parallel; returns `clientId` for portal users and a deprecated `organization` alias so unported pages compile. `getAuthProfile()` is the lighter variant for server actions. Role-aware middleware (`lib/supabase/middleware.ts`) routes staff to dashboard prefixes and client_users to `/portal` (all `/portal/*` subpaths included); `/portal/accept-invite` is public.

### 4.4 Clients & documents (Phase 3)

- **Client CRUD** with explicit `has_permission('clients.manage')` app-layer checks *in addition to* RLS (fixes the DeadlineTracker §8.4 gap where the app relied on RLS alone). This dual-layer pattern is the house style — every Phase 4 mutation follows it.
- Repeatable **address / authorized-person sub-forms** travel as JSON in FormData; `updateClientAction` uses **replace-all semantics** for children — so editing only exists on the client detail page (where full child sets are preloaded); the list page only creates and deactivates.
- **Documents module:** shared server actions (`lib/documents/actions.ts`) + shared `components/documents-section.tsx` render in the staff client-detail page, `/portal`, **and (since Ph4) both task detail pages**. Upload = documents row + storage object + v1 version row, with rollback on partial failure. New-version action inserts only a version row (DB trigger does the rest). Approve/reject gated by `documents.approve`; **reject requires a reason shown verbatim to the client**, whose re-upload button reads "Upload a corrected file".
- Schema change made in Ph3: documents client INSERT policy relaxed to allow `task_id IS NULL` (portal uploads can precede tasks). RLS to be re-finalized at the end (user's decision).

### 4.5 Task Management (Phase 4) — the core business module

**Design goal:** not a port of the DeadlineTracker tasks module but a redesign around a CA firm's compliance pipeline, reusing the Phase 2/3 architecture (getAuthContext, dual-layer permission checks, shared components, RLS-first scoping).

**Data flow / list page (`/tasks`):**
- Search, filters, sorting, and pagination are **all server-side and URL-driven**. `page.tsx` awaits `searchParams`, parses them through the whitelist in `tasks/filters.ts` (`parseTaskFilters` — unknown values fall back to defaults), and runs one RLS-scoped query.
- Filter model (`TaskFilters`): `q` (ilike on title/description/period_label, PostgREST `or()` metacharacters stripped), `view` quick tabs (all / open / waiting_client / overdue / completed — overdue = `status='pending' AND due_date < today`), `stage`, `department`, `client`, `assignee` (uuid | `'me'` | `'unassigned'`), `priority`, `dueFrom`/`dueTo`, `sort` (due_asc default | due_desc | priority — enum order makes DESC = critical-first | newest | title).
- The toolbar (client component) writes state back to the URL via `router.replace` inside `useTransition` (400 ms debounce on search); the server re-renders the list. "Load More" calls `fetchMoreTasksAction(filters, offset)`, which **re-parses the filters server-side** (they crossed the client boundary) and applies the identical query builder. List state resets via the `prevTasks` pattern whenever the server sends a fresh first page.
- `applyTaskFilters()` uses a minimal structural interface of the PostgREST builder (every method returns `this` in supabase-js v2), so one function serves both the page and the action without `any` casts.
- Row scoping is **never** done in query filters — partners see the firm, employees see assigned ∪ department via the tasks SELECT policies.

**Detail page (`/tasks/[id]`):** a server component that fetches task (+client summary, department, assignee, reviewer, creator joins), comments, activities, stage history, task-linked documents (with signed URLs), attachable documents, departments, staff members, and permission flags in parallel — then composes small components (see §3 tree). Server-renderable cards (metadata, client card, activity feed) have no `'use client'`; interactive panels do.

**Stage machine UI (`task-stage-panel.tsx` + `lib/task-options.ts`):**
- `EMPLOYEE_STAGE_TRANSITIONS` mirrors `handle_task_stage()` **exactly**, including the "reviewer set ⇒ no direct in_progress→completed" rule (`allowedTransitions(stage, hasReviewer)`).
- Employees see only valid transition buttons with human labels ("Start work", "Waiting on client", "Submit for review", "Send back", "Approve & complete", "Archive"). An optional note field rides along.
- Partners see the same natural buttons **plus** a collapsed "Partner override" force-select (any stage) — the DB trigger allows partners to force, so this does not bypass anything.
- The app-layer transition check exists **only** for friendly errors and hidden buttons; the trigger remains the authority (its raw exception is also mapped to a readable message).
- Stage history timeline renders from `task_stage_history` (trigger-written, staff-only read).

**Assignment (`task-assignment.tsx` / `updateTaskAssignmentAction`):** assignee + reviewer + department in one save. App-layer gate = `tasks.assign` (partner auto-true); DB-layer the write rides the tasks UPDATE policies. Read-only display for staff without the permission. Activity entries store **resolved names** (profiles/departments looked up post-update) so the feed is human-readable. New assignee is notified. `created → assigned` auto-advance happens in the DB trigger.

**Comments (`lib/tasks/comments.ts` + `task-comments.tsx`, shared staff + portal):**
- Staff comments default **internal**; a per-comment "Visible to client" checkbox publishes to the portal. Chips mark Internal vs Client-visible in the staff view.
- client_user comments are **forced** `visible_to_client=true` (both app-side and by their INSERT policy — clients can't whisper).
- Portal thread only ever receives client-visible comments (RLS SELECT policy — no app filtering involved). Staff author names resolve to `null` under profiles RLS and render as **"Your CA firm"**.
- Authors edit/delete their own comments (RLS `created_by = auth.uid()`).

**Documents on tasks (`task-documents.tsx` + extended `lib/documents/actions.ts`):**
- `DocumentsSection` gained optional `taskId`: uploads made from a task page set `documents.task_id` (RLS re-validates task access for both staff and clients).
- **Attach existing:** `attachDocumentToTaskAction` links an unlinked same-client document. It is an UPDATE on documents ⇒ DB requires `documents.approve` (or partner); app mirrors that and additionally enforces **doc.client_id === task.client_id** (⚠️ the schema has no constraint for this — app-layer only, flagged for the RLS pass).
- Version upload / approve / reject now also log task activity and revalidate the task pages; approve/reject notify the uploader (works for client uploaders via the RPC).

**Activity feed:** every mutation writes `task_activities` through `lib/tasks/activity.ts → logTaskActivity()` (fire-and-forget; failures never block the mutation). Action taxonomy (`TaskActivityAction` in types.ts): task_created, stage_changed (with note), assignee/reviewer/department_changed, priority/due_date/details/visibility_changed, comment_added/edited/deleted, document_uploaded/version_uploaded/attached/approved/rejected, recurring_generated. Client actions (portal comment/upload) are logged too — the INSERT policy admits task participants of either role. Feed labels live in `ACTIVITY_LABELS` (task-options.ts).

**Notifications:** single code path via the `create_notification()` RPC (`notifyUser`/`notifyUsers` helpers — dedupe + exclude-actor). Map: assignment → assignee (`task_assigned`); → under_review → reviewer (`approval_requested`); under_review → in_progress → assignee (`task_rejected`, carries the note); → completed → creator (`task_completed`) + assignee (`task_approved` when it came from review); comment → assignee+creator (`comment_added`, client authors labeled "(client)"); task-linked upload → assignee+creator (`document_uploaded`, added to the NotificationType union + bell icon map); doc approve/reject → uploader. `waiting_client` intentionally notifies no one (clients have no notification surface yet).

**Recurrence:** completing a recurring task spawns the next occurrence (`getNextDueDate`, statutory date shifted too, `period_label` cleared — periods differ per cycle, `parent_task_id` chains to the original). **Best-effort:** the insert legitimately fails RLS if the completing employee lacks `tasks.create` or department membership — logged to console, never fails the completion.

**Portal tasks:** `/portal` home lists RLS-curated tasks (client-visible + past `created` + not archived, pending-first then due-date) with a "N tasks are waiting on you" banner; `/portal/tasks/[id]` shows softened stage wording (`STAGE_META.clientLabel`, e.g. "Waiting on you"), a waiting_client call-to-action banner, client-visible comments with reply box, and task-scoped documents with upload. Clients have **no update path on tasks** (by schema design) — "waiting on client" resolves through their uploads/comments and staff move the stage.

**Hardening decisions worth knowing:**
- All task UPDATEs use `.update().select('id').single()` so an RLS-denied write (zero rows matched) **fails loudly** instead of silently reporting success; `rlsFriendly()` maps PGRST116 to a permission message. (Known caveat: RETURNING also requires SELECT visibility of the *new* row — an employee legally moving a task out of their own visibility, e.g. a cross-department move via update_department, gets a false "no permission" even though the update landed. Rare; acceptable.)
- Fixed a latent Phase 3 bug in the process: the `visible_to_client` **checkbox never submitted `false`** (unchecked checkboxes don't post). Both the task form and `documents-section` now use a hidden-input mirror.
- Detail-page `canUpdate` (drives which panels are interactive) mirrors the UPDATE policies: partner ∥ assigned-to-me ∥ (`tasks.update_department` ∧ task's department ∈ mine, via `get_user_department_ids` RPC).
- Employees' create-form department options are pre-scoped to their own departments (matching the INSERT policy) — partners get all.
- Task create consumes `task_templates` read-only (title/description/priority/recurrence/department pre-select) even though the templates management page is still legacy.

**Legacy-compatibility surface (delete with the dashboard port):** `components/task-card.tsx` is still imported by the unported dashboard pages, so `tasks/actions.ts` retains `markTaskCompleteAction` (now routed through the stage machine: partner force; employee only where the arrows allow completion) and `deleteTaskAction` with their old signatures.

---

## 5. Progress log

| Phase | Date | Delivered | Status |
|---|---|---|---|
| **1 — Schema** | 2026-07-07 | Greenfield `ca-firm/schema.sql` (23 tables, helpers, triggers, RLS, storage policies) + `ROLES_AND_RLS.md` | ✅ Written, **not yet applied to any Supabase project** |
| **2 — Auth plumbing** | 2026-07-07 | Signup/login/onboarding, three onboarding paths, provisioning, getAuthContext, role-aware middleware, transitional types | ✅ Builds & lints clean; **runtime unverified** (no live DB) |
| **3 — Clients + documents** | 2026-07-07 | Client CRUD + portal invites, documents with versioning/approval, client portal page | ✅ Builds & lints clean; **runtime unverified** |
| **4 — Task Management** | 2026-07-07 | Task list (server-side URL-driven search/filter/sort/pagination), task detail (10 composable components), stage-machine UI mirroring the DB trigger, assignment panel, internal/client-visible comments, task-linked documents (upload/attach/versions/approve-reject), activity feed + stage history, recurrence spawning, portal task list + portal task page, notifications via create_notification RPC, sidebar role fix, checkbox-submit bugfix | ✅ Builds & lints clean; **runtime unverified** |
| 5+ | — | See §7 | ⏳ Not started |

**Module status (done vs left):**

| Module | State |
|---|---|
| Auth (login/signup/onboarding/callback) | ✅ Ported (Ph2) |
| Clients (+ addresses, persons, portal invites) | ✅ Ported (Ph3) |
| Documents (upload/version/approve) — staff, portal, tasks | ✅ Built (Ph3), task-aware (Ph4) |
| Tasks (list, detail, stage machine, assignment, comments, activity, portal tasks) | ✅ Rebuilt (Ph4) |
| Client portal | 🟡 Tasks + documents done; still missing: "assigned contact" RPC, notification surfacing, pagination of task/doc lists |
| Dashboard (admin/member) | ❌ Legacy — checks `role==='admin'`, queries `teams`; keeps `task-card.tsx` + 2 legacy-compat action exports alive |
| Team → **Departments + permissions UI** | ❌ Legacy — Phase 5 target: member list, department membership, per-employee `user_permissions` editor, invite-code management |
| Templates | ❌ Legacy page (schema `task_templates` already consumed read-only by task create) |
| Settings | ❌ Legacy (writes assume `role='admin'`) |
| Notifications helpers (`lib/notifications.ts`, `lib/activity.ts`) | ❌ ORPHANED legacy — nothing imports them since Ph4; delete with dashboard port |
| Super-admin surface (`/admin`) | ❌ Not started (`isSuperAdmin` flag ready in getAuthContext) |
| Billing / payment webhooks / plan enforcement | ❌ Not started (schema + DB helpers ready) |
| Email (Resend) | ❌ Not started (console.log stub) |
| Tests / RLS verification | ❌ Nothing exists |

---

## 6. Known vulnerabilities, risks & debt

### Security items (open)

1. **RLS not finalized / never deployed.** The entire security model exists only as SQL text — none of it has run against a real database. The Ph3 relaxation of the documents client INSERT policy (`task_id IS NULL` allowed) was ad-hoc; the user has explicitly deferred a full RLS re-review to the end. **Until the schema is applied and policies are exercised with real JWTs per role, all isolation guarantees are theoretical.**
2. **`.env.local` points at the old DeadlineTracker Supabase project** (and holds a service-role key — rotate when creating the new project; it must never reach a client bundle or repo).
3. **Client-invite links are printed to the server console** (Resend stub). Dev-only acceptable.
4. **Legacy pages are live routes against the wrong model:** `/team`, `/templates`, `/settings`, `/dashboard` are reachable by any staff login and perform writes coded for the old permission model. Consider stubbing/feature-gating until ported.
5. **`tasks.assign` is app-layer-only.** No RLS policy references it; DB-level reassignment is possible for partners, the assignee themselves, and `tasks.update_department` holders via the generic UPDATE policies. Decide in the RLS pass whether to add a dedicated policy branch or accept the app gate.
6. **No DB constraint that a linked document belongs to the task's client** (`documents.client_id` vs `tasks.client_id`) — enforced only in `attachDocumentToTaskAction` and upload paths. A raw PostgREST write by a permitted user could link cross-client. Candidate for a trigger in the RLS pass.
7. **Portal "assigned contact" not yet built** — must be a narrow SECURITY DEFINER RPC, *not* a widened profiles policy (client_users deliberately cannot enumerate staff).
8. **Plan/seat/storage limits are not enforced anywhere yet.** DB helpers exist (`get_firm_plan`, `firm_has_feature`, `storage_used_bytes`) but no server action checks them.
9. **No rate limiting / abuse controls** on public endpoints (signup, invite-code lookup, accept-invite).
10. **Storage rollback is best-effort** — a crash mid-upload can orphan a storage object (no reconciliation job).

### Security items (already fixed by design — don't regress)

The nine DeadlineTracker flaws (F1–F9 in `ROLES_AND_RLS.md`): self-escalation via profile UPDATE (F1 — trigger guard), enumerable orgs via `USING(true)` (F2 — RPCs), join-any-firm-as-admin self-INSERT (F3 — service-role-only provisioning), notification forgery (F7 — RPC), cascade-deleting statutory records (F6), etc. Phase 4 additions that must not regress: stage machine authority stays in the DB trigger; `task_stage_history` stays trigger-only-writable; client comments stay force-visible; all notifications stay on the `create_notification` RPC path.

### Engineering debt

- **No version control in practice.** The entire Phase 1–4 diff lives in one uncommitted working tree. *Highest-priority fix.*
- **Transitional aliases** in `lib/types.ts` (`Organization = Firm`, `UserRole` includes `'admin'|'member'`, legacy `Task*` types) + deprecated `organization` field on getAuthContext + `components/task-card.tsx` + `markTaskCompleteAction`/`deleteTaskAction` legacy exports — all exist only for the unported dashboard/team/templates/settings. Remove together when the last legacy module is ported.
- **`lib/activity.ts` + `lib/notifications.ts` are orphaned** (no importers since Ph4) — delete with the dashboard port.
- **Stage-change notes** land only in `task_activities`; `task_stage_history.note` is unwritable (trigger-only inserts, trigger doesn't accept a note). If notes must live in the immutable history, extend the trigger (e.g. via a session variable) in the RLS pass.
- **Task list search doesn't cover client names** (would need an embedded-resource filter or a view; title/description/period only).
- **Portal task/document lists are unpaginated** — fine for typical client volumes, revisit with real data.
- **`.update().select().single()` RETURNING caveat** — see §4.5 hardening notes (false "no permission" when a legal update moves the row out of the actor's visibility).
- **Pre-existing lint errors** (3) in `notification-bell.tsx`, `theme-provider.tsx` + 4 unused-var warnings in legacy files — predate this work; fix with the respective ports.
- **Deprecated `middleware.ts` convention** kept deliberately (build warns; Next 16 wants `proxy.ts`) — revisit when porting completes.
- **No tests.** RLS especially needs automated policy tests (pgTAP or a JWT-per-role script) once a live DB exists.
- Legacy `supabase/` artifacts (old schema, migrations, cron, edge function) should be archived/deleted so nobody applies the wrong schema.

---

## 7. Plan — next steps in recommended order

1. **Put the work under version control** (do this before anything else). Baseline commit of Phases 1–4; preferably a private remote.
2. **Stand up the greenfield Supabase project.** Apply `supabase/ca-firm/schema.sql`, create the private `client-documents` bucket (then run schema §12 storage policies), verify seeds (`permissions`, `role_permissions`; `plans` needs rows), add ourselves to `platform_admins`, point `.env.local` at it, rotate keys. *Everything else is blocked on this.*
3. **Runtime-verify Phases 2–4 end-to-end** and fix what breaks:
   - Auth: partner signup → firm + departments seeded → employee invite-code join → client invite → portal accept.
   - Clients/documents: CRUD, upload, new version (approval reset), approve/reject, portal view.
   - **Tasks:** create (each role), filters/sort/pagination URLs, every legal stage transition per role + a forced partner transition + a rejected illegal one (trigger message path), assignment + notifications, internal vs client-visible comments (verify portal isolation!), task-linked upload from both sides, attach-existing, recurrence spawn on completion, activity feed contents, stage history.
4. **Phase 5 — Port Team → Departments & Permissions:** member list, department membership management, per-employee `user_permissions` editor (grant/revoke overrides — the "view clients but not billing" feature), invite-code management. This also unblocks removing `team.view/manage` from the untested set.
5. **Phase 6 — Port Dashboard** to the new role model (partner: firm-wide + department workload + waiting_client/overdue counts; employee: assigned ∪ department). Then delete `task-card.tsx`, the legacy-compat action exports, `lib/activity.ts`, `lib/notifications.ts`, and the legacy `Task*`/`Team*` types.
6. **Phase 7 — Templates & Settings ports** (templates page manages `task_templates` incl. `department_id` + `checklist_items`; settings needs the partner-role rewrite).
7. **Portal completion:** "assigned contact" SECURITY DEFINER RPC, notification surfacing for clients, pagination.
8. **Wire Resend** (client invites + task/stage notification emails); remove console.log stub.
9. **Final RLS pass** (user's stated plan): re-review every policy against finalized app behavior — specifically: Ph3 documents INSERT relaxation, `tasks.assign` (§6.5), doc↔task client-consistency trigger (§6.6), stage-history note (§6 debt), then generate the idempotent policy-recreator script (`fix-rls-policies.sql` equivalent) and add role-JWT policy tests.
10. **Plan enforcement + billing:** seat/storage checks in server actions, Razorpay/Stripe webhooks writing `firm_subscriptions`/`subscription_invoices` via service role, super-admin `/admin` surface.
11. **Cleanup:** transitional aliases, legacy `supabase/` artifacts, pre-existing lint errors, archive `REFERENCE_ARCHITECTURE.md` decisions that no longer apply.

---

## 8. Key decisions & rationale (cumulative — for future decision-making)

| Decision | Rationale | Phase |
|---|---|---|
| Greenfield Supabase project, not a migration | Old data/model not worth carrying; RLS redesigned from scratch | 1 |
| super_admin in `platform_admins`, not a profiles.role | Avoids NULL-firm profiles and role-check special cases | 1 |
| Employee scope = assigned ∪ department | Matches how CA firms distribute compliance work | 1 |
| Curated portal via `visible_to_client` flags everywhere | Client trust: staff decide exactly what's visible | 1 |
| Service-role-only provisioning, no self-INSERT policies | Fixes DeadlineTracker F3 | 2 |
| Client invite accept = auto-confirmed user | Possessing the invite token is the email proof | 2 |
| Dual-layer permission checks (app + RLS) on every mutation | Fixes DeadlineTracker §8.4; friendly errors + defense in depth | 3+ |
| Replace-all semantics for client child records | Keeps update action simple/idempotent; constrains editing to detail page | 3 |
| No client delete anywhere | Statutory records must survive | 3 |
| Task list filters server-side via URL searchParams | RLS-scoped pagination + shareable URLs; legacy client-side filtering only filtered loaded pages | 4 |
| Stage machine duplicated in `task-options.ts` but DB trigger stays authority | UI needs valid-move knowledge; duplication is annotated and must track the trigger | 4 |
| Partner "force stage" exposed in UI | The trigger already allows it; hiding it would just push partners to SQL | 4 |
| Comments default internal; explicit publish | Safer default for a professional-services firm | 4 |
| One notification path (create_notification RPC) for all roles | Client-originated events need it anyway; one code path beats two | 4 |
| `FirmTask*` type names alongside legacy `Task*` | Legacy dashboard must compile until its port; rename/cleanup then | 4 |
| `.update().select('id').single()` on all task writes | RLS-denied updates must not report success | 4 |
| Recurrence spawn is best-effort | An RLS-legitimate denial must not block completing the current task | 4 |
| Attach-existing gated by `documents.approve` | Linking is an UPDATE on documents; that's the policy that exists — revisit in RLS pass if too strict | 4 |

---

## 9. Key references

- `REFERENCE_ARCHITECTURE.md` — the original DeadlineTracker architecture this project is patterned on (and diverges from; see F1–F9).
- `supabase/ca-firm/ROLES_AND_RLS.md` — role model, permission resolution, client-isolation proof, flags F1–F9, deferred items.
- `supabase/ca-firm/schema.sql` — the single source of truth for the database.
- `AGENTS.md` — Next.js 16 warning: consult `node_modules/next/dist/docs/` before writing framework code.
- `src/lib/task-options.ts` — the stage-machine map; **must be kept in sync with `handle_task_stage()`** if the trigger ever changes.
