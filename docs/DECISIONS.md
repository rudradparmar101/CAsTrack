# DECISIONS — chronological decision log

> Single dated, chronological record of *decisions* (not backlog items) made on this
> project: what was decided, why, and its current status. Newest entry last. Backfilled
> from `project_context.md` §8 (which remains the phase-indexed cumulative table — this
> file is the same history, reordered and dated, plus items §8 never captured); see also
> `docs/ROADMAP.md` for the live execution plan and `docs/planning/scope-decision.md` for
> the original positioning decision.
>
> **Status legend:** `active` — currently governs the codebase. `superseded` — replaced by
> a later decision (the later entry is linked). `deferred-with-trigger` — deliberately not
> built; a specific, named condition will cause it to be revisited.

---

### 2026-07-07 — Greenfield Supabase project, not a migration of the old DeadlineTracker data
**Decision:** Start `supabase/ca-firm/schema.sql` from scratch rather than evolving the
inherited DeadlineTracker schema in place.
**Rationale:** the old data/model wasn't worth carrying forward; RLS needed a full redesign
anyway (see the F1–F9 flaws in `ROLES_AND_RLS.md`).
**Status:** active. (Phase 1)

### 2026-07-07 — `super_admin` lives in `platform_admins`, not `profiles.role`
**Decision:** Platform super-admins are a separate table, not a `profiles.role` value.
**Rationale:** avoids NULL-`firm_id` profiles and the role-check special-casing that would
otherwise ripple through every RLS policy.
**Status:** active. (Phase 1)

### 2026-07-07 — Employee task scope = assigned ∪ own department
**Decision:** An employee's default visibility is (tasks assigned to them) ∪ (tasks in
their department(s)), not firm-wide.
**Rationale:** matches how CA firms actually distribute compliance work.
**Status:** active. (Phase 1)

### 2026-07-07 — Curated client portal via `visible_to_client` flags everywhere
**Decision:** Every client-facing surface (comments, documents, tasks) is gated by an
explicit `visible_to_client` flag staff control, not a blanket "clients see their own
data" rule.
**Rationale:** client trust — staff decide exactly what a client sees, nothing is exposed
by default.
**Status:** active. (Phase 1)

### 2026-07-07 — Service-role-only provisioning, no self-INSERT policies on profiles/firms
**Decision:** Profile and firm creation happens only through service-role code
(`lib/provisioning.ts`), never via a client-writable INSERT policy.
**Rationale:** fixes DeadlineTracker flaw F3 (join-any-firm-as-admin via self-INSERT).
**Status:** active. (Phase 2)

### 2026-07-07 — Client portal invite acceptance is auto-confirmed
**Decision:** Accepting a `client_portal_invitations` link immediately creates an
auto-confirmed (`email_confirm: true`) user and signs them in — no separate email
confirmation step.
**Rationale:** possessing the invite token *is* the email proof; a second confirmation
step would be redundant friction.
**Status:** active. (Phase 2)

### 2026-07-07 — Dual-layer permission checks (app + RLS) on every mutation
**Decision:** Every server action re-checks the relevant permission in app code, even
though RLS already enforces it at the DB layer.
**Rationale:** fixes the DeadlineTracker §8.4 gap where the app relied on RLS alone
(no friendly errors, no defense in depth); became house style for every phase after.
**Status:** active. (Phase 3+)

### 2026-07-07 — Replace-all semantics for client child records (addresses/persons/registrations)
**Decision:** Updating a client's addresses/authorized-persons/registrations replaces the
full child set rather than diffing individual rows.
**Rationale:** keeps the update action simple and idempotent; constrains editing to the
client detail page, where the full child set is already preloaded.
**Status:** active. (Phase 3)

### 2026-07-07 — No client delete anywhere (deactivate only)
**Decision:** Clients have no DELETE RLS policy at all; deactivation is `is_active` only.
**Rationale:** statutory records must survive a client's departure from the firm.
**Status:** active. (Phase 3)

### 2026-07-07 — Task list filtering/sorting/pagination is server-side, URL-driven
**Decision:** `/tasks` parses `searchParams` server-side through a whitelist
(`tasks/filters.ts`) and runs one RLS-scoped query, rather than filtering a client-loaded
page.
**Rationale:** the legacy DeadlineTracker pattern filtered only the already-loaded page
client-side; server-side filtering is RLS-scoped and produces shareable URLs.
**Status:** active. (Phase 4)

### 2026-07-07 — Stage machine duplicated in `task-options.ts`, DB trigger stays sole authority
**Decision:** The UI keeps its own copy of the legal-transition map for button rendering,
but `handle_task_stage()` (the DB trigger) is the only enforcement authority.
**Rationale:** the UI needs to know valid moves to render buttons; the duplication is
annotated and must be kept in sync manually if the trigger ever changes.
**Status:** active. (Phase 4)

