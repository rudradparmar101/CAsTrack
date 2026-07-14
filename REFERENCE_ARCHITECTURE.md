# DeadlineTracker — Full Project Context

> **Purpose of this document**: A complete, deeply technical reference for any developer or AI agent picking up this project. It describes every existing feature, every architectural decision, every database table, every route, every component, and every remaining gap in exhaustive detail.

---

## 1. Project Identity

| Attribute         | Value                                                         |
|-------------------|---------------------------------------------------------------|
| **Product Name**  | DeadlineTracker                                               |
| **Type**          | Multi-tenant B2B SaaS                                         |
| **Target Market** | Small accounting firms & professional services teams          |
| **Core Problem**  | Firms miss client filing/VAT/audit deadlines because task tracking is done in spreadsheets or generic tools not built for the firm model. |
| **Primary Value** | Centralized deadline ownership with role-enforced visibility + email reminders |
| **Current State** | Feature-complete across 3 implementation phases: Phase 1 (bug fixes), Phase 2 (recurring tasks, approval workflow, client detail page, invite-code rotation), Phase 3 (file attachments, task templates, list pagination, edge function hardening). `npm run build` passes with zero errors. |

---

## 2. Technology Stack

| Layer             | Technology & Version                                       |
|-------------------|--------------------------------------------------------------|
| **Framework**     | Next.js 16.2.4 (App Router, RSC-first, Turbopack)          |
| **Language**      | TypeScript 5                                                |
| **Styling**       | Tailwind CSS v4 + custom CSS variables (via `globals.css`) |
| **UI Icons**      | Lucide React                                                |
| **Date Handling** | date-fns 4.1.0                                              |
| **Database**      | Supabase (hosted PostgreSQL)                                |
| **Auth**          | Supabase Auth (email + password only; no OAuth currently)   |
| **ORM/Client**    | `@supabase/supabase-js` + `@supabase/ssr` for cookie management |
| **Storage**       | Supabase Storage (bucket: `task-attachments`) for task file attachments |
| **Email**         | Resend API (used in the edge function for deadline reminders) |
| **Edge Runtime**  | Supabase Edge Functions (Deno runtime)                      |
| **Fonts**         | Geist Sans + Geist Mono (Google Fonts via Next.js font optimization) |

> **Next.js 16 note**: `params` and `searchParams` are Promises everywhere (dynamic route pages `await params`). The `middleware.ts` convention still works but is deprecated in favor of `proxy.ts` — this project has not yet migrated (cosmetic warning only, not a functional issue).

---

## 3. Repository Structure — Complete File Map

```
deadline-tracker/
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                  ← Root layout; sets global fonts + metadata + ThemeProvider
│   │   ├── page.tsx                    ← Public landing page (marketing)
│   │   ├── globals.css                 ← Design tokens (CSS vars) + dark mode vars + animations
│   │   ├── favicon.ico
│   │   │
│   │   ├── (auth)/                     ← Route group: unauthenticated pages
│   │   │   ├── layout.tsx              ← Split-panel auth layout (branding left, form right)
│   │   │   ├── login/
│   │   │   │   └── page.tsx            ← Login form (client component; direct Supabase signIn)
│   │   │   ├── signup/
│   │   │   │   ├── page.tsx            ← Signup form (create firm / join firm toggle)
│   │   │   │   └── actions.ts          ← Server actions: signupCreateFirmAction, signupJoinFirmAction
│   │   │   └── onboarding/
│   │   │       └── page.tsx            ← Safety-net server page; auto-creates org+profile for broken signups
│   │   │
│   │   ├── auth/
│   │   │   └── callback/
│   │   │       └── route.ts            ← GET route handler; exchanges email-verification code for session + provisions profile/org
│   │   │
│   │   └── (dashboard)/               ← Route group: all protected pages
│   │       ├── layout.tsx              ← Fetches auth context, renders DashboardShell
│   │       ├── error.tsx               ← Route-level error boundary
│   │       ├── notifications-actions.ts ← markNotificationReadAction, markAllNotificationsReadAction
│   │       ├── dashboard/
│   │       │   ├── page.tsx            ← Fetches tasks + teams (admin), renders Admin or Member dashboard
│   │       │   ├── admin-dashboard.tsx ← Analytics dashboard with completion rate, priority chart, client workload, team workload
│   │       │   ├── member-dashboard.tsx← Stats cards + overdue/pending/completed task sections
│   │       │   └── loading.tsx         ← Shimmer skeleton loading state
│   │       ├── tasks/
│   │       │   ├── page.tsx            ← Server component; fetches first page of tasks (+ clients/members/teams/templates for admin)
│   │       │   ├── tasks-page-client.tsx ← Client component; search, filters, bulk selection, pagination ("Load More"), create/edit modals
│   │       │   ├── actions.ts          ← createTaskAction, updateTaskAction, markTaskCompleteAction, deleteTaskAction, bulkCompleteAction, bulkDeleteAction, submitForReviewAction, approveTaskAction, rejectTaskAction, fetchMoreTasksAction
│   │       │   ├── loading.tsx         ← Shimmer skeleton loading state
│   │       │   └── [id]/
│   │       │       ├── page.tsx        ← Task detail server component; fetches task + comments + activities + attachments (with signed download URLs)
│   │       │       ├── task-detail-client.tsx ← Full detail view: metadata, status/approval actions, comments thread, attachments manager, activity timeline
│   │       │       ├── actions.ts      ← createCommentAction, updateCommentAction, deleteCommentAction, uploadAttachmentAction, deleteAttachmentAction
│   │       │       └── loading.tsx     ← Shimmer skeleton loading state
│   │       ├── clients/
│   │       │   ├── page.tsx            ← Server component; fetches first page of clients with creator join
│   │       │   ├── clients-page-client.tsx ← Table UI with edit/delete inline actions, pagination ("Load More"), modals
│   │       │   ├── actions.ts          ← createClientAction, updateClientAction, deleteClientAction, fetchMoreClientsAction
│   │       │   ├── loading.tsx         ← Shimmer skeleton loading state
│   │       │   └── [id]/
│   │       │       ├── page.tsx        ← Client detail server component; fetches client + all associated tasks
│   │       │       ├── client-detail-client.tsx ← Client contact info + task list/workload for this client
│   │       │       └── loading.tsx     ← Shimmer skeleton loading state
│   │       ├── team/
│   │       │   ├── page.tsx            ← Admin-only; fetches teams + first page of members + lightweight full-member list (for pickers)
│   │       │   ├── team-page-client.tsx← Team cards grid + members table (paginated) with role management (promote/demote)
│   │       │   ├── team-form.tsx       ← Create/edit team form with member multi-select
│   │       │   ├── team-invite-code.tsx← Copyable invite code card with regenerate button + clipboard fallback
│   │       │   ├── team-members-modal.tsx ← Add/remove team members modal
│   │       │   ├── actions.ts          ← createTeamAction, updateTeamAction, deleteTeamAction, addTeamMemberAction, removeTeamMemberAction, changeRoleAction, regenerateInviteCodeAction, fetchMoreMembersAction
│   │       │   └── loading.tsx         ← Shimmer skeleton loading state
│   │       ├── templates/
│   │       │   ├── page.tsx            ← Admin-only; fetches org's task templates
│   │       │   ├── templates-page-client.tsx ← Template grid with create/edit/delete
│   │       │   ├── template-form.tsx   ← Create/edit template form (title, description, default priority, recurrence, checklist items)
│   │       │   ├── actions.ts          ← createTemplateAction, updateTemplateAction, deleteTemplateAction
│   │       │   └── loading.tsx         ← Shimmer skeleton loading state
│   │       └── settings/
│   │           ├── page.tsx            ← Server component; passes profile+org to client
│   │           ├── settings-page-client.tsx ← Profile form + password change + org form (admin) + sign out (danger zone)
│   │           ├── actions.ts          ← updateProfileAction, updateOrganizationAction, changePasswordAction
│   │           └── loading.tsx         ← Shimmer skeleton loading state
│   │
│   ├── components/
│   │   ├── dashboard-shell.tsx         ← Client wrapper: sidebar state + layout grid (note: `<main>` is the scrollable region, not `<body>`)
│   │   ├── sidebar.tsx                 ← Navigation sidebar (role-based nav items incl. Templates for admins) + dark mode toggle + logout
│   │   ├── topbar.tsx                  ← Top header bar: mobile menu button + notification bell + role badge + avatar
│   │   ├── notification-bell.tsx       ← Real-time notification bell with dropdown, unread count, mark-read actions
│   │   ├── task-card.tsx               ← Individual task card with urgency badge, priority, recurrence/review badges, description expander + actions
│   │   ├── task-form.tsx               ← Reusable create/edit task form; "Create from Template" dropdown (create-mode only) prefills title/description/priority/recurrence
│   │   ├── client-form.tsx             ← Reusable create/edit client form
│   │   ├── priority-badge.tsx          ← Priority-aware colored badge (low/medium/high/critical)
│   │   ├── theme-provider.tsx          ← Dark mode context provider with localStorage persistence + system preference detection
│   │   └── ui/
│   │       ├── badge.tsx               ← Generic status badge (default/success/warning/danger/info)
│   │       ├── button.tsx              ← Button with variants (primary/secondary/danger/ghost) + loading spinner
│   │       ├── card.tsx                ← Card container with optional padding prop
│   │       ├── empty-state.tsx         ← Empty state with icon, title, description, optional CTA
│   │       ├── input.tsx               ← Input with label, hint, error display
│   │       ├── modal.tsx               ← Portal-based modal with backdrop + close button (scaleIn animation ~0.3s — account for this in screenshots/tests)
│   │       ├── select.tsx              ← Styled select dropdown with label + placeholder
│   │       └── textarea.tsx            ← Styled textarea with label, hint, error display
│   │
│   ├── lib/
│   │   ├── auth.ts                     ← getAuthContext() + getAuthProfile() server helpers
│   │   ├── types.ts                    ← All TypeScript types (enums, DB rows, joined views, analytics, ActionResult/ActionResultWithData)
│   │   ├── notifications.ts            ← createNotification() / createNotifications() helpers (shared by all server actions)
│   │   ├── activity.ts                 ← logActivity() helper for audit trail entries
│   │   ├── recurrence.ts               ← getNextDueDate() — JS mirror of the SQL next_recurrence_date() function
│   │   ├── pagination.ts               ← TASKS_PAGE_SIZE / CLIENTS_PAGE_SIZE / MEMBERS_PAGE_SIZE constants (kept out of 'use server' files, which may only export async functions)
│   │   └── supabase/
│   │       ├── client.ts               ← Browser Supabase client (singleton)
│   │       ├── server.ts               ← Server Supabase client (cookie-based)
│   │       ├── admin.ts                ← Service-role Supabase client (bypasses RLS)
│   │       └── middleware.ts           ← Session refresh + auth guard redirects
│   │
│   └── middleware.ts                   ← Next.js middleware entry point (deprecated filename in v16; still functional)
│
├── supabase/
│   ├── schema.sql                      ← Base schema (organizations, profiles, clients, tasks v1)
│   ├── migrations/
│   │   ├── 02_enterprise_features.sql  ← Adds teams, comments, attachments, activities, notifications, task_templates, team_templates
│   │   └── 03_admin_role_management.sql ← Adds RLS policy for admins to update org profiles (role changes)
│   ├── fix-rls-policies.sql            ← Idempotent RLS policy recreator (run to fix policy conflicts)
│   ├── cron.sql                        ← pg_cron job setup for daily email reminders at 9 AM UTC
│   └── functions/
│       └── send-reminders/
│           └── index.ts                ← Deno edge function: queries due-tomorrow tasks + sends Resend emails via configurable `REMINDER_FROM_EMAIL`
│
├── .env.local                          ← Environment variables (not committed)
├── package.json
├── next.config.ts
├── tsconfig.json
├── AGENTS.md                           ← AI agent rules: "read the Next.js docs in node_modules first"
├── PROJECT_CONTEXT.md                  ← This file — full project reference
└── README.md                           ← Setup instructions + test credentials
```

