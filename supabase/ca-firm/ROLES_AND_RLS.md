# CA Firm SaaS — Role & Permission Model (Phase 1)

Companion to `schema.sql` in this folder. Section references like §11.10 point into that file.

---

## 1. The four roles and where each lives

| Role | Stored where | Tenant scope | Summary |
|---|---|---|---|
| `super_admin` | `platform_admins` table (user id membership) | Cross-firm | Platform owner. **Not** a `profiles.role` value — so no NULL-firm profiles pollute the `get_user_firm_id()` pattern. Read access everywhere, write access to platform tables (plans, subscriptions, permission catalog). |
| `partner` | `profiles.role = 'partner'` | One firm | Firm owner. Bypasses the permission system entirely (`has_permission()` returns `true`). Full CRUD inside the firm. |
| `employee` | `profiles.role = 'employee'` | One firm, narrowed | Sees (tasks assigned to them) ∪ (tasks in departments they belong to). Everything else is gated by granular permissions. |
| `client_user` | `profiles.role = 'client_user'` + `profiles.client_id` | Exactly one `clients` row | A real login for a client. Structurally scoped: every policy path they can satisfy compares against `get_user_client_id()`. |

The binding invariant for client users is a table constraint, not convention:

```sql
CHECK ((role = 'client_user') = (client_id IS NOT NULL))
```

A client_user **must** have a client_id; staff **must not**. So `get_user_client_id()` returns NULL for staff (their "client policies" never match) and returns the one bound client for client_users (their row can never point at two clients).

## 2. Granular permissions (the "view clients but not billing" requirement)

Three tables replace DeadlineTracker's binary `role IN ('admin','member')` checks:

1. **`permissions`** — platform-wide catalog of dot-namespaced keys (`clients.view`, `billing.view`, `documents.approve`, …). Adding a capability = inserting a row, no schema change.
2. **`role_permissions`** — platform defaults per role. In practice only `employee` rows matter.
3. **`user_permissions`** — per-user overrides: `granted = true` grants beyond the default, `granted = false` revokes a default. Managed by partners, for employees in their own firm only.

Resolution order in `has_permission(key)` (SECURITY DEFINER, used inside RLS policies):

```
super_admin        -> true
partner            -> true
client_user        -> false          (their access is structural, never permission-based)
employee           -> user_permissions override, else role_permissions default, else false
```

**Example — "this employee can view clients but not billing":** `clients.view` is already an employee default (`role_permissions`), and `billing.view` defaults to false — so that specific employee needs zero rows. The inverse ("billing clerk who can't see clients") is two `user_permissions` rows: `(user, 'billing.view', true)` and `(user, 'clients.view', false)`.

Permissions are enforced **inside RLS policies** (e.g. `firm_subscriptions` SELECT requires `has_permission('billing.view')`, §11.9), so a permission-less employee gets empty result sets even with direct PostgREST calls — the app layer is the second line, not the only line.

## 3. How each role is scoped at the RLS layer

Every policy is one of five predicate shapes:

| Shape | Used by | Example |
|---|---|---|
| `is_super_admin()` | super_admin | read-all policies on every table |
| `firm_id = get_user_firm_id() AND get_user_role() = 'partner'` | partner | tasks/documents/clients "view all" |
| `firm_id = ... AND role = 'employee' AND (assigned_to = auth.uid() OR department_id = ANY(get_user_department_ids()))` | employee | tasks §11.13 |
| `firm_id = ... AND has_permission('x')` | permission-gated staff writes | clients.manage, documents.approve, team.manage |
| `client_id = get_user_client_id() AND <curation filters>` | client_user | clients §11.10, tasks, documents |

All helpers are `SECURITY DEFINER STABLE` (the DeadlineTracker pattern) so policies on `profiles`/`department_members` don't recurse into themselves.

## 4. Proof: client_user isolation

Two things have to hold: (a) no sibling-client data, (b) no firm-internal data.

**(a) Sibling clients.** Every SELECT policy a client_user can satisfy pins the row to their single bound client:

| Table | The only policy path available to a client_user |
|---|---|
| `clients` | `id = get_user_client_id()` — exactly one row; a sibling client's `id` fails the predicate |
| `client_addresses`, `client_authorized_persons` | `client_id = get_user_client_id()` |
| `tasks` | `client_id = get_user_client_id() AND visible_to_client AND stage NOT IN ('created','archived')` |
| `documents` | `client_id = get_user_client_id() AND visible_to_client AND (uploaded_by = auth.uid() OR approval_status = 'approved')` |
| `document_versions` | `can_access_document()` re-applies the parent document's client predicate |
| `task_comments` | `visible_to_client AND client_can_access_task(task_id)` (which pins `client_id`) |
| `notifications` | `user_id = auth.uid()` |
| `firms` | `id = get_user_firm_id()` — firm name/branding only, one row |

They can never widen this on write either: their INSERT policies force `uploaded_by/created_by = auth.uid()`, `client_id = get_user_client_id()`, `approval_status = 'pending'`, and `visible_to_client = true` (no hidden writes, no self-approval). They have **no UPDATE path** on tasks or documents at all.

**(b) Firm-internal data.** RLS default-denies anything without a matching policy. These tables have **no policy a client_user can satisfy** (all paths require `is_firm_staff()`, a permission, or partner role):