### 2026-07-07 — Partner "force stage" exposed in the UI, not hidden
**Decision:** Partners get a visible "override" control that can force any stage
transition.
**Rationale:** the DB trigger already permits it for partners; hiding the control would
just push partners to raw SQL to do the same thing.
**Status:** active. (Phase 4)

### 2026-07-07 — Comments default internal; publishing to the client is explicit
**Decision:** New staff comments are internal by default; a per-comment checkbox
publishes to the portal.
**Rationale:** the safer default for a professional-services firm handling client
compliance data.
**Status:** active. (Phase 4)

### 2026-07-07 — One notification path for every role: `create_notification()` RPC
**Decision:** All notification inserts — staff- and client-originated — go through a
single SECURITY DEFINER RPC, not separate staff/client code paths.
**Rationale:** client-originated events need a safe insert path anyway (clients can't
INSERT notifications directly); one code path is simpler than two and closes flaw F7
(notification forgery).
**Status:** active. (Phase 4)

### 2026-07-07 — `.update().select('id').single()` on every task write
**Decision:** All task UPDATE calls chain `.select('id').single()` rather than a bare
`.update()`.
**Rationale:** an RLS-denied update matches zero rows; without the `.select().single()`
chain this reports as a silent success instead of a loud failure.
**Status:** active, with a known caveat (RETURNING also requires SELECT visibility of the
*new* row — an employee legally moving a task out of their own visibility gets a false
"no permission," logged in `project_context.md` §6). (Phase 4)

### 2026-07-07 — Recurrence spawn is best-effort, never blocks the completing action
**Decision:** If spawning the next recurring-task instance fails RLS (e.g. the completing
employee lacks `tasks.create`), the failure is logged and swallowed — the task completion
itself still succeeds.
**Rationale:** an RLS-legitimate denial on the spawn must not block the user's actual
action (completing the current task).
**Status:** active. (Phase 4)

### 2026-07-07 — Attach-existing-document gated by `documents.approve`
**Decision:** Linking an already-uploaded document to a task uses the `documents.approve`
permission, not a new dedicated key.
**Rationale:** attaching is technically an UPDATE on `documents`, and `documents.approve`
is the permission that already gates document UPDATEs — reusing it avoided a new
permission-catalog key for a Phase 4 feature; flagged as revisitable in the Phase 14 RLS
pass if it proves too strict in practice.
**Status:** active. (Phase 4)

### 2026-07-08 — Onboarding race fixed by re-reading the winner's row, not by locking
**Decision:** `resolveProfileRace()` catches the 23505 from a duplicate profile INSERT and
re-selects the row the winning request created, rather than adding a lock around the
check-then-insert.
**Rationale:** minimal change to an already-working design; a lock would need its own
testing and risked new failure modes for a narrow race.
**Status:** active. (Phase 5)

### 2026-07-08 — Team's old "team lead" + role-promotion UI dropped, not ported
**Decision:** The legacy admin/member promotion UI and freeform "team lead" concept were
deleted rather than adapted onto `departments`.
**Rationale:** no schema equivalent exists — departments have no `lead_id`, and CA roles
(partner/employee) are fixed at signup (create-firm vs. invite-code), not promoted
in-app. Porting a nonexistent concept would have meant inventing new schema, out of scope
for a page-fix pass.
**Status:** active. (Phase 5)

### 2026-07-08 — Departments use `is_active` toggle, no hard delete
**Decision:** Departments are deactivated, never deleted.
**Rationale:** mirrors the Clients module's existing no-hard-delete precedent, for
consistency across the app.
**Status:** active. (Phase 5)

### 2026-07-08 — Dashboard's role/field bugs fixed without migrating it onto `FirmTask`
**Decision:** Phase 5 fixed the dashboard's broken column/role references
(`organization_id`→`firm_id`, `'admin'`→`'partner'`) but left it on the legacy `Task`
type rather than also unifying it onto `FirmTask` in the same pass.
**Rationale:** kept the fix minimal and low-risk; full type unification was correctly
scoped as separate, non-urgent cleanup.
**Status:** superseded — the dashboard was unified onto `FirmTaskWithRefs` in Phase 8
(2026-07-10), see below. (Phase 5)

