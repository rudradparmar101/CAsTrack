# Project Context — CA Firm Management SaaS

> **Last updated:** 2026-07-10 (Phase 9 — CA-core schema extension — complete)
> **Repo:** `CA prod 1/` — a local copy of the **DeadlineTracker** codebase (a Next.js + Supabase multi-tenant deadline-tracking SaaS, fully documented in `REFERENCE_ARCHITECTURE.md`) being converted in place into a **Chartered Accountant Firm Management SaaS for the Indian market**, now rebranded **CA Firm Manager**.
> **Version control:** git, pushed to a GitHub remote (`origin/main`). Working tree is clean and up to date with the remote.
> **This file is the single source of truth for project state.** Update it at the end of every phase.

---

## 0. Current status at a glance

| Question | Answer |
|---|---|
| What phase are we in? | **Phase 9 complete** (CA-core schema extension — migration 001 designed and applied to the live DB, zero behavior change for existing data). Adds `client_registrations` (multi-GSTIN/TAN/PF/ESI/PT per client), `is_audit_applicable`/`audit_type` on `clients`, and a platform-wide `compliance_types` catalog (16 seeded rows: GSTR-1/3B incl. QRMP, CMP-08, GSTR-4/9, TDS payment + 24Q/26Q, advance tax, ITR audit/non-audit, tax audit report, AOC-4, MGT-7) that Phase 10's generation engine will read. `tasks` gained `financial_year`/`period_type`/`period_key`/`source`/`category`/`compliance_type_id` plus a partial unique index (`client_id`, `compliance_type_id`, `period_key`) as the statutory-generation idempotency key. Locked decision encoded in code: the Phase 4 completion-chained recurrence spawn now skips `source='statutory'` tasks — those will be calendar-generated (Phase 10), not completion-chained. Phase 10 (compliance core build — registrations editor, generation engine, filing-status grid) is next. |
| Does it build? | ✅ `npm run build` clean (incl. TypeScript). ✅ `npm run lint` — **zero errors, zero warnings** (unchanged baseline since Phase 8). |
| Does it run? | ✅ **Runtime-verified against a live Supabase project** (`fwmmdyebvzncpezdwnxm.supabase.co`). Every major surface has now been scripted and exercised live: the full stage-machine transition matrix, comments/documents isolation, the **client portal end-to-end**, **recurrence spawning**, **per-role RLS isolation**, and (Phase 8) the **rebuilt dashboard** for both partner and employee (Playwright-verified). Migration 001 (Phase 9) applied live and read-only-verified (new tables/columns queryable, 16 compliance_types seed rows present, existing tasks default correctly) — no UI reads/writes the new columns yet, that's Phase 10. |
| What works? | Auth + 3 onboarding paths, Clients (CRUD/addresses/persons/portal invites), Documents (upload/versions/approve-reject, staff + portal), Tasks (list/detail/stage machine/assignment/comments/documents/activity), client portal (runtime-verified end-to-end), Team (departments + membership), Templates (department-scoped), Settings (firm rename), **Dashboard (partner/employee split, now on the unified FirmTask model)** — all working against the real schema and RLS-proven for the roles exercised. Full teal-accent light/dark theme across every page. CA compliance-core schema (registrations, compliance_types, structured task periods) exists in the DB since Phase 9 but has **no UI yet** — Phase 10 builds the editor/generation engine/grid against it. |
| Type system | ✅ **Unified (Phase 8).** Every task-shaped surface in the app — `/tasks`, `/dashboard`, the portal — now reads `FirmTask*` from `lib/types.ts`. No parallel legacy type system remains. `lib/types.ts` itself does not yet carry the Phase 9 columns (`FirmTask`, `Client`) — deferred to Phase 10 when code actually reads/writes them; the untyped Supabase client meant zero TypeScript friction from adding the DB columns first. |
| Biggest risks right now | (1) RLS smoke testing (Ph7) covered the roles/paths in that phase's checklist, not an exhaustive policy-by-policy pass — Phase 14 is the dedicated final pass. (2) The dev-mode accept-invite→`/portal` redirect can race the client router (test-harness-observed, same class as the pre-existing `/onboarding` issue) — never reproduced against a production build, worth a real-build spot-check before shipping the portal. (3) `compliance_types`' applicability predicate (`requires_registration_type`/`requires_gst_scheme`/`requires_flag`/`applicable_business_types`) can express "must be true/match" conditions but not "must be false" — e.g. ITR audit vs. non-audit rows are only mutually exclusive if Phase 10's generation engine explicitly treats them as a conflict pair; the schema alone won't stop both from generating for the same client/FY. Flagged for Phase 10, not a Phase 9 defect (schema-only phase). |
| Verification gates | `npm run build` and `npm run lint` (fully clean, zero-tolerance baseline), plus `scripts/verify/*.mjs` (admin API + Playwright, run manually with `node`) — all 6 scripts green from Phase 7 (92/93 individual assertions; the 1 failure is a documented redirect-timing flake, not a product bug), plus a Phase 8 Playwright spot-check of the rebuilt dashboard. Phase 9's migration was checked with a throwaway read-only script (table/column existence, seed-row count, default values), deleted after use — not part of the committed suite since it verifies a one-time schema change, not repeatable app behavior. Not wired into CI; still run by hand. |

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
| UI | React 19.2.4, Tailwind CSS 4 (CSS-first — color tokens live in a `@theme` block in `globals.css`, no `tailwind.config.*`), lucide-react icons, hand-rolled UI kit in `src/components/ui/` (Button/Input/Select/Textarea/Modal/Card/Badge/EmptyState) — see §4.8 for the design system |
| Backend | Supabase (Postgres + Auth + Storage + RLS), accessed via `@supabase/ssr` / `@supabase/supabase-js`; **untyped client** (no generated `Database` generics) |
| Language | TypeScript 5, ESLint 9 |
| Fonts | next/font/google: **Plus Jakarta Sans** (`--font-sans`, body/UI) + Geist Mono (`--font-geist-mono`, invite codes only) |
| Email | **Not wired** — Resend planned; client invites currently `console.log` the link |