> **Note**: There is no scratch/report file in the repo root — a prior review artifact (`missingstuff.txt`) was removed once its findings were triaged and implemented or logged below.

---

## 4. Database Schema — Complete Table Reference

### 4.1 `organizations` (tenants)
The top-level multi-tenancy unit. Every other table has an `organization_id` FK.

| Column        | Type          | Notes                                          |
|---------------|---------------|-------------------------------------------------|
| `id`          | UUID PK       | `gen_random_uuid()`                            |
| `name`        | TEXT NOT NULL | Firm name (e.g., "Smith & Associates")         |
| `invite_code` | TEXT UNIQUE   | Random hex string; used to onboard members. Regenerable by admins (see §7.9) |
| `created_at`  | TIMESTAMPTZ   |                                                |
| `updated_at`  | TIMESTAMPTZ   | Auto-updated via trigger                       |

**RLS**: Authenticated users can SELECT their own org (matched by profile's `organization_id`). Also allows SELECT on any org so invite codes can be validated during signup. Admins can UPDATE. Any authenticated user can INSERT (needed during signup before profile exists).

---

### 4.2 `profiles`
Extends `auth.users`. Created after email verification via the `/auth/callback` route.

| Column            | Type        | Notes                                     |
|-------------------|-------------|-------------------------------------------|
| `id`              | UUID PK     | References `auth.users(id)` ON DELETE CASCADE |
| `name`            | TEXT        |                                           |
| `email`           | TEXT        |                                           |
| `role`            | TEXT        | `'admin'` or `'member'` (CHECK constraint) |
| `organization_id` | UUID FK     | References `organizations(id)`            |
| `created_at`      | TIMESTAMPTZ |                                           |
| `updated_at`      | TIMESTAMPTZ | Auto-updated via trigger                  |

**RLS**: Users see all profiles in their org. Users can update their own profile. Admins can update profiles in their org (migration 03 — needed for role changes). Users can insert only their own profile (signup).

---

### 4.3 `clients`
Client companies/individuals that tasks are associated with. Admin-only management.

| Column            | Type        | Notes                              |
|-------------------|-------------|-------------------------------------|
| `id`              | UUID PK     |                                    |
| `name`            | TEXT        |                                    |
| `organization_id` | UUID FK     |                                    |
| `created_by`      | UUID FK     | References `profiles(id)`          |
| `created_at`      | TIMESTAMPTZ |                                    |
| `updated_at`      | TIMESTAMPTZ |                                    |

**RLS**: All org members can SELECT. Only admins can INSERT/UPDATE/DELETE.
**Cascade**: Deleting a client cascades-deletes all associated tasks.

> ⚠️ **App-layer gap**: `createClientAction` validates `role === 'admin'`. `updateClientAction` and `deleteClientAction` do **not** re-check role or `organization_id` at the application layer — they rely solely on RLS. Functionally safe today (RLS blocks it), but breaks the "defense-in-depth" convention used everywhere else in the codebase. See §14.

---

### 4.4 `tasks`
The central entity of the application. Has both a base definition (schema.sql) and extended columns added via migration.

| Column              | Type               | Notes                                                         |
|---------------------|--------------------|-----------------------------------------------------------------|
| `id`                | UUID PK            |                                                               |
| `title`             | TEXT NOT NULL      |                                                               |
| `description`       | TEXT               | Editable via task form; defaults to `''`                      |
| `client_id`         | UUID FK NOT NULL   | References `clients(id)` ON DELETE CASCADE                    |
| `organization_id`   | UUID FK NOT NULL   |                                                               |
| `due_date`          | DATE NOT NULL      |                                                               |
| `status`            | TEXT               | `'pending'` \| `'completed'` \| `'pending_approval'` \| `'approved'` \| `'rejected'` |
| `priority`          | ENUM               | `'low'` \| `'medium'` \| `'high'` \| `'critical'`; default `'medium'` |
| `recurring_rule`    | ENUM               | `'none'` \| `'daily'` \| `'weekly'` \| `'monthly'` \| `'quarterly'` \| `'yearly'`; default `'none'` |
| `parent_task_id`    | UUID FK nullable   | Self-referencing; points to the original task for recurring copies |
| `assigned_to`       | UUID FK nullable   | References `profiles(id)`; individual assignee                |
| `assigned_team_id`  | UUID FK nullable   | References `teams(id)`; team assignee                         |
| `review_status`     | ENUM               | `'none'` \| `'pending_approval'` \| `'approved'` \| `'rejected'` |
| `reviewer_id`       | UUID FK nullable   | References `profiles(id)`; designated reviewer                |
| `created_by`        | UUID FK NOT NULL   | References `profiles(id)`                                     |
| `created_at`        | TIMESTAMPTZ        |                                                               |
| `updated_at`        | TIMESTAMPTZ        |                                                               |

**RLS**:
- Admins: SELECT/INSERT/UPDATE/DELETE all tasks in their org.
- Members: SELECT/UPDATE only tasks where `assigned_to = auth.uid()`.
- Members: SELECT tasks where their user_id is in `team_members` for the `assigned_team_id`.

**Key Indexes**: `organization_id`, `assigned_to`, `status`, `due_date`, `client_id`, `priority`, `recurring_rule`, `parent_task_id`, `assigned_team_id`, `reviewer_id`, `review_status`.

**Recurring generation**: When `markTaskCompleteAction` completes a task with `recurring_rule !== 'none'`, it computes the next due date via `getNextDueDate()` (`lib/recurrence.ts`) and inserts a fresh copy (same client/priority/assignee/team/reviewer, `parent_task_id` pointing back to the original), logs a `recurring_generated` activity, and notifies the assignee.

**Approval workflow**: `submitForReviewAction` (assignee → sets `review_status/status = 'pending_approval'`, requires a `reviewer_id` to already be set), `approveTaskAction` / `rejectTaskAction` (reviewer or any admin → sets `review_status` to `'approved'`/`'rejected'`, and `status` to `'completed'`/`'pending'` respectively). All three log activity and notify the relevant party.

---

### 4.5 `teams`
Groups of members within an organization. Tasks can be assigned to a team instead of an individual.

| Column            | Type        | Notes                         |
|-------------------|-------------|--------------------------------|
| `id`              | UUID PK     |                               |
| `organization_id` | UUID FK     |                               |
| `name`            | TEXT        |                               |
| `description`     | TEXT        |                               |
| `lead_id`         | UUID FK     | References `profiles(id)`     |
| `created_at`      | TIMESTAMPTZ |                               |
| `updated_at`      | TIMESTAMPTZ |                               |

**RLS**: All org members can SELECT. Only admins can INSERT/UPDATE/DELETE.

---

### 4.6 `team_members`
Junction table linking profiles to teams.

| Column      | Type        | Notes                 |
|-------------|-------------|------------------------|
| `team_id`   | UUID FK PK  |                       |
| `user_id`   | UUID FK PK  |                       |
| `joined_at` | TIMESTAMPTZ |                       |

**RLS**: All org members can SELECT. Only admins can INSERT/DELETE.

---

### 4.7 `task_comments`
Comments on tasks with @mention support stored as UUID arrays.

| Column            | Type        | Notes                       |
|-------------------|-------------|------------------------------|
| `id`              | UUID PK     |                             |
| `task_id`         | UUID FK     |                             |
| `organization_id` | UUID FK     |                             |
| `content`         | TEXT        |                             |
| `mentions`        | UUID[]      | Array of mentioned user IDs |
| `created_by`      | UUID FK     |                             |
| `created_at`      | TIMESTAMPTZ |                             |
| `updated_at`      | TIMESTAMPTZ |                             |

**RLS**: All org members can SELECT. Users can INSERT/UPDATE/DELETE only their own comments.

---

### 4.8 `task_attachments` *(implemented in UI as of Phase 3)*
File attachments for tasks. Files are stored in Supabase Storage (bucket path stored in `file_path`).

| Column            | Type        | Notes                     |
|-------------------|-------------|----------------------------|
| `id`              | UUID PK     |                           |
| `task_id`         | UUID FK     |                           |
| `organization_id` | UUID FK     |                           |
| `file_name`       | TEXT        |                           |
| `file_path`       | TEXT        | Path in Supabase Storage: `{organization_id}/{task_id}/{uuid}.{ext}` |
| `file_type`       | TEXT        | MIME type                 |
| `file_size`       | BIGINT      | In bytes                  |
| `uploaded_by`     | UUID FK     |                           |
| `created_at`      | TIMESTAMPTZ |                           |

**RLS**: All org members can SELECT. Users can INSERT/DELETE only their own attachments.

**UI**: `tasks/[id]/task-detail-client.tsx` has an "Attachments" card between Comments and Activity Timeline — file picker upload (10MB limit, enforced in `uploadAttachmentAction`), list with uploader name/size/relative-time, signed-URL download link (1hr expiry, generated server-side in `page.tsx`), and a delete button shown only to the uploader.

> ⚠️ **Infra dependency**: Requires the `task-attachments` Storage bucket to exist in the connected Supabase project. If it doesn't, uploads fail cleanly with an inline `"Bucket not found"` error (verified in manual testing) rather than crashing — but the feature is non-functional until the bucket is created. See §15.

---

### 4.9 `task_activities`
Immutable audit log of all state changes on tasks.

| Column            | Type        | Notes                                          |
|-------------------|-------------|--------------------------------------------------|
| `id`              | UUID PK     |                                                |
| `task_id`         | UUID FK     |                                                |
| `organization_id` | UUID FK     |                                                |
| `actor_id`        | UUID FK     |                                                |
| `action_type`     | TEXT        | One of the `ActivityType` enum values          |
| `old_value`       | JSONB       | Previous state snapshot                        |
| `new_value`       | JSONB       | New state snapshot                             |
| `created_at`      | TIMESTAMPTZ |                                                |

**Activity Types**: `task_created`, `assignment_changed`, `status_changed`, `priority_changed`, `due_date_changed`, `comment_added`, `comment_edited`, `comment_deleted`, `attachment_uploaded`, `attachment_deleted`, `task_completed`, `task_approved`, `task_rejected`, `reviewer_changed`, `team_assigned`, `recurring_generated`.

**RLS**: All org members can SELECT. Users can INSERT (actor_id must match auth.uid()). No UPDATE or DELETE (immutable).

---

### 4.10 `notifications`
In-app notification system.

| Column           | Type        | Notes                                  |
|------------------|-------------|------------------------------------------|
| `id`             | UUID PK     |                                        |
| `user_id`        | UUID FK     |                                        |
| `organization_id`| UUID FK     |                                        |
| `type`           | TEXT        | One of the `NotificationType` enum values |
| `title`          | TEXT        |                                        |
| `message`        | TEXT        |                                        |
| `reference_id`   | UUID        | nullable; e.g., the task ID            |
| `reference_type` | TEXT        | nullable; e.g., `'task'`               |
| `is_read`        | BOOLEAN     | Default false                          |
| `created_at`     | TIMESTAMPTZ |                                        |

**Notification Types**: `task_assigned`, `comment_added`, `mentioned_in_comment`, `due_date_approaching`, `task_overdue`, `task_completed`, `approval_requested`, `task_approved`, `task_rejected`.

**RLS**: Users can SELECT/UPDATE only their own notifications. INSERT is allowed for any org member.

---

### 4.11 `team_templates` *(seeded, still not surfaced in UI)*
System-level templates for creating teams with pre-defined roles. Pre-seeded with 4 templates.

| Column          | Type    | Notes                                |
|-----------------|---------|----------------------------------------|
| `id`            | UUID PK |                                      |
| `name`          | TEXT    | e.g., "Engineering Team"             |
| `description`   | TEXT    |                                      |
| `default_roles` | JSONB   | Array of role title strings          |
| `is_system`     | BOOLEAN | True for pre-seeded templates        |

**Seeded templates**: Engineering Team, Design Team, Marketing Team, Operations Team.

> ⚠️ **UI Status**: Still not surfaced anywhere — this is a distinct feature from `task_templates` (§4.12) and remains a genuine gap. See §8.

---

### 4.12 `task_templates` *(implemented in UI as of Phase 3)*
Organization-specific task templates with default priority, checklists, and recurrence rules.

| Column              | Type        | Notes                            |
|---------------------|-------------|------------------------------------|
| `id`                | UUID PK     |                                  |
| `organization_id`   | UUID FK     |                                  |
| `title`             | TEXT        |                                  |
| `description`       | TEXT        |                                  |
| `default_priority`  | ENUM        |                                  |
| `checklist_items`   | JSONB       | Array of `{ id, text, completed }` objects |
| `recurring_rule`    | ENUM        |                                  |
| `created_by`        | UUID FK     |                                  |
| `created_at`        | TIMESTAMPTZ |                                  |
| `updated_at`        | TIMESTAMPTZ |                                  |

**RLS**: All org members can SELECT. Only admins can INSERT/UPDATE/DELETE.

**UI**: Admin-only `/templates` route — grid of template cards (priority badge, recurrence, checklist item count) with create/edit/delete. `checklist_items` is authored as one line of free text per item in the form (`template-form.tsx` splits on newline and generates `{ id: crypto.randomUUID(), text, completed: false }` per line). The task creation form (`task-form.tsx`) offers a "Create from Template" dropdown that copies `title`, `description`, `default_priority`, and `recurring_rule` into the new-task form fields — it does **not** copy `checklist_items` onto the created task, because live tasks have no checklist column yet (see §8).

> ⚠️ **Infra dependency**: Requires migration `02_enterprise_features.sql` to have been applied to the connected Supabase project (creates this table). If it hasn't, template create/update fails cleanly with an inline `"Could not find the table 'public.task_templates' in the schema cache"` error rather than crashing — but the feature is non-functional until the migration runs. Verified via manual testing in this repo's dev environment, where this table was found to be missing. See §15.

---

### 4.13 Database Helper Functions

| Function                     | Returns | Description                                   |
|-------------------------------|---------|-------------------------------------------------|
| `get_user_org_id()`          | UUID    | Returns current authenticated user's `organization_id` from profiles |
| `get_user_role()`            | TEXT    | Returns current authenticated user's `role` from profiles |
| `handle_updated_at()`        | TRIGGER | Auto-sets `updated_at = now()` before each UPDATE |
| `next_recurrence_date(date, rule)` | DATE | Pure SQL function mirrored client-side by `lib/recurrence.ts`'s `getNextDueDate()` |
| `regenerate_invite_code_for_org(org_id)` | — | RPC used by `regenerateInviteCodeAction`; falls back to a client-generated hex code + direct UPDATE if the RPC is unavailable |

---

## 5. Authentication & Onboarding Flow — Deep Dive

### 5.1 Supabase Client Initialization (3 clients)

| Client File             | Created By          | Bypasses RLS? | Use Case                                     |
|-------------------------|-----------------------|---------------|------------------------------------------------|
| `lib/supabase/client.ts` | `createBrowserClient` | No          | Browser-side operations (login, logout, sign out) |
| `lib/supabase/server.ts` | `createServerClient` | No           | Server Components, Route Handlers, Server Actions |
| `lib/supabase/admin.ts`  | `createClient` with service role key | **Yes** | Profile/org provisioning during signup (where normal user has no profile yet) |

### 5.2 Signup — "Create Firm" Mode
1. User fills: Name, Email, Password, Firm Name → clicks "Create Account & Firm".
2. `signupCreateFirmAction` (Server Action) runs:
   - Validates all fields.
   - Calls `supabase.auth.signUp()` with `user_metadata = { name, orgName, signup_mode: 'create_firm' }`.
   - `emailRedirectTo` = `NEXT_PUBLIC_SITE_URL + /auth/callback`.
   - Returns `{ requiresEmailConfirmation: true }`.
3. UI shows "Check your email" screen.
4. User clicks verification link → browser hits `/auth/callback?code=...`.
5. `/auth/callback` route handler:
   - Calls `supabase.auth.exchangeCodeForSession(code)`.
   - Reads `user_metadata.signup_mode === 'create_firm'`.
   - Uses **admin client** to INSERT into `organizations` (org name from metadata).
   - Uses **admin client** to INSERT into `profiles` (role = `'admin'`).
   - On any failure → redirects to `/onboarding`.
   - On success → redirects to `/dashboard`.

### 5.3 Signup — "Join Firm" Mode
1. User fills: Name, Email, Password, Invite Code → clicks "Join & Create Account".
2. `signupJoinFirmAction` (Server Action) runs:
   - **Validates invite code first** using admin client (before creating auth user) — returns error if code is invalid.
   - Calls `supabase.auth.signUp()` with `user_metadata = { name, inviteCode, signup_mode: 'join_firm' }`.
3. Same email verification flow.
4. `/auth/callback` reads `signup_mode === 'join_firm'`:
   - Looks up org by `invite_code`.
   - Inserts profile with `role = 'member'` and found `organization_id`.

### 5.4 Onboarding Safety Net
`/onboarding` is a server-side page that handles broken signups (e.g., interrupted after auth user creation but before profile creation). It:
- Checks if profile exists; if it has an org.
- If not, auto-creates a default org named `"{email_prefix}'s Firm"` and a profile (role: admin).
- Redirects to `/dashboard`.

### 5.5 Login
- Simple email/password via `supabase.auth.signInWithPassword()` in the browser.
- No server action — purely client-side.
- On success, `router.push('/dashboard')` + `router.refresh()`.

### 5.6 Middleware Auth Guard
`src/middleware.ts` applies to all routes except static assets. `updateSession()` in `lib/supabase/middleware.ts`:
- Refreshes the Supabase session on every request (critical for keeping JWTs valid).
- **Unauthenticated** user hitting a dashboard route → redirect `/login`.
- **Authenticated** user hitting `/login` or `/signup` → redirect `/dashboard`.
- `/`, `/auth/*`, `/onboarding` are public (no guard).

### 5.7 Auth Context Helper (`lib/auth.ts`)
Two helper functions used in Server Components:
- `getAuthContext()`: Fetches user, profile, and organization. Redirects to `/login` or `/onboarding` on failure. Used by dashboard layout and most pages.
- `getAuthProfile()`: Same but skips org fetch. Lighter; used in server actions where only org_id is needed.

---

## 6. Role-Based Access Control (RBAC)

### Admin Capabilities
- View **all tasks** in the organization (all clients, all assignees).
- **Create**, **edit**, **delete** tasks (single and bulk); assign a reviewer and recurrence rule.
- **Approve/reject** tasks submitted for review (as the designated reviewer, or any admin as a fallback).
- **Create**, **edit**, **delete** clients; view a client's detail page and task workload.
- **Create**, **edit**, **delete** teams; add/remove team members.
- **Create**, **edit**, **delete** task templates; templates feed the "Create from Template" picker on the task form.
- **Promote/demote** members (change roles between admin/member).
- View the **Team** page (paginated member list + team cards + invite code).
- **Copy or regenerate** the invite code (regeneration immediately invalidates the old code).
- View **Settings** page: update own profile, change password, update organization name.
- Admin dashboard shows analytics: completion rate, priority distribution, client workload, team workload.
- **Bulk actions**: select multiple tasks and complete/delete them.
- Upload/delete file attachments on any task (delete restricted to own uploads, same as members).

### Member Capabilities
- View **only tasks assigned to them** (or assigned to their team) — enforced by RLS at DB level, not just UI.
- **Mark tasks complete** (via `markTaskCompleteAction`), or **submit for review** if a reviewer is assigned to the task.
- **Approve/reject** tasks where they are the designated `reviewer_id`.
- **Add comments** to assigned tasks with notification triggers.
- **Upload/delete** file attachments on tasks they can see (delete restricted to their own uploads).
- View **Settings** page: update own profile and change password.
- Member dashboard shows stats cards (pending, overdue, due soon, completion %) + task sections.
- **Cannot** access `/clients`, `/team`, or `/templates` (server-side redirect to `/dashboard` for the latter two; RLS returns empty for `/clients`).

### Enforcement Layers
1. **Postgres RLS** — primary enforcement. Even if UI is bypassed, the DB returns only permitted data.
2. **Server Action checks** — secondary. Most actions re-verify role and re-scope by `organization_id` before mutating data. Known exception: `updateClientAction`/`deleteClientAction` (see §4.3, §14).
3. **UI-level** — tertiary. Conditional rendering based on `profile.role`.
4. **Middleware** — ensures no unauthenticated access to any dashboard route.

---

## 7. Existing Features — All Implemented

### 7.1 Landing Page
- Public marketing page at `/`.
- Sticky nav with "Sign in" and "Get Started" links.
- Hero section: headline + CTA buttons.
- Features grid: 6 feature cards (Task Management, Team Collaboration, Dashboard Views, Secure & Isolated, Email Reminders, Lightning Fast).
- CTA banner section.
- Footer with copyright.

### 7.2 Authentication Pages
- **Login** (`/login`): Email + password form with error display. Client-side Supabase call.
- **Signup** (`/signup`): Toggle between "Create Firm" and "Join a Firm" modes. Shows "Check your email" success state.
- Both pages use the auth layout: dark branding panel on left (desktop), form panel on right.

### 7.3 Dashboard — Admin View
- **Completion rate** card with animated gradient progress bar.
- **Priority breakdown** horizontal bar chart for pending tasks (critical/high/medium/low).
- **Client workload** top 5 clients by pending tasks with pending/done badge counts.
- **Team workload** grid of team cards showing pending/done counts per team.
- **Overdue** section with pulsing red dot indicator + task cards.
- **Due This Week** section (tasks due within 7 days, not already overdue).
- **Unassigned tasks** section highlighting tasks with no assignee.
- Empty state card when no tasks exist.

### 7.4 Dashboard — Member View
- **Stats cards**: Pending, Overdue, Due Soon (≤3 days), Completion %.
- **Overdue** section with pulsing red dot indicator.
- **To Do** section with pending tasks.
- **Completed** section.
- Empty state when no tasks assigned.

### 7.5 Tasks Page
- **Admin view**: Shows a first page of org tasks (see §7.16 Pagination). Full-featured search + filter bar. "New Task" button. Task grid (responsive 1/2/3 columns). Bulk selection with checkboxes.
- **Member view**: Shows only assigned/team tasks. No "New Task" button. No bulk actions.
- **Search**: Instant client-side text search across title, client name, assignee name, description (searches only the tasks currently loaded — see §7.16).
- **Status tabs**: All / Pending / Completed (segmented control).
- **Priority filter**: Buttons with colored dots for Critical/High/Medium/Low.
- **Assignee filter**: Dropdown (admin only).
- **Team filter**: Dropdown (admin only).
- **Active filter badge**: Shows count of active advanced filters.
- **Clear all**: Single button to reset every filter.
- **Bulk selection**: Select-all checkbox + per-task checkboxes with indigo ring highlight. Floating bottom toolbar with Complete/Delete buttons.
- **Create Modal**: Opens a `<Modal>` with `<TaskForm>`. Fields: optional "Create from Template" picker, Title, Description, Client, Due Date, Priority, Recurrence, Assign To, Assign Team, Reviewer.
- **Edit Modal**: Same form pre-filled with existing task data (template picker hidden in edit mode) + Status field.
- **Smart empty state**: Changes message based on active filters.

### 7.6 Task Detail Page (`/tasks/[id]`)
- **Metadata section**: Title, client, due date, priority badge, urgency badge, assigned person/team, reviewer, review status, recurrence, status.
- **Quick actions**: "Mark Complete" (pending, no reviewer flow), "Submit for Review" (assignee, when a reviewer is set), "Approve"/"Reject" (reviewer or admin, when `pending_approval`), "Back to Tasks" link, admin-only "Delete".
- **Description display**: Full description shown below metadata.
- **Comments thread**: Chronological comments with author avatar, name, timestamp. Add comment form with textarea (Ctrl+Enter to submit). Edit/delete own comments (inline edit mode). Notifications triggered on comment creation.
- **Attachments manager**: File picker upload (10MB limit), list of existing attachments (name, size, uploader, relative time), signed-URL download link, delete button shown only to the uploader. Empty state when none exist.
- **Activity timeline**: Chronological feed of all task events (created, status/priority/due-date/assignment changed, comments added/edited/deleted, attachments uploaded/deleted, task completed/approved/rejected, recurring copy generated). Shows actor name, timestamps, and old→new value diffs for field changes.

### 7.7 Task Card Component
- Shows: task title (struck-through if completed), client name, urgency badge, due date, priority badge, assigned person/team, recurrence badge, review-status badge.
- Expandable description section (collapsible toggle).
- Urgency badge variants: `Overdue` (danger, pulsing dot), `Due Soon` (warning, dot), `Upcoming` (default), `Completed` (success).
- Opacity dimmed for completed tasks.
- "Complete" button hidden when already completed; shows green checkmark when done.
- Edit/Delete buttons appear on hover (opacity: 0 → 1 transition).

### 7.8 Clients Page
- Table listing a first page of clients (see §7.16 Pagination): Name (links to detail page), Created By, Created Date, Actions.
- **Add Client** button → modal with name field.
- **Edit**/**Delete** buttons per row → modal / `confirm()` dialog warning about cascading task deletion.
- Responsive: "Created By" column hidden on small screens, "Created" hidden on medium screens.

### 7.9 Client Detail Page (`/clients/[id]`)
- Admin-only. Shows client contact/creation info plus every task associated with that client (fetched independently of the clients list pagination — this query is not paginated, since a single client's task count is naturally small relative to the org-wide task table).
- Gives admins a per-client view of workload, overdue items, and completion status without leaving the client's context.

### 7.10 Team Page (Admin only)
- Redirects members to `/dashboard`.
- **Invite Code card**: Shows the hex invite code with a copy button (clipboard API + `execCommand` fallback) and a **regenerate** button (confirms destructively, immediately invalidates the old code via `regenerateInviteCodeAction`).
- **Team cards grid**: Each team shows name, member count, lead name, and action buttons (Edit, Manage Members, Delete). Empty state when no teams. *(Not paginated — team counts are small relative to member/task counts.)*
- **Create/Edit team modal**: Name + description + lead + member multi-select checkboxes. The member picker uses an **unpaginated, lightweight** (`id, name, email` only) member list fetched separately from the paginated table below, so team assignment always sees every org member regardless of table page size.
- **Manage members modal**: Add/remove members from a team via checkbox list (same lightweight member list).
- **Members table**: Paginated (see §7.16) — Name (avatar initials), Email, Role badge, Teams list, Promote/Demote action. Self-row shows "(you)" with no action button. Confirmation dialog + last-admin/self-demotion protections.

### 7.11 Task Templates Page (`/templates`, Admin only)
- Redirects members to `/dashboard`.
- Grid of template cards: title, description preview, default-priority badge, recurrence badge, checklist item count.
- **Create/Edit modal** (`template-form.tsx`): Title, Description, Default Priority, Default Recurrence, and a "Checklist Items" textarea (one item per line → parsed into `{ id, text, completed: false }` objects).
- **Delete** with confirmation.
- Consumed by `task-form.tsx`'s "Create from Template" dropdown when creating a new task.

### 7.12 Settings Page
- **Profile section**: Edit name only. Email is read-only (Supabase auth email). Shows current role badge.
- **Change Password section**: New password + confirm password inputs. Show/hide toggle. Minimum 8 characters validation. Confirms match. Form resets on success.
- **Organization section** (admin only): Edit organization name. Shows invite code as read-only.
- **Danger Zone section**: Sign Out button.
- Success/error toast messages auto-dismiss after 4 seconds.

### 7.13 Notification System
- **Notification bell** in topbar with unread count badge (animated pulse).
- **Dropdown panel**: Lists recent notifications with type icons, title, message, relative timestamps. Mark individual/all as read.
- **Backend**: `createNotification()` / `createNotifications()` in `lib/notifications.ts`. Called on task assignment, comment creation, task completion, approval-requested, task approved/rejected, recurring task creation. Fails silently to avoid blocking mutations.

### 7.14 Activity Logging
- **Backend helper**: `logActivity()` in `lib/activity.ts`.
- **Integrated into**: task creation/update/completion/deletion, comment add/edit/delete, attachment upload/delete, bulk completion, submit-for-review/approve/reject, recurring task generation.
- **UI**: Activity timeline in task detail page with chronological ordering, actor names, and value-change diffs.

### 7.15 Sidebar Navigation
- **Admin nav**: Dashboard, Clients, Tasks, Templates, Team, Settings.
- **Member nav**: Dashboard, My Tasks, Settings.
- Active route highlighted. Dark mode toggle. Mobile off-canvas drawer.
- **Note**: `dashboard-shell.tsx`'s `<main>` element is `overflow-y-auto` inside an `h-screen overflow-hidden` wrapper — the page scrolls *inside `<main>`*, not the document body. This matters for any tooling (screenshot scripts, scroll-to-element logic) that assumes body-level scrolling.

### 7.16 Pagination
- **Tasks** (`TASKS_PAGE_SIZE = 24`), **Clients** (`CLIENTS_PAGE_SIZE = 20`), and **Team Members** (`MEMBERS_PAGE_SIZE = 20`) lists use offset pagination via Supabase `.range()`, with constants centralized in `lib/pagination.ts`.
- Each list page fetches page 1 server-side and passes `initialHasMore` (`rows.length === PAGE_SIZE`) to the client component. The client keeps the list in state, and a **"Load More"** button calls a `fetchMore*Action` server action (`fetchMoreTasksAction`, `fetchMoreClientsAction`, `fetchMoreMembersAction`) with the current offset, appending results and recomputing `hasMore`.
- When the server passes a *new* `tasks`/`clients`/`members` array reference (e.g., after a `revalidatePath` following a create/update/delete), the paginated state resets back to page 1. This reset is implemented via React's "adjust state during render" pattern (a `prev*` state variable compared during render) rather than `useEffect`, to satisfy the `react-hooks/set-state-in-effect` lint rule and avoid an extra render pass.
- Search/filtering on the Tasks page is **client-side over whatever is currently loaded** — it does not re-query the server, so a search term won't surface results beyond the loaded pages until "Load More" is used.
- Team creation/lead-assignment/member-management pickers deliberately use a **separate, unpaginated, lightweight** member query (id/name/email only) so they aren't limited by the members table's page size (see §7.10).

### 7.17 Bulk Actions
- **Select all** checkbox above the task grid with count label (scoped to currently-loaded + filtered tasks).
- **Per-task checkboxes**, indigo ring highlight on selected cards.
- **Floating toolbar**: Complete (all users) / Delete (admin only) / dismiss.
- **Server actions**: `bulkCompleteAction`, `bulkDeleteAction` (admin-only, `.in()`).

### 7.18 Loading States
All dashboard pages (including `/templates` and `/clients/[id]`) have `loading.tsx` files rendering shimmer skeleton UIs.

### 7.19 Email Reminder Edge Function
- Supabase Edge Function at `supabase/functions/send-reminders/index.ts`, Deno runtime.
- **Logic**: Queries tasks where `status = 'pending'` AND `due_date = tomorrow's date` AND `assigned_to IS NOT NULL`.
- Sends an HTML email per task via Resend API. `from` address is read from the `REMINDER_FROM_EMAIL` secret, falling back to `DeadlineTracker <onboarding@resend.dev>` (Resend's sandbox sender, which works without a verified custom domain) if unset.
- Returns JSON with count of sent emails and per-task results.
- **Trigger**: Via `pg_cron` scheduled at `0 9 * * *` (9 AM UTC daily), which calls `pg_net.http_post()` to invoke the edge function.
- **Still hardcoded**: the "due tomorrow" lookback window itself is not configurable (see §8).

### 7.20 Design System
Implemented via CSS custom properties in `globals.css` with full dark mode support.

**Light theme**:
```
--color-primary:         #6366f1  (Indigo)
--color-primary-hover:   #4f46e5
--color-primary-light:   #eef2ff
--color-sidebar:         #0f172a  (Dark slate — sidebar background)
--color-sidebar-hover:   #1e293b
--color-sidebar-text:    #94a3b8
--color-sidebar-active:  #e2e8f0
--color-danger:          #ef4444  (Red)
--color-danger-bg:       #fef2f2
--color-warning:         #f59e0b  (Amber)
--color-warning-bg:      #fffbeb
--color-success:         #10b981  (Emerald)
--color-success-bg:      #ecfdf5
--color-surface:         #ffffff
--color-background:      #f8fafc
--color-border:          #e2e8f0
--color-text:            #0f172a
--color-text-secondary:  #64748b
--color-text-muted:      #94a3b8
--color-input-bg:        #ffffff
```

**Dark theme** (`.dark` class on `<html>`):
```
--color-primary:         #818cf8
--color-primary-hover:   #6366f1
--color-primary-light:   rgba(99,102,241,0.15)
--color-sidebar:         #0c0f1a
--color-surface:         #1a1f33
--color-background:      #0f1225
--color-border:          #2a2f45
--color-text:            #e8eaf0
--color-text-secondary:  #9ca3bd
--color-text-muted:      #6b728f
--color-input-bg:        #1e2338
```

**Tailwind overrides**: Targeted `.dark .bg-white` / `.dark .bg-gray-*` / `.dark .hover\:bg-gray-*` selectors in `globals.css` re-theme components that still use hardcoded Tailwind utility classes (several `ui/` primitives do this internally, e.g. `Input`/`Select`/`Button`'s `secondary` variant) so they remain dark-mode-correct without per-component edits. New code should still prefer `var(--color-*)` directly; the override exists as a safety net, not a license to add more hardcoded classes.

**Animations**: `fadeIn`, `slideIn`, `scaleIn` (~0.3s, used for modals — screenshot/automation tooling should wait for it to settle), `shimmer`, `pulse-dot`.

**Typography**: Geist Sans (variable font) from Google Fonts via Next.js optimization.

---

## 8. Known Remaining Gaps

These are the genuine, still-open gaps as of the end of Phase 3 — everything else previously tracked here (recurring tasks, approval workflow, attachments, task templates, client detail page, invite code rotation, pagination) has been implemented and moved into §7.

### 8.1 Sub-task Checklists on Live Tasks
- **Schema/Types**: `ChecklistItem { id, text, completed }` exists and is used by `task_templates.checklist_items`.
- **Gap**: The `tasks` table itself has no `checklist_items` column. Selecting a template on the task form copies `title`/`description`/`default_priority`/`recurring_rule` but **not** the checklist — there is nowhere on a live task to store or display it yet.

### 8.2 Configurable Email Reminders
- **Gap**: The edge function is still hardcoded to remind users of tasks due exactly "tomorrow." There is no settings panel for admins/users to choose a custom lead time (e.g., 3 days before, 1 week before). Only the `from` address became configurable in Phase 3 (`REMINDER_FROM_EMAIL`).

### 8.3 `team_templates` Never Surfaced
- **Gap**: Seeded system templates for creating teams (Engineering/Design/Marketing/Operations) exist in the DB but have no UI anywhere. Distinct from the now-implemented `task_templates` feature — don't conflate the two.

### 8.4 Client Mutation Actions Missing Defense-in-Depth Checks
- **Gap**: `updateClientAction` and `deleteClientAction` (`clients/actions.ts`) don't re-validate `role === 'admin'` or scope by `organization_id` at the application layer — only `createClientAction` does. RLS still blocks unauthorized writes, but this breaks the pattern used everywhere else (tasks, teams, templates all double-check).

### 8.5 `cron.sql` Placeholder URL
- **Gap**: References `https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-reminders` — must be filled in per-environment before the cron job will actually invoke the edge function. Inherent to self-hosted setup, not fixable in code.

### 8.6 No Optimistic UI Updates
- **Gap**: All mutations (including the new pagination "Load More" and attachment upload/delete) wait for a full server round-trip before the UI updates. Acceptable for this app's usage pattern, but noted for completeness.

---

## 9. Server Actions — Complete Reference

All Server Actions use `'use server'` directive and the server Supabase client (except the admin-only signup path, which additionally uses the service-role client via `lib/supabase/admin.ts`).

### Tasks (`src/app/(dashboard)/tasks/actions.ts`)
| Action                   | Who Can Call | What It Does                                      |
|--------------------------|--------------|-----------------------------------------------------|
| `createTaskAction`       | Admin only   | Inserts task; logs activity; notifies assignee |
| `updateTaskAction`       | Admin only   | Updates task fields; logs field-level diffs; notifies on reassignment |
| `markTaskCompleteAction` | Any user (own/assigned task) | Sets `status = 'completed'`; logs activity; notifies creator; auto-generates the next recurring copy if `recurring_rule !== 'none'` |
| `deleteTaskAction`       | Admin only   | Deletes task, org-scoped                            |
| `bulkCompleteAction`     | Any user     | Iterates over task IDs, marks each complete, logs activity per task |
| `bulkDeleteAction`       | Admin only   | Deletes multiple tasks via `.in()`, org-scoped        |
| `submitForReviewAction`  | Assignee     | Requires a `reviewer_id`; sets `review_status/status = 'pending_approval'`; notifies reviewer |
| `approveTaskAction`      | Reviewer or admin | Sets `review_status = 'approved'`, `status = 'completed'`; notifies assignee |
| `rejectTaskAction`       | Reviewer or admin | Sets `review_status = 'rejected'`, `status = 'pending'`; optional reason; notifies assignee |
| `fetchMoreTasksAction`   | Any user     | Returns the next page of tasks (org-scoped; RLS further restricts members to their own/team tasks) |

All mutating actions revalidate `/tasks` and `/dashboard` (and `/tasks/[id]` where relevant) after mutation.

### Task Comments & Attachments (`src/app/(dashboard)/tasks/[id]/actions.ts`)
| Action                    | Who Can Call | What It Does                                       |
|---------------------------|--------------|------------------------------------------------------|
| `createCommentAction`     | Any user     | Inserts comment; logs activity; notifies assignee + creator |
| `updateCommentAction`     | Own comments | Updates comment content; logs activity              |
| `deleteCommentAction`     | Own comments | Deletes comment; logs activity                      |
| `uploadAttachmentAction`  | Any user (task in own org) | Validates 10MB limit; uploads to Storage bucket `task-attachments` at `{org}/{task}/{uuid}.{ext}`; inserts `task_attachments` row; logs activity; rolls back the storage object if the DB insert fails |
| `deleteAttachmentAction`  | Own uploads only | Deletes DB row + storage object; logs activity |

### Clients (`src/app/(dashboard)/clients/actions.ts`)
| Action                   | Who Can Call | What It Does                      |
|--------------------------|--------------|-------------------------------------|
| `createClientAction`     | Admin only   | Inserts client; validates role      |
| `updateClientAction`     | Any authenticated user *(gap, see §8.4)* | Updates client name |
| `deleteClientAction`     | Any authenticated user *(gap, see §8.4)* | Deletes client (cascades tasks) |
| `fetchMoreClientsAction` | Any user     | Returns the next page of clients, org-scoped |

### Teams (`src/app/(dashboard)/team/actions.ts`)
| Action                       | Who Can Call | What It Does                                      |
|-------------------------------|--------------|-----------------------------------------------------|
| `createTeamAction`           | Admin only   | Creates team + bulk inserts team members           |
| `updateTeamAction`           | Admin only   | Updates team name/description/lead                  |
| `deleteTeamAction`           | Admin only   | Deletes team (cascades team_members)               |
| `addTeamMemberAction`        | Admin only   | Adds a member to a team (double-checks team + target profile are same-org) |
| `removeTeamMemberAction`     | Admin only   | Removes a member from a team                        |
| `changeRoleAction`           | Admin only   | Promotes/demotes a member; prevents self-demotion and last-admin demotion |
| `regenerateInviteCodeAction` | Admin only   | Calls `regenerate_invite_code_for_org` RPC, falling back to a client-generated hex code + direct UPDATE |
| `fetchMoreMembersAction`     | Any user     | Returns the next page of org members, org-scoped     |

### Task Templates (`src/app/(dashboard)/templates/actions.ts`)
| Action                  | Who Can Call | What It Does                                       |
|--------------------------|--------------|-------------------------------------------------------|
| `createTemplateAction`  | Admin only   | Parses newline-delimited checklist text into `ChecklistItem[]`; inserts template |
| `updateTemplateAction`  | Admin only   | Same parsing; updates template, org-scoped            |
| `deleteTemplateAction`  | Admin only   | Deletes template, org-scoped                          |

### Settings (`src/app/(dashboard)/settings/actions.ts`)
| Action                      | Who Can Call | What It Does                             |
|-------------------------------|--------------|--------------------------------------------|
| `updateProfileAction`       | Any user     | Updates `profiles.name` for current user |
| `updateOrganizationAction`  | Admin only   | Updates `organizations.name`             |
| `changePasswordAction`      | Any user     | Validates 8+ chars, confirms match, calls `supabase.auth.updateUser()` |

### Notifications (`src/app/(dashboard)/notifications-actions.ts`)
| Action                           | Who Can Call | What It Does                          |
|------------------------------------|--------------|------------------------------------------|
| `markNotificationReadAction`     | Own only     | Sets `is_read = true` on a notification |
| `markAllNotificationsReadAction` | Own only     | Sets `is_read = true` on all user notifications |

### Signup (`src/app/(auth)/signup/actions.ts`)
| Action                      | Who Can Call     | What It Does                                                          |
|-------------------------------|------------------|---------------------------------------------------------------------------|
| `signupCreateFirmAction`    | Unauthenticated  | Calls `supabase.auth.signUp()` with create_firm metadata             |
| `signupJoinFirmAction`      | Unauthenticated  | Validates invite code, then calls `supabase.auth.signUp()` with join_firm metadata |

---

## 10. Component Library — Reusable UI

### Primitives (`src/components/ui/`)

| Component      | Props of Note                                     | Description                                |
|-----------------|-----------------------------------------------------|-----------------------------------------------|
| `Button`       | `variant` (primary/secondary/danger/ghost), `size` (sm/md/lg), `loading` (bool) | Renders spinner when loading               |
| `Input`        | `label`, `hint`, `error` + all native input props | Styled input with floating label           |
| `Textarea`     | `label`, `hint`, `error` + all native textarea props | Styled textarea, resizable                 |
| `Select`       | `label`, `options: [{value, label}]`, `placeholder`, `defaultValue`/`value` | Styled native select                       |
| `Badge`        | `variant` (default/success/warning/danger/info), `dot` (bool) | Status pill; shows animated pulse dot on danger |
| `Card`         | `padding` ('none'/'sm'/'md'/'lg'), `hover` (bool) | Card with border + shadow                  |
| `Modal`        | `open`, `onClose`, `title`, `maxWidth` (sm/md/lg) | Portal-mounted overlay with scaleIn animation (~0.3s) |
| `EmptyState`   | `icon`, `title`, `description`, `action`          | Centered placeholder for empty lists       |

### Feature Components (`src/components/`)

| Component         | Props                                 | Description                                              |
|--------------------|------------------------------------------|--------------------------------------------------------------|
| `Sidebar`         | `profile`, `organization`, `open`, `onClose` | Full sidebar; role-based nav (incl. Templates for admins); dark mode toggle; logout |
| `Topbar`          | `profile`, `onMenuClick`              | Header bar; mobile menu trigger; notification bell; role badge + avatar |
| `DashboardShell`  | `profile`, `organization`, `children` | Manages sidebar open state; `<main>` is the scrollable region |
| `NotificationBell`| (none — fetches own data)             | Real-time notification bell with dropdown + mark-read    |
| `TaskCard`        | `task: TaskWithDetails`, `isAdmin`, `onEdit?` | Full task card with urgency, priority, recurrence/review badges, actions |
| `TaskForm`        | `task?`, `clients`, `members`, `teams?`, `templates?`, `action`, `onSuccess`, `onCancel` | Create/edit task form; template picker (create-mode only) prefills title/description/priority/recurrence via controlled state |
| `ClientForm`      | `client?`, `action`, `onSuccess`, `onCancel` | Create/edit client form                            |
| `PriorityBadge`   | `priority: TaskPriority`, `size?`     | Color-coded priority pill; critical priority pulses      |
| `ThemeProvider`    | `children`                            | Dark mode context; localStorage + system preference      |

---

## 11. Shared Helper Modules

### `lib/notifications.ts`
- `createNotification({ supabase, userId, organizationId, type, title, message, referenceId?, referenceType? })` — Inserts a notification row.
- `createNotifications(supabase, notifications[])` — Batch insert variant.
- Both fail silently (try-catch) to avoid blocking the parent server action.

### `lib/activity.ts`
- `logActivity({ supabase, taskId, organizationId, actorId, actionType, oldValue?, newValue? })` — Inserts a `task_activities` row with JSONB old/new values. Also fails silently.

### `lib/recurrence.ts`
- `getNextDueDate(currentDueDate: string, rule: string): string | null` — Pure JS mirror of the SQL `next_recurrence_date()` function; used by `markTaskCompleteAction` to compute the next occurrence's due date without a round-trip RPC call.

### `lib/pagination.ts`
- Exports `TASKS_PAGE_SIZE`, `CLIENTS_PAGE_SIZE`, `MEMBERS_PAGE_SIZE` — plain constants, deliberately kept out of any `'use server'` file (which may only export async functions) so both server (page.tsx, actions.ts) and client components can import them.

---

## 12. Environment Variables

| Variable                       | Required | Where Used                                             |
|-----------------------------------|----------|--------------------------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`     | Yes      | Both client and server Supabase clients                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`| Yes      | Both client and server Supabase clients                |
| `SUPABASE_SERVICE_ROLE_KEY`    | Yes      | Admin client (`lib/supabase/admin.ts`) — server only   |
| `NEXT_PUBLIC_SITE_URL`         | Yes      | Email verification redirect URL in signup actions      |
| `RESEND_API_KEY`               | Edge Fn  | Supabase secret for the send-reminders edge function   |
| `REMINDER_FROM_EMAIL`          | Edge Fn (optional) | Supabase secret overriding the reminder email's `from` address; defaults to `DeadlineTracker <onboarding@resend.dev>` if unset |

---

## 13. Data Flow Patterns

### Pattern 1: Server Component → Client Component (most pages)
1. Server Component (page.tsx) calls `getAuthContext()` to get auth + profile + org.
2. Server Component queries Supabase (RLS-scoped, and for list pages, range-limited to the first page) for page data.
3. Passes data as props to a Client Component (`*-page-client.tsx`).
4. Client Component handles interactive state (modals, filters, selections, pagination) and calls Server Actions.

### Pattern 2: Server Action → revalidatePath
- Mutations happen in Server Actions.
- After mutation, `revalidatePath()` invalidates the cache for relevant routes.
- Next.js re-fetches data on next page visit; the client component's paginated local state resets to the fresh first page (see §7.16).
- No optimistic updates; UI waits for server action to complete.

### Pattern 3: Dashboard Layout Auth
- `(dashboard)/layout.tsx` calls `getAuthContext()` once per navigation.
- Passes `profile` + `organization` to `DashboardShell`.
- `DashboardShell` passes to `Sidebar` + `Topbar`; its `<main>` is the actual scroll container.
- Individual pages call `getAuthContext()` again (Next.js de-duplicates the Supabase call via request deduplication).

### Pattern 4: Notification Trigger Pattern
- Server actions that trigger notifications import `createNotification()`/`createNotifications()` from `lib/notifications.ts`.
- Wrapped in try-catch so failures are silent and non-blocking.

### Pattern 5: Activity Logging Pattern
- Server actions import `logActivity()` from `lib/activity.ts`.
- For updates, the action fetches the current state *before* performing the update, then passes both old and new values as JSONB.
- For creates/deletes/uploads, only `new_value` or `old_value` is passed respectively.

### Pattern 6: Load More Pagination
- List page.tsx fetches page 1 with `.range(0, PAGE_SIZE - 1)` and computes `initialHasMore = rows.length === PAGE_SIZE`.
- Client component holds the list in `useState`, plus a `hasMore`/`loadingMore` pair.
- "Load More" calls `fetchMore*Action(currentList.length)`, which re-queries with `.range(offset, offset + PAGE_SIZE - 1)`, org-scoped.
- On success, results are appended and `hasMore` recomputed from the returned page's length.
- When the server prop array changes identity (post-revalidation), local pagination state resets to the new first page via the render-time "adjust state" pattern, not `useEffect`.

---

## 14. Deployment Requirements

### Supabase Setup
1. Run `supabase/schema.sql` in the SQL editor.
2. Run `supabase/migrations/02_enterprise_features.sql` — **this creates `task_templates` and `task_attachments`, among other tables.** If task templates or attachment uploads fail with a `"Could not find the table"` schema-cache error, this migration has not been applied to the target project.
3. Run `supabase/migrations/03_admin_role_management.sql`.
4. (Optional) Run `supabase/fix-rls-policies.sql` if there are RLS conflicts.
5. **Create the `task-attachments` Storage bucket** (Supabase Dashboard → Storage → New bucket, name must be exactly `task-attachments`). If attachment uploads fail with a `"Bucket not found"` error, this step was skipped. The app code assumes this bucket is provisioned externally — it does not create it.
6. Enable **pg_cron** and **pg_net** extensions in Supabase dashboard.
7. Deploy edge function: `supabase functions deploy send-reminders`.
8. Set `RESEND_API_KEY` (and optionally `REMINDER_FROM_EMAIL`) as Supabase secrets.
9. Run `supabase/cron.sql` after updating the project URL and service role key placeholders.

### Next.js Deployment
1. Set all environment variables from §12.
2. `npm run build` + `npm start` (or Vercel/Railway deployment).
3. The `NEXT_PUBLIC_SITE_URL` must point to the production domain for email verification links to work.

---

## 15. Test Credentials

Create your own Admin account via `/signup`, then use an invite code to create a Member account for testing role interactions (see README).

---

## 16. Future Roadmap (What to Build Next)

1. **Live-task checklists** — add a `checklist_items` column (or a `task_checklist_items` table) to `tasks`, wire template selection to copy the checklist onto the created task, and add a checklist UI to the task detail page. (§8.1)
2. **Configurable reminder lead time** — settings UI + edge function change to support "N days before due" instead of the hardcoded "tomorrow" window. (§8.2)
3. **Team templates UI** — surface the seeded `team_templates` in the "Create Team" flow (pre-fill default roles), mirroring how `task_templates` now feeds the task form. (§8.3)
4. **Close the client-actions defense-in-depth gap** — add role + `organization_id` checks to `updateClientAction`/`deleteClientAction` to match the pattern used everywhere else. (§8.4)
5. **Server-side search for paginated lists** — today, Tasks-page search/filtering only operates over already-loaded rows; consider pushing search into the `fetchMore*Action` queries (or a dedicated search action) so results beyond the first page are discoverable without repeated "Load More" clicks.
6. **Optimistic UI** — mutations (including attachment upload/delete and pagination) still wait for a full round trip; consider `useOptimistic` for the highest-traffic interactions (mark complete, bulk actions).

---

*Document updated: 2026-07-05. Reflects Phase 1–3 completion: bug fixes, recurring tasks/approval workflow/client detail page/invite-code rotation, and file attachments/task templates/pagination/edge-function hardening. Based on full codebase analysis plus manual browser verification (login, template CRUD, attachment upload/delete, dark mode across all new UI) of the `deadline-tracker` project at `D:\Codes\Startup\SAAS-1 teams\deadline-tracker`.*