### 2026-07-08/09 — Reskin kept CSS-variable arbitrary values instead of switching to Tailwind's `dark:` variant
**Decision:** Color tokens stay as `var(--color-x)` referenced via arbitrary-value
classes, inside a `.dark { }` override block — not Tailwind v4's generated `dark:`
utility variant.
**Rationale:** Tailwind's `dark:` variant defaults to `prefers-color-scheme`, not this
app's class-based manual toggle (confirmed zero existing `dark:` usage in the codebase);
switching would risk a theme that ignores the manual light/dark switch. The existing
CSS-variable pattern has no such failure mode.
**Status:** active. (Phase 6)

### 2026-07-08/09 — Badge `info` variant is a dedicated blue, not the teal brand accent
**Decision:** The `info` status color family is a genuinely separate color, not a reuse of
`accent`.
**Rationale:** the design brief explicitly wants status colors visually distinct from the
brand accent.
**Status:** active. (Phase 6)

### 2026-07-10 — `compliance_types` is a platform-wide catalog, not per-firm
**Decision:** `compliance_types` has no `firm_id` — it's a single shared catalog every
firm reads, same shape as `permissions`.
**Rationale:** avoids seeding the same 16+ rows into every firm and keeps the catalog
centrally extendable as new compliance types are added.
**Status:** active. (Phase 9)

### 2026-07-10 — `compliance_types.department_code` is a loose TEXT match, not an FK
**Decision:** The catalog's department mapping is a plain text code, resolved against
each firm's own seeded department at generation time — not a foreign key to `departments`.
**Rationale:** `departments` rows are per-firm; the catalog is global, so an FK is
structurally impossible. A code match is the same indirection style already used for the
fixed department-code set itself.
**Status:** active. (Phase 9)

### 2026-07-10 — `client_registrations` added alongside the existing single gstin/tan/pan columns, not replacing them
**Decision:** Clients keep one primary GSTIN/TAN/PAN for search/display; multi-state
GSTINs and other registrations (PF/ESI/PT) live in a new `client_registrations` table.
**Rationale:** preserves simple single-value search/display while giving Phase 10's
generation engine the full multi-registration applicability source it needs.
**Status:** active. (Phase 9)

### 2026-07-10 — Audit applicability as two columns on `clients`, not a new profile table
**Decision:** `is_audit_applicable`/`audit_type` live directly on `clients`.
**Rationale:** only two fields are needed right now; a separate
`client_compliance_profile` table for two booleans would be premature abstraction — add a
table later if the profile genuinely grows.
**Status:** active. (Phase 9)

### 2026-07-10 — `compliance_type_id` FK is `ON DELETE RESTRICT`, no DELETE policy on `compliance_types`
**Decision:** A compliance type can never be hard-deleted while any task references it;
retirement goes through `is_active`.
**Rationale:** mirrors the clients/departments no-hard-delete precedent — never orphan a
task's reference to its compliance type.
**Status:** active. (Phase 9)

### 2026-07-10 — Statutory due-date rule is a flexible JSONB convention, not fully modeled in schema
**Decision:** `compliance_types.due_day_rule` is JSONB (`{due_day, months_after_period_end}`
or `{due_day, due_month}`), interpreted by application code, not DB-level CHECK
constraints or a fully normalized due-date model.
**Rationale:** government due-date extensions and edge cases (e.g. March TDS payment due
April 30, not the usual +1 month) aren't schema-expressible; a flexible convention lets
the generation engine special-case without a new migration each time.
**Status:** active. (Phase 9)

### 2026-07-10 — Dashboard unified onto `FirmTaskWithRefs`; legacy `Task`/`TaskWithDetails` deleted
**Decision:** The dashboard (`admin-dashboard.tsx`/`member-dashboard.tsx`) was rebuilt
onto the same `FirmTask*` types as `/tasks`, via a new shared `TaskSummaryCard`;
`task-card.tsx` and the legacy type family were deleted outright.
**Rationale:** closed the two-parallel-type-systems debt flagged since Phase 5; informational
dashboard cards click through to `/tasks/[id]` for actions rather than duplicating
interactive stage controls.
**Status:** active — supersedes the 2026-07-08 "dashboard fixed without unifying" decision.
(Phase 8)

### 2026-07-10 — Generation engine uses plain INSERT + catch-23505, not a DB upsert
**Decision:** `generateStatutoryTasksForFirm()` INSERTs one row per (client, compliance
type, period) and treats a `23505` unique-violation as "already generated," rather than
using `.upsert({onConflict})`.
**Rationale:** the idempotency key is a *partial* unique index
(`uq_statutory_task_per_period`, `WHERE ... IS NOT NULL`); supabase-js's upsert API has no
way to target a partial index's WHERE-scoped arbiter. Plain INSERT + catch needed no new
SECURITY DEFINER function or migration, and matches Phase 4 recurrence-spawn's existing
best-effort style.
**Status:** active. (Phase 10)