There is no test suite. `npm run build` and `npm run lint` are the current verification gates.

---

## 3. Directory structure (file-level, after Phase 6)

```
CA prod 1/
├── AGENTS.md / CLAUDE.md              # "This is NOT the Next.js you know" warning
├── REFERENCE_ARCHITECTURE.md          # Original DeadlineTracker writeup (the source pattern)
├── project_context.md                 # ★ THIS FILE — single source of truth for project state
├── .env.local                         # Points at the live CA-firm Supabase project (since Ph5) — holds a service-role key
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
│   │       ├── dashboard/             # admin/member dashboards       [Ph5: role/department fields fixed against
│   │       │                          #   the real schema; STILL on the legacy Task/TaskWithDetails type + task-card.tsx,
│   │       │                          #   not Ph4's FirmTask model — works, but two type systems now coexist]
│   │       ├── team/                  # ★ Ph5 rebuilt — departments + department_members (not teams/team_members);
│   │       │                          #   has_permission('team.view'/'team.manage') gating; no lead/role-promotion UI
│   │       │                          #   (no schema equivalent — CA roles are fixed at signup)               [PORTED Ph5]
│   │       ├── templates/             # ★ Ph5 fixed — firm_id + has_permission('templates.manage'); added
│   │       │                          #   optional department_id scoping to the create/edit form              [PORTED Ph5]
│   │       ├── settings/              # ★ Ph5 fixed — firm_id, `firms` table (not `organizations`), role='partner' [PORTED Ph5]
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
│   │   ├── task-card.tsx              # LEGACY type, still kept — only dashboard pages import it; works against
│   │   │                              #   the real schema (Task type's fields fixed in Ph5) but not yet unified onto FirmTask
│   │   ├── dashboard-shell.tsx / sidebar.tsx / topbar.tsx   # Shell; sidebar role-fixed Ph4; theme toggle moved
│   │   │                              #   sidebar→topbar in Ph6 (useSyncExternalStore for hydration-safe icon)
│   │   ├── notification-bell.tsx      # Polls notifications; type→icon map (Ph4 added document_uploaded); Ph6 retheme only
│   │   ├── priority-badge.tsx         # ★ Ph6: rewired to token families (low→muted, medium→info, high→warning,
│   │   │                              #   critical→danger) — was raw Tailwind colors with no dark-mode handling at all
│   │   ├── theme-provider.tsx         # ★ Ph6: rewritten with a lazy useState initializer — was 2 pre-existing lint errors
│   │   └── ui/                        # badge, button, card, empty-state, input, modal, select, textarea — all Ph6-retokened
│   └── lib/
│       ├── auth.ts                    # getAuthContext() / getAuthProfile() — the per-request auth helpers
│       ├── provisioning.ts            # Service-role provisioning (callback + onboarding retry)
│       ├── documents/actions.ts       # SHARED document actions (staff+portal+tasks): upload (task-aware),
│       │                              #   version, approve, reject, attachDocumentToTaskAction
│       ├── tasks/
│       │   ├── comments.ts            # SHARED comment actions ('use server'): add/update/delete — staff + portal
│       │   └── activity.ts            # logTaskActivity() + notifyUser(s)() via create_notification RPC
│       ├── supabase/                  # client.ts / server.ts / admin.ts (service-role) / middleware.ts
│       ├── types.ts                   # CA types (FirmTask*, Department, TaskStage, …) + LEGACY transitional aliases;
│       │                              #   Ph5: Team/TeamMember/TeamWithDetails/TeamMemberWithProfile → Department/
│       │                              #   DepartmentMember/DepartmentWithMembers/DepartmentMemberWithProfile
│       ├── ca-options.ts              # Business/address types + GSTIN/PAN/TAN/CIN/DIN/PIN regexes
│       ├── task-options.ts            # ★ Stage machine map (mirrors DB trigger), stage/transition labels,
│       │                              #   priority/recurrence options, activity-feed label map
│       ├── pagination.ts              # TASKS_PAGE_SIZE=24, CLIENTS_PAGE_SIZE=20, MEMBERS_PAGE_SIZE=20
│       ├── recurrence.ts              # getNextDueDate() — reused by Ph4 recurrence spawning
│       ├── activity.ts                # LEGACY (organization_id) — ORPHANED after Ph4, delete with dashboard port
│       └── notifications.ts           # LEGACY (organization_id) — ORPHANED after Ph4, delete with dashboard port
```

**"PORTED" vs "LEGACY":** ported code uses `firm_id`, `getAuthContext()`, and the new role model. Legacy code still queries `organization_id`, `teams`, and `role IN ('admin','member')` — it compiles (via deliberate transitional aliases in `lib/types.ts`) but **will not work against the new schema** until ported. After Phase 5, the only surface still on the legacy `Task`/`TaskWithDetails` types is the dashboard + `task-card.tsx` — everything else (`/team`, `/templates`, `/settings`) is fully ported.

**Files touched in Phase 5 (legacy-page port) + Phase 6 (reskin), bundled in one commit (`abb4af8`):** `lib/provisioning.ts` (onboarding race fix), `dashboard/page.tsx` + `admin-dashboard.tsx` + `member-dashboard.tsx`, all of `team/*` (rewritten), `templates/*` + `template-form.tsx`, `settings/actions.ts` + `settings-page-client.tsx`, `lib/types.ts` (Department* types, `TaskTemplate`/`Task` field fixes), `globals.css` (full rewrite — `@theme` token block), `layout.tsx` (font), `theme-provider.tsx` (rewrite), `topbar.tsx`/`sidebar.tsx` (toggle relocation), every file in `components/ui/`, and ~50 other page/component files for the color-token sweep (see §4.8).

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
| `team.view` / `team.manage` | ✅ / ❌ | departments + department_members CRUD | ✅ `requireTeamView()`/`requireTeamManage()` in `team/actions.ts` (Ph5) |
| `templates.manage` | ❌ false | task_templates CUD | ✅ `requireTemplatesManage()` in `templates/actions.ts` (Ph5) |