`profiles` (other people's — they only match `id = auth.uid()`), `departments`, `department_members`, `user_permissions` (they have none), `firm_subscriptions`, `subscription_invoices`, `task_stage_history`, `task_activities` (read side), `task_templates`, `client_portal_invitations`, `platform_admins`, and comments/documents flagged `visible_to_client = false`.

Notably, a client_user cannot enumerate employees: the staff-wide profiles SELECT policy requires `is_firm_staff()`. Exposing "your assigned contact" to the portal will be a narrow SECURITY DEFINER RPC in the app phase, not a wider policy.

**(c) Cross-firm** is inherited from the DeadlineTracker pattern: every predicate above is additionally pinned by `firm_id`/`client_id`, both of which resolve through the user's own profile row.

## 5. What did NOT extend cleanly from DeadlineTracker (flags)

- **F1 — Self-profile UPDATE allows privilege escalation.** DeadlineTracker's `"Users can update their own profile" USING (id = auth.uid())` has no column restriction — Postgres RLS can't do that — so a member could `UPDATE profiles SET role='admin' WHERE id=auth.uid()`. Tolerable-ish with 2 roles; fatal with 4 (a client_user could rebind `client_id` to a sibling). **Fix:** `guard_profile_protected_fields` trigger (§9.2) locks `role`, `firm_id`, `client_id` to partners/super-admin/service-role.
- **F2 — `USING (true)` SELECT on organizations.** Existed for invite-code lookup; it lets any authenticated user (including a rival firm's client) enumerate every firm. **Fix:** dropped entirely; `lookup_firm_by_invite_code()` / `lookup_client_invitation()` SECURITY DEFINER RPCs return only the row matching a presented secret.
- **F3 — Self-INSERT policies on profiles/organizations.** The old `WITH CHECK (id = auth.uid())` profile insert let a user write **any role and any organization_id** — join any firm as admin. The app happened to use the service-role client anyway. **Fix:** no INSERT policies; provisioning is service-role-only, matching the actual `/auth/callback` flow.
- **F4 — `task_attachments` superseded.** A flat file row can't express approval status or version history. Replaced by `documents` (logical file + approval state, `client_id` denormalized NOT NULL so portal RLS survives task deletion) + `document_versions` (immutable physical files; new version auto-resets approval to `pending` via trigger).
- **F5 — `teams`/`team_members` replaced by departments.** Same junction shape, but departments are seeded fixed practice areas (GST, Income Tax, Audit, ROC, Accounting, Payroll) and participate in *visibility* (`tasks.department_id` is NOT NULL and drives employee RLS), which teams never did. `assigned_team_id` on tasks is gone.
- **F6 — Cascade deletes are wrong for compliance data.** DeadlineTracker cascades client → tasks. A CA firm must retain statutory records. **Fix:** `tasks.client_id`/`documents.client_id` are `ON DELETE RESTRICT`, `clients` has **no DELETE policy** (deactivate via `is_active`), `documents.task_id` is `ON DELETE SET NULL` so documents outlive tasks.
- **F7 — Permissive notification INSERT.** "Any org member can insert" would let a client_user forge notifications to staff (or probe user ids). **Fix:** staff-only INSERT policy + `create_notification()` SECURITY DEFINER helper (validates same-firm) for legitimate cross-role events.
- **F8 — `status` conflation.** The old `tasks.status` mixed lifecycle and review states (`'pending_approval'` lived in both `status` and `review_status`). The new `stage` enum is the single source of truth; `status` shrinks back to `pending|completed` and is **derived by trigger** — kept so DeadlineTracker-style dashboard aggregates port over unchanged. `review_status`/`reviewer_id` approval semantics fold into the `under_review` stage.
- **F9 — Storage pathing.** `{org}/{task}/{uuid}` can't scope client users (no client segment, and tasks are deletable). New convention `{firm_id}/{client_id}/{document_id}/{uuid}.{ext}` lets storage policies pin client_users to folder segment [2] (§12).
- **What extended cleanly:** the SECURITY DEFINER helper pattern (`get_user_org_id` → `get_user_firm_id` + friends), `firm_id`-on-every-table, `handle_updated_at`, priority/recurrence enums, `parent_task_id` recurring generation, comments/activities/notifications shapes, and the idempotent-policy-recreator idea (worth repeating once policies churn).

## 6. Stage machine (trigger-enforced, §9.4)

```
created -> assigned -> in_progress -> waiting_client
                            ^              |
                            +--------------+
                       in_progress -> under_review -> completed -> archived
                                           |               ^
                                           +-> in_progress (sent back)
   in_progress -> completed   (only when reviewer_id IS NULL)
```

Partners (and the service role) may force any transition; employees are held to the arrows. Setting `assigned_to` on a `created` task auto-advances it to `assigned`. Every change lands in `task_stage_history` via a SECURITY DEFINER trigger — the table has no INSERT policy, so the trigger is the only writer.

## 7. Deliberately deferred to the app phase

- **Seat/storage/feature enforcement** — helpers exist (`get_firm_plan`, `firm_has_feature`, `firms.storage_used_bytes` maintained by triggers); hard-blocking DB triggers on profile insert were skipped so trials and service-role provisioning can't brick signup. Enforce in server actions first.
- **Portal "assigned contact" RPC** — the narrow SECURITY DEFINER function exposing one staff name/email to a client_user.
- **Payment webhooks** — Razorpay/Stripe writes to `firm_subscriptions`/`subscription_invoices` via service role.
- **Idempotent policy-recreator script** — the `fix-rls-policies.sql` equivalent, worth generating once this draft stabilizes.