### 2026-07-10 — Statutory generation is partner-only, not permission-gated like the filing grid
**Decision:** "Generate now" and the generation cron route are restricted to partners;
viewing the filing grid uses the broader `reports.view` permission.
**Rationale:** the engine INSERTs across every department, but an employee's `tasks`
INSERT policy only admits their own departments — a non-partner run would silently fail
most rows via RLS. Viewing is safely broader than writing here.
**Status:** active. (Phase 10)

### 2026-07-10 — Filing outcomes (ARN/filed date) logged to `task_activities`, not new columns
**Decision:** Phase 10 captured ARN/filed-date as a `task_activities` entry
(`filing_outcome_recorded`), reusing the existing generic key/value activity-feed
rendering.
**Rationale:** Phase 10 was scoped with no migration gate; no schema change or new
rendering logic was needed to hit the phase's goals.
**Status:** superseded — promoted to real `tasks.arn`/`tasks.filed_date` columns in
migration 007 (Phase 12.5, 2026-07-19) once the data needed to be client/grid-visible,
which `task_activities`' staff-only RLS couldn't support. See below.
**Trigger that caused the supersession:** the filing-status grid and staff task detail
needed to *display* ARN/filed-date, and (in principle) the client portal too — none of
which can read `task_activities`. (Phase 10)

### 2026-07-10 — `itr_non_audit_annual`/`itr_audit_annual` conflict resolved by a hardcoded code check
**Decision:** `isApplicable()` special-cases these two compliance-type codes directly in
application code, rather than adding a schema-level "excludes" mechanism.
**Rationale:** exactly one conflict pair exists in the current catalog; a general
negation mechanism (the predicate can only express "must match," never "must NOT match")
would be speculative schema complexity for a single known instance.
**Status:** active, until a second conflict pair appears — `project_context.md` §0 still
flags the general limitation as an open risk. (Phase 10)

### 2026-07-10 — Filing-status grid shows the current period only, no historical/period selector
**Decision:** `/compliance` scopes to the current period per compliance type; no
date-range or history view was built.
**Rationale:** matches the stated primary use case ("the partner's 18th evening screen")
without building a bigger feature than asked; a historical view remains a clearly-scoped,
reasonable follow-up if requested.
**Status:** active. (Phase 10)

### 2026-07-11 — Reminder/notification-email idempotency logged to `task_activities`, not a new table
**Decision:** Both the statutory-reminder and waiting-client-nag cron jobs check/record
`task_activities` (tier-tagged `new_value`, checked via `.contains()`) instead of a
dedicated dedupe table.
**Rationale:** the same no-migration trick Phase 10 used for filing outcomes; the cron
runs under the service role, which bypasses RLS entirely, so `task_activities`' staff-only
readability doesn't matter for this use.
**Status:** active. (Phase 11)

### 2026-07-11 — `notifyUser`/`notifyUsers` gained an explicit opt-in `sendEmail` flag
**Decision:** Whether a notification also sends an email is controlled per call site via
an explicit boolean, not derived from the `NotificationType` value.
**Rationale:** several notification types are reused for both email-worthy and in-app-only
events (e.g. document approve/reject reuse `task_approved`/`task_rejected`); tying email
delivery to type identity would have forced a type split. Per-call-site control matches
the roadmap's precise scope (assignment/review/rejection/completion only).
**Status:** active. (Phase 11)

### 2026-07-11 — `tasks.checklist_items` added as a real column (migration 002), not folded into `task_activities`
**Decision:** Per-task checklists are a JSONB column on `tasks`, covered by the existing
tasks SELECT/UPDATE RLS policies — not another event-sourced-from-`task_activities` trick.
**Rationale:** a genuine architectural finding, not a preference: `task_activities` is
staff-only readable by RLS, but checklist state must be client-visible. Flagged and gated
on Jay's approval before the migration was applied (same ⚠ HUMAN gate as every schema
change).
**Status:** active. (Phase 11)

### 2026-07-11 — `get_client_assigned_contact()` is a narrow SECURITY DEFINER RPC, not a widened `profiles` policy
**Decision:** The portal's "your contact at the firm" feature resolves through a function
that checks `auth.uid()` is the requesting client's own bound client_user before
returning anything — the `profiles` SELECT policy itself was never widened.
**Rationale:** explicitly ruled out per the roadmap: client_users must never be able to
enumerate firm staff, even indirectly. A widened policy would have made staff profiles
generally readable by clients; the RPC scopes to exactly one lookup.
**Status:** active. (Phase 11)