### 4.2 Schema (supabase/ca-firm/schema.sql — 25 tables as of Phase 9)

- **Platform:** `platform_admins`, `plans`, `permissions`, `role_permissions`, `compliance_types` (Phase 9 — platform-wide catalog, same shape as `permissions`: no `firm_id`, readable by every authenticated user, super-admin managed, retired via `is_active` not hard delete)
- **Tenancy:** `firms`, `departments` (per-firm, seeded on firm creation: GST, Income Tax, Audit, ROC, Accounting, Payroll), `profiles`, `department_members`, `user_permissions`
- **Billing:** `firm_subscriptions`, `subscription_invoices`
- **Clients:** `clients` (Phase 9: + `is_audit_applicable`/`audit_type`), `client_addresses`, `client_authorized_persons`, `client_registrations` (Phase 9 — multi-GSTIN/TAN/PF/ESI/PT per client, RLS mirrors `client_addresses`), `client_portal_invitations`
- **Work:** `tasks` (Phase 9: + `financial_year`/`period_type`/`period_key`/`source`/`category`/`compliance_type_id`), `task_stage_history`, `task_comments`, `documents`, `document_versions`, `task_activities`, `notifications`, `task_templates`

**Phase 9 addendum:** statutory task generation (Phase 10) will upsert against `uq_statutory_task_per_period` — a partial unique index on `tasks(client_id, compliance_type_id, period_key)` WHERE both are non-null. `compliance_types.due_day_rule` is a JSONB convention (`{"due_day": N, "months_after_period_end": N}` for monthly/quarterly, `{"due_day": N, "due_month": N}` for a fixed annual date) that Phase 10's engine interprets — government due-date extensions are not modeled. The applicability predicate (`requires_registration_type`/`requires_gst_scheme`/`requires_flag`/`applicable_business_types`) can only express "must match/be true," not "must be false" — see §0 risk (3).

Key mechanics (all trigger-enforced in the DB):

- **Task stage machine** (`handle_task_stage()` trigger): `created → assigned → in_progress ⇄ waiting_client`, `in_progress → under_review → completed → archived`, `under_review → in_progress` (send-back), `in_progress → completed` **only when reviewer_id IS NULL**. `created → assigned` **auto-advances** when `assigned_to` is set. Employees are held to the arrows; **partners and service-role may force any transition**. Every change is logged to `task_stage_history` by a SECURITY DEFINER trigger — that table has **no INSERT policy at all**; the trigger is its only writer (its `note` column is therefore currently unwritable from the app — see §6 debt).
- **Derived `status`:** `pending|completed` is computed from stage by the same trigger (`completed`/`archived` ⇒ 'completed') — never write it. Kept so DeadlineTracker-style aggregates and the portal "pending first" sort still work.
- **Document versioning:** `documents` = logical file + approval state; `document_versions` = immutable physical files. Inserting a new version auto-bumps `current_version` and **resets approval to `pending`** (+ maintains `firms.storage_used_bytes`).
- **Profile protection:** `guard_profile_protected_fields` trigger locks `role`, `firm_id`, `client_id` against self-escalation (fixes DeadlineTracker flaw F1).
- **Storage:** private bucket `client-documents`, path `{firm_id}/{client_id}/{document_id}/{uuid}.{ext}` so storage RLS pins client_users to their folder segment. Downloads are 1-hour signed URLs generated server-side.
- **Compliance-safe deletes:** no cascade from clients → tasks/documents (`ON DELETE RESTRICT`); clients have **no DELETE policy** — deactivation via `is_active` only. `documents.task_id` is `SET NULL` so documents outlive tasks. Task delete (partner-only) cascades comments/activities/stage history but **preserves documents**.
- **Notifications:** INSERT restricted to staff policy + the `create_notification()` SECURITY DEFINER RPC (validates same-firm; fixes flaw F7). The RPC is the only insert path that works for client_users.

`ROLES_AND_RLS.md` documents flags **F1–F9** — the nine places the DeadlineTracker pattern was unsafe or insufficient and what replaced it — plus the client-isolation proof.

### 4.3 Auth & onboarding (Phase 2; race condition fixed Phase 5)

Three onboarding paths, all converging on `lib/provisioning.ts` (service-role provisioning — there are deliberately **no INSERT policies** on profiles/firms, fixing flaw F3):

1. **Partner signup** → creates a firm; Supabase's built-in confirmation email (until Resend is wired) → `/auth/callback` provisions profile + firm.
2. **Employee join via invite code** → `lookup_firm_by_invite_code()` SECURITY DEFINER RPC (replaces the old `USING(true)` enumerable-orgs policy, flaw F2).
3. **Client portal invite** → partner/permitted staff creates `client_portal_invitations` row; accept flow at `/portal/accept-invite` is **auto-confirmed** (`admin.createUser` + `email_confirm: true` + immediate sign-in — possessing the invite token *is* the email proof). Invite email delivery is currently a `console.log` stub (`TODO(resend)` in `clients/portal-actions.ts`).

`getAuthContext()` (`lib/auth.ts`) is the single per-request auth helper: session → profile → firm + `is_super_admin()` RPC in parallel; returns `clientId` for portal users and a deprecated `organization` alias so unported pages compile. `getAuthProfile()` is the lighter variant for server actions. Role-aware middleware (`lib/supabase/middleware.ts`) routes staff to dashboard prefixes and client_users to `/portal` (all `/portal/*` subpaths included); `/portal/accept-invite` is public.