### 2026-07-11 — Client reminder contact resolved independently of portal login
**Decision:** Statutory reminders resolve the client's contact from
`client_authorized_persons`/`clients.email`, not from whether the client has a portal
account.
**Rationale:** reminders must reach the firm's real-world contact even for clients who
never got (or accepted) a portal invite; this is a separate concern from the
assigned-contact RPC, which is portal-only "who is my contact" display.
**Status:** active. (Phase 11)

### 2026-07-16 — Positioning: this is deadline/notice discipline, not a filing tool (architectural non-goal)
**Decision:** Features requiring GST/IT portal credential access or GSP/ERI licensing
(auto-fetch, GSTR-2B reconciliation, filing-from-platform) are out of scope by decision,
not backlog.
**Rationale:** recorded in `docs/planning/scope-decision.md` and the "Deliberate
non-goals" section of `docs/ROADMAP.md` — a deliberate product-positioning constraint, not
an oversight.
**Status:** active. See also the 2026-07-23 credentials-vault deferral below, which is a
direct consequence of this same boundary.

### 2026-07-18 — Forgot-password reuses Supabase's own recovery token, but sends a branded email
**Decision:** `/forgot-password` calls `admin.auth.admin.generateLink({type:'recovery'})`
to mint Supabase's real single-use token without triggering Supabase's built-in send, then
delivers it via the app's own `sendEmail()`/`passwordResetEmail()` path.
**Rationale:** every other Praxida email is branded through the same path; using
`generateLink()` (rather than the anon-key `resetPasswordForEmail()`) is the only way to
suppress Supabase's own mailer so the branded email can be sent instead.
**Status:** active. **Known side effect:** Supabase's own rate limit on the public
recovery endpoint doesn't apply to this path, since it bypasses `resetPasswordForEmail()`
entirely — tracked as the rate-limiting hardening item below (2026-07-23). (off-roadmap)

### 2026-07-18 — Forgot-password response is deliberately enumeration-safe
**Decision:** `/forgot-password` always returns the identical generic success result and
pads the response to a 700ms floor, regardless of whether the account exists.
**Rationale:** neither the response body nor its timing should reveal account existence —
intentional, and the only precedent for this pattern in the codebase.
**Status:** active. **Do not "improve" this into revealing whether an account exists** —
see the Open Items note below (2026-07-23).

### 2026-07-19 — `fee_masters` management UI built without a migration
**Decision:** A "Rate Card" section on `/billing` reuses the existing `fee_masters`
table/RLS/`billing.view`/`billing.manage` permissions from Phase 12 — no new schema.
**Rationale:** the schema and RLS already existed from Phase 12; only the create/edit/
deactivate UI was missing, closing a gap rather than adding a feature.
**Status:** active. (off-roadmap)

### 2026-07-19 — ARN/filed-date promoted to real `tasks` columns (migration 007)
**Decision:** `tasks.arn`/`tasks.filed_date` became real nullable columns, written
atomically with the completion stage-change UPDATE, alongside (not instead of) the
pre-existing `task_activities` audit entry.
**Rationale:** supersedes the Phase 10 `task_activities`-only approach (see above) for the
same reason migration 002 promoted `checklist_items`: a plain column is covered by
*existing* tasks RLS, an activity-log row is not, and the filing grid/task detail needed
to read this data.
**Status:** active. (Phase 12.5)

### 2026-07-19 — UDIN register: no new `compliance.manage` permission key
**Decision:** Reads reuse the existing `reports.view` key (same gate as the filing grid);
writes are partner-only enforced directly at the RLS layer (`get_user_role() = 'partner'`),
with no permission-catalog key at all.
**Rationale:** presented as an explicit either/or to Jay before the migration was applied
(invent a new key vs. reuse existing patterns); Jay chose no-new-key as "reversible later;
correct for a single-firm pilot" — mirrors Phase 10's identical choice for statutory-task
generation.
**Status:** active. (Phase 12.5)

### 2026-07-19 — Bulk client import is user-scoped (RLS + `clients.manage`), not a service-role path
**Decision:** The CSV importer's every row goes through the same `requireClientsManage()`
app guard and `clients` INSERT RLS policy as manual client creation — no service-role
client anywhere in the importer.
**Rationale:** this explicitly superseded an earlier phase-text assumption
("service-role-only") — the importing user's own permissions should gate every row,
consistent with the dual-layer permission-check house style used everywhere else.
**Status:** active. (Phase 12.6)

### 2026-07-19 — Bulk client import v1 is core-fields-only (no addresses/persons/registrations)
**Decision:** The CSV importer writes only the core `clients` row fields; nested child
records are out of scope for v1.
**Rationale:** `createClientAction`'s existing multi-table write is not atomic — a
child-row failure after the client row lands leaves a real, partially-created client
behind (an accepted risk for one manual create, but a much worse failure mode multiplied
across a 50-row import). Restricting to core fields makes every row exactly one atomic
single-table INSERT, with no rollback logic needed.
**Status:** active — deliberately narrow v1 scope, not a rejected feature. A follow-up
phase could add child-row import once a flat-CSV convention for repeated child rows is
designed.
**Trigger to revisit:** a firm's onboarding data genuinely includes addresses/authorized
persons/registrations that are painful to add by hand after import. (Phase 12.6)

### 2026-07-19 — Bulk import duplicate detection keyed on PAN, skip-and-report (never silent update)
**Decision:** A CSV row whose PAN already exists in the firm (or duplicates another row in
the same batch) is skipped and reported with a reason — never used to silently update an
existing client.
**Rationale:** GSTIN was deliberately rejected as the dedup key, since one client
legitimately holds multiple state-wise GSTINs ("same GSTIN" ≠ "same client"); PAN is the
correct one-per-entity identifier, even though there's no DB-level UNIQUE constraint on
`clients.pan` to enforce it (this is an app-layer check).
**Status:** active. (Phase 12.6)

### 2026-07-21 — Interstate/GST invoice ergonomics build on existing schema, no tax-math changes
**Decision:** Firm GSTIN, place-of-supply dropdown, and `is_interstate` auto-derivation
were all built as UI-layer defaults over data that already existed
(`firms.gstin`, `cgst_amount`/`sgst_amount`/`igst_amount`) — `issue_firm_invoice()`'s tax
computation itself was not touched.
**Rationale:** a prior read-only recon (`docs/investigation/billing-invite-recon.md`) had
confirmed the columns and split logic already existed and worked, just unused/undefaulted
by the UI; the gap was ergonomics, not correctness.
**Status:** active. (off-roadmap)

### 2026-07-21 — `is_interstate` derivation is never sticky; always a plain overridable checkbox
**Decision:** Auto-deriving interstate status from firm-state vs. place-of-supply-state
recomputes on every relevant change but never locks the checkbox — the user can always
flip it by hand for one invoice (e.g. SEZ).
**Rationale:** a hard-locked derived value would break legitimate edge cases the
statutory GST rules carve out; a hint line explains the derivation instead of enforcing
it.
**Status:** active. (off-roadmap)

---

### 2026-07-23 — Credentials vault (formerly Phase 13.1) deferred post-pilot, by decision
**Decision:** The credentials vault (secure storage of client GST/IT/TRACES statutory
portal logins) is explicitly deferred, not merely unscheduled. Phase 13 was split (see
next entry) specifically so this deferral could be recorded and tracked independently of
13.2/13.3, which have no comparable architecture decision attached.
**Rationale:**
- It is the only planned feature whose failure mode is **unrecoverable** — a vault design
  or key-management mistake can mean permanently lost or leaked access to a client's
  statutory GST/IT/TRACES portal login, unlike every other feature in this codebase where
  a bug is fixable after the fact.
- It is table stakes, not differentiation — building it doesn't move the product forward
  competitively, it just avoids being disqualified.
- The pilot firm is the team's own firm, and it already manages these credentials today
  through its existing (non-Praxida) process — so deferring costs nothing for the pilot
  itself.
- Risk scales with *other people's* data. A vault built under pilot-phase time pressure,
  for zero paying firms, is the wrong moment to accept an unrecoverable-failure-mode
  feature's risk. Building it later, once there's a real budget for proper key
  management, produces a better vault at near-zero interim cost (nothing else in the
  roadmap depends on it existing sooner).