**Onboarding race condition (found + fixed Phase 5):** `/onboarding` does a check-then-insert with no locking, and Next.js genuinely fires more than one request to it within a single navigation (confirmed live — two `GET /onboarding` ~250ms apart in the dev log). The losing request hit `profiles_pkey` (23505) and — before the fix — surfaced a false "we couldn't finish setting up your account" error to a user whose account had actually provisioned fine via the winning request. Fixed via `resolveProfileRace()` in `provisioning.ts`: on a 23505 from the `profiles` insert, re-select the profile the winner created and return `{ ok: true }` instead of failing.

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
- Task create consumes `task_templates` read-only (title/description/priority/recurrence/department pre-select); the templates management page itself was ported in Phase 5 (§4.6).

**Legacy-compatibility surface (delete when the dashboard is unified onto FirmTask):** `components/task-card.tsx` is still imported by the dashboard pages, so `tasks/actions.ts` retains `markTaskCompleteAction` (now routed through the stage machine: partner force; employee only where the arrows allow completion) and `deleteTaskAction` with their old signatures. Dashboard itself now works correctly against the real schema (Ph5) — this surface is about the type system, not correctness.

### 4.6 Team → Departments, Templates, Settings, Dashboard (Phase 5)

The last four pages inherited wholesale from DeadlineTracker were never touched in Phases 1–4: they still assumed the old data model (`profiles.organization_id`, an `organizations` table, a `teams`/`team_members` model, `role IN ('admin','member')`) — none of which exist in the CA schema. `/team` and `/templates` were **completely unreachable** (their role gate `role !== 'admin'` is never true for a CA user), and even with that fixed every action would have failed on the wrong column/table names. Phase 5 ported all four:

- **Team (`/team`) — rebuilt around `departments`/`department_members`, not a port of the old teams UI.** The old model (freeform team name/description/lead, arbitrary membership) doesn't map onto the schema's actual concept: departments are **seeded 6-per-firm** by the `seed_default_departments()` trigger (GST, Income Tax, Audit, ROC, Accounting, Payroll) with partners able to add custom ones, and have no `lead_id` or role-promotion concept (CA roles are fixed at signup — partner via create-firm, employee via invite code — there is no in-app admin/member toggle). So the old "team lead" picker and `changeRoleAction` (promote/demote) were **dropped, not ported** — no schema equivalent. Departments use an `is_active` toggle instead of hard delete, mirroring the Clients module's no-hard-delete precedent. Permission gating follows the `requireClientsManage()`-style pattern from `clients/actions.ts`: `requireTeamView()`/`requireTeamManage()` via `getAuthProfile()` + `has_permission()`. Invite-code regeneration kept, now a direct `firms.invite_code` update (no `regenerate_invite_code_for_org` RPC exists in this schema).
- **Templates (`/templates`) — a much smaller fix**, since `task_templates`'s columns (title/description/default_priority/recurring_rule/checklist_items) already matched almost exactly. Fixed `organization_id` → `firm_id` throughout `actions.ts`, added `requireTemplatesManage()` (same pattern as Team), and added an optional `department_id` scope to the create/edit form (the column already existed in the schema, just unused by the UI).
- **Settings (`/settings`)** — `updateOrganizationAction` fixed from `profiles.organization_id`/`organizations` table to `profiles.firm_id`/`firms` table, role check `'admin'` → `'partner'`.
- **Dashboard (`/dashboard`)** — role branch `'admin'` → `'partner'`; `admin-dashboard.tsx`'s team-workload analytics renamed from the nonexistent `assigned_team_id` to the real `tasks.department_id` column, and its `teams` query became a `departments` query. **Not** rebuilt onto Ph4's `FirmTask` model — see the type-system split noted in §0/§6.
- **Cosmetic, same phase:** the topbar/settings role badge hardcoded `'Admin'/'Member'` labels (checked `role === 'admin'`, which is never true) → now shows Partner/Employee correctly.

### 4.7 Design system / reskin (Phase 6)

Pure visual pass — **zero schema/data-fetching/layout changes** — to replace the inherited DeadlineTracker indigo/Geist look with a calmer teal "fintech for CAs and their non-technical clients" identity, in both light and dark mode.

- **Color tokens** live in a Tailwind v4 `@theme` block in `globals.css` (light values) with a plain `.dark { }` override block (dark values) — the standard Tailwind v4 CSS-variable dark-mode pattern; every existing `var(--color-x)` / `bg-[var(--color-x)]` reference across the app keeps working unchanged. Token families: surfaces (`background`/`surface`/`border`/`muted`), text (`text`/`text-secondary`/`text-muted`, names kept from before), brand (`accent`/`accent-hover`/`accent-foreground`/`accent-muted`, teal, defined once per mode so the brand hue is a 2–4 line edit), and four status families (`success`/`warning`/`danger`/`info`, each with `-bg`/`-text`/`-border`) — `info` is a genuinely separate blue, not a reuse of the accent, and a `danger-foreground`/`accent-foreground` pair was added after a real contrast bug surfaced: white button/badge text was illegible against the bright dark-mode accent (`#2dd4bf`) and danger (`#f87171`) colors (verified via a throwaway WCAG contrast-ratio script; near-black foregrounds used instead in dark mode). Background/surface are near-black-not-`#000`/off-white-not-`#fff` per the brief.
- **Typography:** `Geist` → `Plus Jakarta Sans` (`next/font/google`, var renamed `--font-sans`); `Geist_Mono` kept for the one legitimate monospace use (invite codes).
- **Theme mechanism:** `theme-provider.tsx` had 2 pre-existing `react-hooks/set-state-in-effect` lint errors (calling `setTheme` inside a mount effect) — fixed with a lazy `useState(() => ...)` initializer reading `localStorage`/`matchMedia` once, collapsed to a single effect that only syncs theme → DOM class + localStorage. The toggle itself was moved from the sidebar into the topbar (icon-only Sun/Moon button); its mount-safe rendering uses `useSyncExternalStore` (not a mounted-state-in-effect, which would have reintroduced the same lint error) to avoid a hydration mismatch for returning visitors with a saved dark preference.
- **Sweep:** every file in `components/ui/` plus ~50 page/feature components had hardcoded Tailwind palette classes (`bg-gray-100`, `text-emerald-700`, `border-red-200`, raw `bg-blue-50`, …) replaced with tokens — including `priority-badge.tsx` (previously **no dark-mode handling at all** — light pastel chips that would have looked broken on a dark card) and 7 near-identical loading-skeleton files (previously hardcoded `#e2e8f0`/`#f1f5f9` shimmer hex, genuinely broken in dark mode). The landing page (`app/page.tsx`) was included even though it wasn't in the original verification checklist, since leaving it unskinned would have been the most visible remaining "old template" surface; its one permanently-dark decorative CTA banner section intentionally keeps a couple of literal (non-token) colors since that section doesn't follow the page's own light/dark toggle by design (same pattern the sidebar already used).
- **Verified** via Playwright screenshots in both themes across login/signup, dashboard, clients + client-detail, tasks + task-detail (real stage/priority/overdue badges together), team, templates, and settings. `npm run build` / `npm run lint` clean.