**Status:** deferred-with-trigger.
**Revisit trigger:** (a) the firm has 10+ paying firms on the platform, OR (b) any
specific pilot or prospect firm explicitly blocks adoption on this feature being present
— whichever comes first.
**Approach when built (decided in advance, not yet implemented — so the eventual build
doesn't re-litigate this):**
- App-layer AES-256-GCM via Node's built-in `crypto` module — explicitly **not**
  Postgres `pgcrypto`, because the encryption key must never live in the same system
  (the database) as the ciphertext it protects.
- The key lives in a Vercel environment variable, not the database.
- AAD (additional authenticated data) is bound to `firm_id + credential_id`, so a
  ciphertext value copied between rows (e.g. via a bug or a malicious raw-SQL copy) fails
  to decrypt rather than silently decrypting under the wrong context.
- Only the secret value itself is encrypted — metadata (which portal, which client, last
  updated) stays plaintext, so list views never need to decrypt anything.
- Decryption happens only on an explicit user-initiated "reveal" action, never implicitly
  on list/read.
- Every reveal is logged to an append-only, trigger-only-writable audit table — mirroring
  the existing `task_stage_history` precedent (no app-layer INSERT policy, only a
  SECURITY DEFINER trigger can write it).
- All crypto operations are encapsulated behind one `lib/vault/crypto.ts` module, so the
  backend can later be swapped for a managed KMS (e.g. AWS KMS, Supabase Vault) without a
  data migration — callers never touch raw key material directly.

### 2026-07-23 — WhatsApp integration parked until after pilot
**Decision:** WhatsApp Business API integration remains deferred past the pilot
checkpoint (reaffirms the 2026-07-16 decision already recorded in `project_context.md`
§4.9, now explicitly logged here as part of this session's decision backfill).
**Rationale:** Meta Business API approval is a weeks-long external dependency outside the
team's control; the notification sender (`lib/email/resend.ts`'s `sendEmail()` pattern)
was deliberately built channel-agnostic from Phase 11 onward specifically so WhatsApp can
be added later without a redesign. The interim substitute — `wa.me` click-to-chat deep
links with pre-filled text — needs no API access and no approval at all.
**Status:** deferred-with-trigger.
**Revisit trigger:** post-pilot, when the team has bandwidth to start the Meta
application (which should be kicked off well before the feature is actually wanted live,
given the multi-week approval lag) — no firm-count or blocking-prospect trigger is
attached to this one, unlike the vault, since it's a scheduling deferral rather than a
risk-based one.

### 2026-07-23 — Phase 13 split into 13.1 (vault, deferred) / 13.2 (DSC register) / 13.3 (permissions UI)
**Decision:** The single "Phase 13 — Registers + permissions UI" roadmap entry is split
into three independently trackable sub-phases.
**Rationale:** only the credentials vault (13.1) has an architecture decision attached to
it (the encryption/key-management design above, plus the deferral itself) — bundling it
with the DSC register and permissions-UI items, which are ordinary build work with no open
architectural question, would have obscured the one item that actually needed a recorded
decision.
**Status:** active. 13.1 is deferred per the entry above; 13.2/13.3 remain normal
unscheduled roadmap items in `docs/ROADMAP.md`.

### 2026-07-23 — DSC register: reads and custody movements share the clients.view gate, revised mid-review
**Decision:** `dsc_register` and `dsc_custody_movements` SELECT, and the internal check
inside `record_dsc_movement()`, are all gated on the existing `clients.view` permission
(partner bypass automatic) — not a bare "any firm staff" check.
**Rationale:** the migration's first draft used `is_firm_staff()` (any partner or
employee, unconditionally) on the theory that DSC custody is purely operational
information every staff member needs. Jay caught the gap before applying: an employee with
`clients.view` explicitly revoked — a real, tested configuration already exercised by
`rls-smoke.mjs`'s E2 case — would have been able to read `dsc_register.client_id` and
`holder_name` anyway, which is client-identifying data in exactly the sense `clients.view`
already exists to gate. `clients.view` was the correct, minimal fix: it's the one
permission key that already means "may see which client this row belongs to," so reusing
it avoided inventing a new key. Applying this consistently meant `record_dsc_movement()`
also needed the same check — it is `SECURITY DEFINER` (bypasses RLS by default), so its
internal check is the *only* thing standing between a raw RPC call and an unauthorized
custody change; without this fix, an employee with `clients.view` revoked could still have
called the RPC directly with a known `dsc_id` even though they could no longer read the
register through the UI.
**Status:** active. (Phase 13.2, migration 008)