---

## 5. Progress log

| Phase | Date | Delivered | Status |
|---|---|---|---|
| **1 — Schema** | 2026-07-07 | Greenfield `ca-firm/schema.sql` (23 tables, helpers, triggers, RLS, storage policies) + `ROLES_AND_RLS.md` | ✅ Written; **applied** — live Supabase project since Ph5 |
| **2 — Auth plumbing** | 2026-07-07 | Signup/login/onboarding, three onboarding paths, provisioning, getAuthContext, role-aware middleware, transitional types | ✅ Builds & lints clean; runtime-verified Ph5 (race condition found + fixed) |
| **3 — Clients + documents** | 2026-07-07 | Client CRUD + portal invites, documents with versioning/approval, client portal page | ✅ Builds & lints clean; client CRUD runtime-verified Ph5 |
| **4 — Task Management** | 2026-07-07 | Task list (server-side URL-driven search/filter/sort/pagination), task detail (10 composable components), stage-machine UI mirroring the DB trigger, assignment panel, internal/client-visible comments, task-linked documents (upload/attach/versions/approve-reject), activity feed + stage history, recurrence spawning, portal task list + portal task page, notifications via create_notification RPC, sidebar role fix, checkbox-submit bugfix | ✅ Builds & lints clean; task creation + badges smoke-tested Ph6, stage/document/portal flows still unverified |
| **5 — Legacy-page port** | 2026-07-08 | Found by actually running the app: onboarding race condition (false "couldn't finish setting up" error) fixed; Team rebuilt onto departments; Templates + Settings + Dashboard fixed to the real schema/role model; role-badge label bug fixed | ✅ Builds & lints clean; runtime-verified via Playwright (signup→login, department/template CRUD, firm rename, invite-code regen) against a live Supabase project |
| **6 — Reskin** | 2026-07-08/09 | Teal-accent token system (`@theme`, full light/dark palettes, WCAG-AA verified), Plus Jakarta Sans, theme-provider lint fix + topbar toggle relocation, full color-token sweep of the UI kit + ~50 files | ✅ Builds & lints clean (theme-provider's pre-existing lint errors now fixed too); verified via Playwright screenshots in both themes across the full nav |
| **7 — Runtime verification** | 2026-07-09/10 | `scripts/verify/` suite (admin API + Playwright, `playwright` added as devDependency): `01-setup-test-data`, `02-stage-matrix` (32/32), `03-comments-and-documents` (16/16), `04-portal-e2e` (18/19 — client portal end-to-end, first time ever exercised), `05-recurrence` (12/12), `rls-smoke` (14/14). Surfaced + fixed one architectural finding (RLS: rejected documents were invisible to the client — Jay approved widening `can_access_document()`/the `documents` SELECT policy to include `rejected`) and one product bug it exposed (the "Upload a corrected file" button was gated stricter than the new RLS, requiring the client to be the original uploader). Findings in `docs/verification/phase-7-runtime.md` | ✅ Builds & lints clean (baseline unchanged); all 6 scripts green |
| **8 — Type unification + deletions** | 2026-07-10 | Dashboard rebuilt onto `FirmTaskWithRefs` via a new shared `TaskSummaryCard`; deleted `components/task-card.tsx`, `markTaskCompleteAction`, orphaned `lib/activity.ts`/`lib/notifications.ts`; removed the `Organization`/`'admin'\|'member'` legacy aliases and the deprecated `organization` field on `getAuthContext()`; folded `templates/*` onto `FirmTaskTemplate`; deleted every dead legacy type in `lib/types.ts`; archived legacy DeadlineTracker `supabase/` artifacts to `supabase/_legacy-deadlinetracker/` with a README; fixed the last 2 `notification-bell.tsx` lint errors + 4 unused-var warnings | ✅ Build clean; lint **fully clean** (zero errors, zero warnings — new baseline); Playwright-verified dashboard for partner + employee against a live Supabase project; pushed to `origin/main` |
| **9 — CA-core schema extension** | 2026-07-10 | Migration 001 (`supabase/ca-firm/migrations/001_ca_compliance_core.sql`) + folded into `schema.sql`: `client_registrations` (multi-GSTIN/TAN/PF/ESI/PT), `is_audit_applicable`/`audit_type` on `clients`, platform-wide `compliance_types` catalog (16 seed rows), and `tasks.financial_year`/`period_type`/`period_key`/`source`/`category`/`compliance_type_id` + the `uq_statutory_task_per_period` partial unique index; RLS written for both new tables at creation time; `tasks/actions.ts` completion-chain guard now skips `source='statutory'` | ✅ Build + lint clean; migration applied to the live Supabase project by Jay via the SQL Editor and read-only-verified (seed rows, new columns, unchanged defaults on existing tasks) |
| 10+ | — | See docs/ROADMAP.md | ⏳ Not started |

**Module status (done vs left):**

| Module | State |
|---|---|
| Auth (login/signup/onboarding/callback) | ✅ Ported (Ph2); onboarding race condition fixed (Ph5) |
| Clients (+ addresses, persons, portal invites) | ✅ Ported (Ph3) |
| Documents (upload/version/approve) — staff, portal, tasks | ✅ Built (Ph3), task-aware (Ph4); upload/version/approve/reject/attach-existing runtime-verified Ph7 (`03-comments-and-documents.mjs`) |
| Tasks (list, detail, stage machine, assignment, comments, activity, portal tasks) | ✅ Rebuilt (Ph4); full stage-transition matrix (incl. partner force + illegal-transition rejection) runtime-verified Ph7 (`02-stage-matrix.mjs`) |
| Client portal | ✅ Tasks + documents done and **runtime-verified end-to-end Ph7** (`04-portal-e2e.mjs`) — accept-invite, curated lists, comment/document isolation, reply/upload, rejection display, staff stage changes reflecting on refresh. Still missing (deferred to Ph11): "assigned contact" RPC, notification surfacing, pagination of task/doc lists |
| Dashboard (admin/member) | ✅ **Unified onto FirmTask (Ph8)** — same model as `/tasks`; `task-card.tsx` deleted in favor of a shared `TaskSummaryCard`. Retheme'd (Ph6); Playwright-verified for partner + employee (Ph8) |
| Team → **Departments + membership** | ✅ Rebuilt (Ph5) — no lead/role-promotion concept ported (no schema equivalent); per-employee `user_permissions` editor still not built |
| Templates | ✅ Ported (Ph5) — `firm_id` + `has_permission`, department scoping added |
| Settings | ✅ Ported (Ph5) — firm rename verified runtime |
| Notifications helpers (`lib/notifications.ts`, `lib/activity.ts`) | ❌ Still ORPHANED — nothing imports them; delete when the dashboard is unified onto FirmTask |
| Super-admin surface (`/admin`) | ❌ Not started (`isSuperAdmin` flag ready in getAuthContext) |
| Billing / payment webhooks / plan enforcement | ❌ Not started (schema + DB helpers ready) |
| Email (Resend) | ❌ Not started (console.log stub) |
| Tests / RLS verification | ✅ **Ph7** — committed `scripts/verify/*.mjs` suite (not a CI-wired test framework, but scripted + repeatable, run by hand): full stage matrix, comments/documents, portal e2e, recurrence, and a per-role RLS smoke test (E1/E2/client-A via real anon-key sign-ins) |
| Visual design system | ✅ Built (Ph6) — teal accent, full light/dark, Plus Jakarta Sans |

---

## 6. Known vulnerabilities, risks & debt

### Security items (open)

1. ~~RLS is deployed and partially proven, but not yet per-role~~ **Substantially resolved (Ph7).** `rls-smoke.mjs` now proves per-role isolation via real anon-key sign-ins (not app-layer checks): E1 sees assigned ∪ own-department only (direct SELECT + UPDATE of an out-of-scope task both fail), E2's revoked `clients.view` override wins over the employee default, client-A cannot see client-B tasks/documents, cannot read internal comments, has no UPDATE path on tasks, cannot INSERT notifications directly, cannot post a hidden (`visible_to_client=false`) comment, and cannot read `task_stage_history` at all. This proved (and Ph7 fixed) one real gap: the `documents` policy excluded `rejected` from client visibility — see the Ph7 row in §5 and `docs/verification/phase-7-runtime.md`. What Ph7's smoke test does **not** claim: it isn't an exhaustive policy-by-policy pass (every table × every role), and the Ph3 relaxation of the documents client INSERT policy (`task_id IS NULL` allowed) still awaits the dedicated **Phase 14** final RLS review the user asked for.
2. ~~`.env.local` points at the old DeadlineTracker Supabase project~~ **Resolved** — it now points at the live CA-firm project (`fwmmdyebvzncpezdwnxm.supabase.co`). Still true: the service-role key it holds must never reach a client bundle or the repo.
3. **Client-invite links are printed to the server console** (Resend stub). Dev-only acceptable.
4. ~~Legacy pages live against the wrong model~~ **Resolved (Ph5)** — `/team`, `/templates`, `/settings`, `/dashboard` now write against the real schema/role model. (Dashboard still uses the legacy `Task` type internally — see the engineering-debt item below — but that's a type-unification concern, not a broken-write concern; its writes go through the same fixed role/field checks.)
5. **`tasks.assign` is app-layer-only.** No RLS policy references it; DB-level reassignment is possible for partners, the assignee themselves, and `tasks.update_department` holders via the generic UPDATE policies. Decide in the RLS pass whether to add a dedicated policy branch or accept the app gate.
6. **No DB constraint that a linked document belongs to the task's client** (`documents.client_id` vs `tasks.client_id`) — enforced only in `attachDocumentToTaskAction` and upload paths. A raw PostgREST write by a permitted user could link cross-client. Candidate for a trigger in the RLS pass.
7. **Portal "assigned contact" not yet built** — must be a narrow SECURITY DEFINER RPC, *not* a widened profiles policy (client_users deliberately cannot enumerate staff).
8. **Plan/seat/storage limits are not enforced anywhere yet.** DB helpers exist (`get_firm_plan`, `firm_has_feature`, `storage_used_bytes`) but no server action checks them.
9. **No rate limiting / abuse controls** on public endpoints (signup, invite-code lookup, accept-invite). Also worth noting operationally: Supabase's own signup-email rate limit was hit repeatedly during Ph5/Ph6 testing — real signups could hit this too under load; a bulk-testing workaround (admin API user creation) exists but isn't a production fix.
10. **Storage rollback is best-effort** — a crash mid-upload can orphan a storage object (no reconciliation job).

### Security items (already fixed by design — don't regress)

The nine DeadlineTracker flaws (F1–F9 in `ROLES_AND_RLS.md`): self-escalation via profile UPDATE (F1 — trigger guard), enumerable orgs via `USING(true)` (F2 — RPCs), join-any-firm-as-admin self-INSERT (F3 — service-role-only provisioning), notification forgery (F7 — RPC), cascade-deleting statutory records (F6), etc. Phase 4 additions that must not regress: stage machine authority stays in the DB trigger; `task_stage_history` stays trigger-only-writable; client comments stay force-visible; all notifications stay on the `create_notification` RPC path. Phase 5 addition that must not regress: `resolveProfileRace()` in `provisioning.ts` — don't reintroduce a bare check-then-insert in the onboarding path.

### Engineering debt

- ~~No version control in practice~~ **Resolved** — a GitHub remote (`origin`) is now configured; local commits are ahead of `origin/main`, not yet pushed (Ph8's ⚠ HUMAN gate).
- ~~Two parallel task type systems now coexist~~ **Resolved (Ph8)** — dashboard unified onto `FirmTask*`; `task-card.tsx` and the legacy `Task`/`TaskWithDetails` family deleted.
- ~~Remaining transitional aliases in `lib/types.ts`~~ **Resolved (Ph8)** — `Organization = Firm` and `'admin'|'member'` removed from `UserRole`; the deprecated `organization` field on `getAuthContext` removed (every caller reads `firm` now).
- ~~`lib/activity.ts` + `lib/notifications.ts` are still orphaned~~ **Resolved (Ph8)** — deleted.
- **Stage-change notes** land only in `task_activities`; `task_stage_history.note` is unwritable (trigger-only inserts, trigger doesn't accept a note). If notes must live in the immutable history, extend the trigger (e.g. via a session variable) in the RLS pass.
- **Task list search doesn't cover client names** (would need an embedded-resource filter or a view; title/description/period only).
- **Portal task/document lists are unpaginated** — fine for typical client volumes, revisit with real data.
- **`.update().select().single()` RETURNING caveat** — see §4.5 hardening notes (false "no permission" when a legal update moves the row out of the actor's visibility).
- ~~Pre-existing lint errors in `theme-provider.tsx`~~ **Fixed (Ph6).** ~~2 pre-existing errors in `notification-bell.tsx` + 4 unused-var warnings~~ **Fixed (Ph8)** — lint is now fully clean, zero errors/warnings, the new baseline.
- **Deprecated `middleware.ts` convention** kept deliberately (build warns; Next 16 wants `proxy.ts`) — revisit when porting completes.
- **No automated tests.** Ph7 added a committed (if not CI-wired) `scripts/verify/*.mjs` suite covering stage matrix, comments/documents, portal e2e, recurrence, and per-role RLS smoke — a real step up from ad-hoc Playwright sessions, but still not a proper test framework and not exhaustive (see §0 risks). RLS especially still needs a full policy-by-policy pass (Phase 14).
- ~~Legacy `supabase/` artifacts (old schema, migrations, cron, edge function) should be archived/deleted~~ **Resolved (Ph8)** — moved to `supabase/_legacy-deadlinetracker/` with a README (reference only, do not apply).
- ~~`templates/actions.ts` uses the `TaskTemplate` type rather than `FirmTaskTemplate`~~ **Resolved (Ph8)** — `templates/page.tsx`, `templates-page-client.tsx`, and `template-form.tsx` now use `FirmTaskTemplate`; the legacy `TaskTemplate` type deleted.
- ~~Statutory recurrence model: completion-chained spawning is unsafe for statutory compliance~~ **Schema + guard done (Ph9), generation engine still to come (Ph10).** `tasks.source` distinguishes `manual`/`recurring`/`statutory`; the Ph4 completion-chain spawn in `changeStageCore` now explicitly skips `source='statutory'`. Calendar-driven generation itself (the thing that actually creates statutory tasks on schedule) is Phase 10 — until then, no statutory tasks exist yet, so this is inert but correctly wired.

---

## 7. Plan — next steps in recommended order (v2, 2026-07-09)

Two governing rules for everything below: **(a)** never build new features on unverified foundations — Phase 7 comes before any CA-core feature work; **(b)** the final RLS pass (Phase 14) happens only once, after the schema stops moving, not once per phase.

Phase list: 7 verify · 8 unify/delete · 9 schema · 10 compliance core · 11 communication · pilot · 12 billing · 13 registers · 14 RLS · 15 SaaS.

**Single source of truth for the plan: `docs/ROADMAP.md`.**

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
| Onboarding race fixed by re-reading the winner's row on 23505, not by locking | Minimal change to an already-working design; a lock would need its own testing | 5 |
| Team's old "team lead" + role-promotion UI dropped, not ported | No schema equivalent (departments have no `lead_id`; roles are fixed at signup) — porting a nonexistent concept would mean inventing new schema, out of scope for a page-fix pass | 5 |
| Departments use `is_active` toggle, no hard delete | Mirrors the Clients module's existing no-hard-delete precedent for consistency | 5 |
| Dashboard's role/field bugs fixed without migrating it onto `FirmTask` | Kept the fix minimal/low-risk; full unification is a separate, non-urgent cleanup (§6/§7) | 5 |
| Reskin kept the existing `var(--color-x)` arbitrary-value pattern instead of switching call sites to Tailwind `@theme`-generated utility class names | Tailwind's `dark:` variant defaults to `prefers-color-scheme`, not this app's class-based toggle (confirmed zero existing `dark:` usage) — introducing it risked a theme that ignores the manual switch; the CSS-variable-in-`.dark{}` pattern already used everywhere doesn't have that failure mode | 6 |
| Badge `info` variant repointed to a new dedicated blue, not the teal accent | Brief explicitly wants status colors visually distinct from the brand accent | 6 |
| Select's chevron switched from a hardcoded data-URI SVG to a `lucide-react` icon | The data-URI baked in a fixed stroke color with no light/dark pair; an icon component can use a token | 6 |
| `compliance_types` is platform-wide (no `firm_id`), not per-firm | Same shape as `permissions`: a shared catalog every firm reads, not tenant data — avoids seeding 16 rows per firm and keeps the catalog centrally extendable | 9 |
| `department_code` on `compliance_types` is a loose TEXT match, not an FK to `departments` | `departments` rows are per-firm; the catalog is global. A code match resolves to the firm's own seeded department at generation time (Ph10), same indirection style as the fixed department code set itself | 9 |
| `client_registrations` added alongside the existing single `gstin`/`tan`/`pan` columns on `clients`, not replacing them | Clients keep one primary identifier for search/display; multi-state GSTINs and other registrations (PF/ESI/PT) live in the new table as the full applicability source for Ph10 generation | 9 |
| Audit applicability as two columns directly on `clients`, not a separate `client_compliance_profile` table | Only two fields needed right now; a new table for two booleans would be premature — add one later if the profile genuinely grows | 9 |
| `compliance_type_id` FK is `ON DELETE RESTRICT`, no DELETE policy on `compliance_types` | Mirrors the clients/departments no-hard-delete precedent — retire a compliance type via `is_active`, never orphan tasks that reference it | 9 |
| Statutory due-date rule stored as a JSONB convention (`due_day`/`months_after_period_end` or `due_day`/`due_month`), not fully modeled/enforced at the DB level | Government due-date extensions and edge cases (e.g. March TDS payment due April 30, not the usual +1 month) aren't schema-expressible; keeping it a flexible convention lets Ph10's engine special-case without another migration | 9 |

---

## 9. Key references

- `REFERENCE_ARCHITECTURE.md` — the original DeadlineTracker architecture this project is patterned on (and diverges from; see F1–F9).
- `supabase/ca-firm/ROLES_AND_RLS.md` — role model, permission resolution, client-isolation proof, flags F1–F9, deferred items.
- `supabase/ca-firm/schema.sql` — the single source of truth for the database.
- `AGENTS.md` — Next.js 16 warning: consult `node_modules/next/dist/docs/` before writing framework code.
- `src/lib/task-options.ts` — the stage-machine map; **must be kept in sync with `handle_task_stage()`** if the trigger ever changes.
- `src/app/globals.css` — the design-system source of truth (Ph6): every color token, light + dark, with contrast-ratio comments. Rebrand the teal accent by editing the 4 `--color-accent*` lines here (root + `.dark`).

---

## 10. Feature gap analysis — Indian CA day-to-day (2026-07-09 review)

A product review from a practicing-Indian-CA perspective: the current build is a **solid generic work-tracker + curated client portal**, but the CA-specific layer — the part that actually reflects how a firm's week runs — is missing. Three tiers, roughly daily → weekly/monthly → moat:

**Tier 1 — daily pain (sellability core):**

- **Compliance applicability engine + calendar-driven statutory task generation.** Client profile must capture: constitution, GST registrations (plural GSTINs per PAN, per-state, regular/composition/QRMP), TAN, PF/ESI/PT, audit applicability. Statutory tasks generate **by calendar** (e.g. on the 1st, spawn GSTR-3B for all GST clients), **not** by completion-chaining. Flaw this fixes: current recurrence spawns the next cycle only on completion → a stalled month means the next statutory task never exists.
- **Filing-status grid:** clients × periods × compliance type, red/amber/green (the partner's "18th evening" screen). Requires structured periods on tasks (`financial_year`/`period_type`/`period_key`), not free-text `period_label`.
- **Client billing & receivables:** fee master per client per service, GST-compliant firm invoices (SAC 9982), receipts, outstanding ledger, TDS u/s 194J on fees, "fees pending — hold work" flag on clients.
- **Credentials vault:** per-client encrypted store for GST/IT/TRACES/MCA/EPFO/ESIC/PT logins, permission-gated reveal, view-audit log.
- **DSC register:** physical token custody (who holds which token), in/out movement, expiry alerts.
- **Notice & assessment tracker:** IT (143(1), defective, scrutiny, 148) + GST (ASMT-10, DRC-01) with authority, section, response due date, hearings/adjournments — a long-running lifecycle distinct from routine tasks.
- **Automated reminders, WhatsApp-first:** escalating T-7/T-3/T-1 client reminders, `waiting_client` nagging, bulk sends. WhatsApp Business API outranks email for Indian clients.

**Tier 2 — weekly/monthly:**

UDIN register; FY-wise document organization + permanent file; structured filing outcomes (ARN/ack no., filed date) on completed tasks; portal-facing per-item document checklists (surface existing template `checklist_items` as received/pending); client groups (one promoter, many entities); timesheets + attendance/leave (article assistants); challan register (TDS/advance tax/GST payments per client per period).

**Tier 3 — moat (post-pilot):**

GSP/ERI portal sync (auto filing status, GSTR-2B, 26AS/AIS); Tally import; engagement letters + NOC-from-previous-auditor tracking + audit working papers.

The roadmap in §7 sequences Tier 1 across Phases 9–13 (schema in Ph9, build in Ph10, communication in Ph11, billing in Ph12, registers in Ph13); Tier 2 and Tier 3 are explicitly deferred until pilot feedback (end of §7) prioritizes them.