### 2026-07-23 — Custody movements route through a SECURITY DEFINER RPC, not a broader RLS policy
**Decision:** `record_dsc_movement()` — not a broadened "any staff can UPDATE
dsc_register" RLS policy paired with a column-freeze guard trigger (the `guard_firm_invoice`
pattern) — is the only path a non-partner staff member can use to change
`current_custodian_id`.
**Rationale:** the RPC needed no new RLS UPDATE policy at all (the partner-only policy
stays exactly as simple as `udin_register`'s), matches an already-proven pattern in this
schema (`create_notification()`, `get_client_assigned_contact()` — SECURITY DEFINER with a
manual same-firm validation, no permission-catalog key), and solves a second problem for
free: `dsc_custody_movements.note` needed to be writable, unlike `task_stage_history.note`,
which is a known, still-unfixed gap (project_context.md §6 / `docs/ROADMAP.md` Phase 14)
precisely because nothing in that trigger's design threads a note through. Routing the
note through the RPC via a transaction-local `set_config()` call, read back by the same
AFTER UPDATE trigger within the same transaction, avoided reproducing that gap in a new
table from day one.
**Status:** active. (Phase 13.2, migration 008)

### 2026-07-23 — DSC expiry-alert idempotency lives on dsc_register columns, not task_activities or a new table
**Decision:** Two new nullable columns on `dsc_register` itself
(`last_expiry_alert_tier`/`last_expiry_alert_sent_for_expiry`) track which alert tier was
last sent and for which expiry date — not the `task_activities` tier-tagged-JSONB trick
Phase 10/11 used for filing outcomes and reminders, and not a new table.
**Rationale:** a DSC has no task to attach a `task_activities` entry to, so that
established no-migration trick doesn't apply here — and this migration wasn't under a
no-migration constraint anyway, so a real column is the more direct fit. Storing the
expiry date alongside the tier (not the tier alone) means a renewal (`expires_on` moves
forward) automatically re-arms future alerts: the stored `(tier, expiry)` pair from the
last send simply no longer matches the new expiry, with no explicit reset trigger needed.
**Status:** active. (Phase 13.2, migration 008)

---

## Operational knowledge (not architecture decisions, but cost real debugging time)

These are runbook-style facts about how this system actually behaves in
production/deployment, captured so the next session doesn't have to rediscover them by
losing a few hours to a silent failure. See also `docs/deployment.md` for the full
environment-variable reference these point into.

- **Email delivery requires the verified subdomain, not the bare domain.**
  `RESEND_FROM_EMAIL` must be set to an address on `mail.praxida.in` (e.g.
  `"Praxida <noreply@mail.praxida.in>"`) — the bare `praxida.in` domain is **not** verified
  in Resend, and sending from it 403s on every single call. This failed silently for two
  days: `sendEmail()` (`lib/email/resend.ts`) is fire-and-forget by design (§ decisions
  above, Phase 11) and only logs the error — it never surfaces anywhere a human would
  naturally look. The only evidence was the Vercel runtime logs and the Resend API's own
  send log, neither of which is checked by default in normal use of the app.
- **`NEXT_PUBLIC_SITE_URL` must be `https://praxida.in` in Vercel Production, no trailing
  space, and only takes effect on the *next* deploy.** `NEXT_PUBLIC_*` variables are baked
  into the JS bundle at **build time**, not read at runtime — changing the value in the
  Vercel dashboard does nothing until the next build/deploy actually happens.
- **`RESEND_TEST_RECIPIENT` must never be set in Vercel Production.** When set, it
  silently redirects *every* outbound email — invites, notifications, reminders — to that
  one address regardless of the real recipient (`resend.ts`'s `redirected` branch). It
  exists specifically for pre-verified-domain local/dev testing (see the Phase 11 entry
  above) and has no business being set anywhere real users receive email.
- **Supabase Auth's own email and this app's Resend path are fully independent systems.**
  Supabase's built-in signup-confirmation email works through its own mailer
  (`admin.createUser`/session flows) and is unrelated to `lib/email/resend.ts`. One of the
  two working correctly is not evidence the other one is — they must be checked/debugged
  separately.
- **Vercel bot mitigation trips on tight-loop polling after a push.** Repeatedly checking
  `praxida.in` in quick succession right after a deploy can trigger a 403
  `X-Vercel-Mitigated` challenge response, which looks like the deploy failed even when it
  didn't. Check once, roughly 90 seconds after a push, or just confirm in a real browser
  tab instead of scripted polling.
- **Supabase MCP access is read/verification-only.** No DDL, no writes, no
  `apply_migration` — ever. The human-applies-migrations-in-Studio gate (the same ⚠ HUMAN
  pattern used for every migration 001–007 above) is unchanged by having MCP access; MCP
  does not grant a bypass.
- **Migration 006 (billing audit + pairing) is drafted, not applied.** It is a real,
  intended Phase 14 migration sitting in the working tree, awaiting the same Studio
  approval gate as every prior migration. On 2026-07-21 it was found accidentally
  truncated to near-empty in the working tree (alongside a similarly-truncated
  `docs/ROADMAP.md`) — restored from `origin/main`. **Do not treat a local truncation of
  this file as an intentional edit** — verify against `origin/main` before assuming any
  local state of migration 006 is meaningful.

---

## See also
- `project_context.md` §8 — the phase-indexed cumulative decisions table this log was
  backfilled from (kept as-is; this file is the same history reordered chronologically,
  plus the operational-knowledge section and the 2026-07-23 entries §8 doesn't have).
- `docs/ROADMAP.md` — the live, forward-looking execution plan (what's next, not what was
  decided).
- `docs/planning/scope-decision.md` — the original 2026-07-16 positioning-constraint
  writeup.
- `docs/deployment.md` — environment-variable reference for everything referenced in the
  operational-knowledge section above.
