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

### 2026-07-23 — Phase 13.3 Step 0: Supabase MCP unavailable, substituted an empirical probe
**Decision:** the session plan's Step 0 required inspecting `user_permissions`' RLS via
Supabase MCP (reads only) before writing any editor UI. The MCP server was not configured
in that environment. Rather than trust `schema.sql` alone (a local file with a known prior
drift incident — see the migration-006 note below) or skip the gate, Step 0 was closed with
`scripts/verify/12-permissions-ui.mjs`: a committed, self-seeding, raw-PostgREST probe run
against the live database, mirroring `10-dsc-register.mjs`'s house style.
**Rationale:** Jay confirmed this framing directly ("it's an upgrade, not a substitute: an
empirical probe against the live DB proves more than reading policy text would") and
reordered the plan so the probe script is written and run FIRST, before any UI code, exactly
as Step 0 originally demanded of the MCP read. It paid off immediately: the first run was
24/25, not 25/25 — the probe caught a real gap (next entry) that a policy-text read might
well have missed, since the written SQL for the write policies was correct and only the
SELECT policy was wrong.
**Status:** active. Once Supabase MCP is available in a session, prefer it for quick
policy-text checks, but a live empirical probe remains the stronger proof for any
privilege-escalation-sensitive surface and is what actually gated this build.

### 2026-07-23 — Migration 009: user_permissions self-view SELECT scoped to employees
**Decision:** the pre-existing `"Users can view their own permission overrides"` SELECT
policy (`USING (user_id = auth.uid())`, no role check) was replaced with one restricted to
`get_user_role() = 'employee'`.
**Rationale:** found by `12-permissions-ui.mjs` check II1: a `client_user` (or a partner)
whose `user_permissions` row could only ever be force-seeded by service-role — the
INSERT/UPDATE/DELETE policies already correctly require the target to be a same-firm
`role='employee'` row — was still readable by that user via raw PostgREST if such a row
ever existed, because the SELECT policy had no matching role restriction. No write path was
ever affected (all four write-side checks against a client_user passed on the first run);
this was a defense-in-depth gap, not a demonstrated escalation. Closed at the DB layer
rather than left resting on "no write path currently creates one," since Phase 13.3's own
requirement was "a client_user gets zero rows," unconditionally. Applied in Studio, folded
into `schema.sql` immediately (same-day, unlike migrations that sit drafted for longer),
re-verified 25/25.
**Status:** active. (Phase 13.3, migration 009)

### 2026-07-23 — Phase 14 split into 14.1 (verification sweep) / 14.2 (fix session) / 14.3 (migration 006 reconciliation)
**Decision:** the single "Phase 14 — Final RLS pass" roadmap entry is split into three
independently trackable sub-phases, same pattern as the Phase 13 split above.
**Rationale:** a verification-only session (14.1) needed to run to completion without the
temptation to fix anything it found mid-sweep — the session's own explicit instruction was
"do NOT fix anything you find... a complete map of what's wrong is more valuable than a
partial sweep with one thing patched." Splitting the fix work into 14.2 (ordinary findings)
and 14.3 (the migration-006 documentation-accuracy question, which is a ⚠ HUMAN gate distinct
from ordinary code fixes) keeps each session's scope honest the same way the Phase 13 split
did.
**Status:** active. 14.1 is complete (see below); 14.2/14.3 are unscheduled roadmap items.

### 2026-07-23 — Phase 14.1: exhaustive probe-driven RLS sweep, 7 findings, zero fixes applied
**Decision:** `scripts/verify/14-rls-sweep.mjs` swept 30 of 33 live tables × a full role
matrix × cross-firm, plus every `SECURITY DEFINER` function taking a caller-influenced
argument, entirely via real signed-in raw-PostgREST calls (Supabase MCP was available this
session and was used only to *enumerate* schema objects — table list, function list, live
column/policy state — never to conclude behavior). 116/116 assertions matched their
predicted outcome; 7 of those predictions were `FINDING-CHECK`s expecting a gap to exist, and
all 7 confirmed one. Full detail: `docs/verification/phase-14-rls-sweep.md`.
**Rationale:** the session's explicit premise — stated up front, not discovered mid-session —
was that policy-text review had already failed twice in this project (DSC register's
`is_firm_staff`-vs-`clients.view` scope error, migration 008; `user_permissions`' unscoped
self-view policy, migration 009), so this pass had to be empirical from the start, and
exhaustive rather than table-by-table, specifically to catch scope errors invisible in the
SQL itself. That method caught `apply_receipts_to_invoice()` — a function never named in any
prior known-risk list in this project — by mechanically asking "does every SECURITY DEFINER
function's body check anything before it acts," not by checking only functions that seemed
important in advance.
**What it found, ranked:** F0 (critical — `apply_receipts_to_invoice()` is a directly
RPC-callable cross-firm write primitive with zero ownership check), F1-RPC (high —
`get_firm_plan()` leaks any firm's subscription plan cross-tenant, bypasses `billing.view`),
F2 (high — the staff storage policy has no task/department scoping, architecturally the same
shape as the historical client-side `portal-isolation.md` #7), F3 (medium — `profiles` DELETE
lets a partner remove a co-partner, no target-role exclusion), F4 (medium — `tasks.assign`
confirmed to have no RLS branch anywhere), F5 (low — task-less documents are visible
firm-wide to any `clients.view` holder, not department-scoped), plus a ⚠ HUMAN
documentation-accuracy item: migration 006 is confirmed **live** on the project despite this
file, `docs/ROADMAP.md`, and `project_context.md` all having described it as
drafted-not-applied. **This item was resolved the same day — see the next entry below.**
**Status:** F0–F5 active, unfixed — see `docs/ROADMAP.md` Phase 14.2 for the fix-session
scope. The migration-006 documentation-accuracy item is resolved (see below).

### 2026-07-23 — Migration 006 reconciliation: fully applied 2026-07-18, docs were stale
**Decision:** migration 006 is confirmed fully applied and requires no further DDL action —
every object it defines (`receipts.invoice_id` nullability + its column comment,
`guard_receipt()`, `handle_receipt_change()`, the rebuilt `client_outstanding` view, the
`receipt_history` table + indexes + RLS + policies, `log_receipt_change()` + its trigger, and
`has_permission()`'s billing.manage/view pairing) was independently re-verified live this
session via read-only Supabase MCP queries and matches the migration's own text exactly,
including inline comments naming "migration 006" and specific review-finding numbers.
**Rationale / evidence:** `git log --follow` on the migration file shows exactly one commit,
`45fa98c` (2026-07-18), whose own message states plainly: "Applied to the live Supabase
project via Studio; folded into schema.sql in the same change per the migrations-land-twice
rule." `git show --stat` confirms the migration file and `schema.sql` changed together in
that commit. The root cause of the five-day (then further-extended) documentation gap: the
migration file was authored from this project's standard pre-apply template — the same
"NOT YET APPLIED" boilerplate every migration opens with — and that in-file header was never
edited afterward to match the commit's own message, even within the same commit. Every
downstream document (`project_context.md`, `docs/ROADMAP.md`, and this file's own entry added
five days later) took the stale header at face value instead of checking the live database or
the commit message. Migrations 004, 005, 007, 008, and 009 were also spot-checked for related
drift (privileges, triggers, columns, RLS policies) — none found; `schema.sql` is a truthful
record of the live database everywhere this session looked. One low-risk side-finding not
caused by migration 006 itself: `client_outstanding` retains un-revoked `anon` DML grants
(matches what `schema.sql`'s own REVOKE statement already says — a gap in the migration text,
not in its application), folded into Phase 14.2's existing default-privileges audit item.
**Status:** resolved. Full investigation: `docs/verification/migration-006-reconciliation.md`.
Doc-only corrections applied same-day to migration 006's header, `project_context.md`,
`docs/ROADMAP.md`, and this file. See the next entry for the structural fix.

### 2026-07-23 — New migration convention: the folding session must also update the migration file's own header
**Decision:** from now on, whenever Jay confirms a migration applied cleanly in Studio, the
same session that folds it into `schema.sql` must ALSO edit that migration file's own header
to `✅ APPLIED <date>` — updating the tracking docs (`project_context.md`/`docs/ROADMAP.md`/
this file) is necessary but not sufficient on its own.
**Rationale:** this is the exact gap that caused the migration-006 reconciliation above.
Migration 006 was genuinely applied and correctly folded into `schema.sql` in one commit, but
that same commit left the migration file's own "NOT YET APPLIED" header untouched — and every
later session (including the one that first wrote this file's operational-knowledge note
about migration 006, and Phase 14.1's RLS sweep five days after that) trusted the header
instead of the live database. A tracking doc describing a migration as applied is only as
reliable as the last person who remembered to update it; the migration file's own header,
checked in the same commit as the fold, is much harder to let drift, because it sits right
next to the DDL it describes. **Migration 008's header has the identical gap** (still says
"NOT YET APPLIED" despite `project_context.md` describing it as applied clean in Studio) —
noted, not corrected as part of this decision (out of scope for the session that found it).
**Status:** active. Applies to every migration from here forward; migration 006's header was
corrected same-day as the first application of this rule.

### 2026-07-23 — Phase 14.2, F0 fixed and applied: apply_receipts_to_invoice() ownership check
**Decision:** migration 010 adds a `billing.manage` permission check and a firm-ownership
check (`p_invoice_id` must resolve to a row in the caller's own firm) inside
`apply_receipts_to_invoice()`'s body, gated behind `auth.role() <> 'service_role'` so the
internal `handle_receipt_change()` trigger-invocation path — which fires on every `receipts`
write, including service-role-driven ones with no JWT at all — is unaffected. Applied cleanly
in Studio, folded into `schema.sql`, migration file header updated to `✅ APPLIED 2026-07-23`
in the same session per the convention above.
**Rationale:** the function is `SECURITY DEFINER`, so it bypasses RLS entirely — its own body
was the only security boundary that could ever exist for it, and until this fix that boundary
was empty, letting any authenticated user in any firm force a write against another firm's
`firm_invoices` row. `auth.role() = 'service_role'` was chosen over `auth.uid() IS NULL` as the
trusted-caller signal specifically because an anon-key caller with no session also presents a
null `auth.uid()` — the two cannot be told apart that way, whereas `auth.role()` reads a
JWT-signed claim that an anon or authenticated caller cannot forge into `'service_role'`.
**Proof, not policy-reading:** `scripts/verify/14-rls-sweep.mjs` gained 4 cases, all passing —
a cross-firm caller with zero billing permission is rejected; a same-firm caller with
`billing.manage` succeeds (no regression on the legitimate path); a same-firm caller WITHOUT
`billing.manage` is also rejected (proves the permission guard fires independently of the
ownership check — this caller does own the firm relationship but still lacks the permission);
and a direct `service_role` RPC call still succeeds (proves the exemption is intact and didn't
silently break the trigger it exists for). 119/119 sweep checks pass overall.
**Status:** resolved and shipped, committed separately from any other Phase 14.2 item
(`d8d2db9`), per the guardrail that F0 ships alone before F1-RPC and the remaining findings are
touched. F1-RPC through F5, the `client_outstanding` anon-grant fold-in, migration 008's stale
header, and the systemic SECURITY DEFINER audit remain open — see `docs/ROADMAP.md` Phase 14.2.

### 2026-07-23 — Phase 14.2, F1-RPC fixed and applied: get_firm_plan() ownership check
**Decision:** migration 011 adds a `billing.view` permission check and a firm-ownership check
(`p_firm_id = get_user_firm_id()`) inside `get_firm_plan()`'s body — same shape as F0 — with
`is_super_admin()` added alongside `service_role` as an exemption from the **ownership check
only**. Applied cleanly in Studio, folded into `schema.sql`, migration header updated to
`✅ APPLIED 2026-07-23`.
**Rationale:** the function is `SECURITY DEFINER`, bypassing `firm_subscriptions`'
`billing.view`-gated RLS entirely, and took an arbitrary firm UUID with zero checks — an
employee with `billing.view` revoked got her own firm's plan anyway, a different firm's
employee got real cross-tenant plan data by UUID, and a `client_user` could do the same. The
`is_super_admin()` exemption is necessary because `platform_admins.user_id` FKs to
`auth.users`, not `profiles` — a platform super admin has no `profiles` row at all, so
`get_user_firm_id()` resolves NULL for them, and a bare ownership check would wrongly block
the cross-firm visibility `platform_admins` exists to grant. `has_permission()` already
resolves `true` for a super admin internally, so only the ownership check needed the new
exemption.
**Proof, not policy-reading:** `scripts/verify/14-rls-sweep.mjs` seeded a new role (PSA — a
`platform_admins` row with deliberately no `profiles` row, mirroring the real bootstrap path)
and added 6 cases, all passing: cross-firm employee rejected; same-firm `billing.view` holder
succeeds; same-firm caller without `billing.view` rejected (permission guard independent of
ownership — this is the exact original bypass); `client_user` rejected cross-firm; PSA
succeeds cross-firm (the regression-risk case — proves the exemption is actually wired up, not
just written); direct `service_role` call succeeds. 122/122 sweep checks pass.
**Status:** resolved and shipped, committed separately (`2ae59b6`). F2 through F5 remain open.

### 2026-07-23 — Known input for Phase 15: firm_has_feature() will need its own DEFINER body
**Decision (recorded now, not acted on):** when Phase 15 wires plan/seat/storage enforcement
into server actions, `firm_has_feature()` must NOT keep proxying through `get_firm_plan()` —
it should get its own `SECURITY DEFINER` function scoped directly to `get_user_firm_id()`,
with no `p_firm_id` argument at all.
**Rationale:** migration 011's F1-RPC fix (previous entry) added a `billing.view` requirement
to `get_firm_plan()`, and `firm_has_feature()` calls `get_firm_plan()` internally — so it now
inherits that requirement too. Harmless today (`firm_has_feature()` has zero callers anywhere
in `src/`), but Phase 15's enforcement work will call it from ordinary employee-run server
actions, most of whom default to `billing.view = false`. A boolean answering "does my own
firm's plan include this feature" is not billing-sensitive in the same way a full plan/pricing
readout is — gating it on `billing.view` would incorrectly block plan-limit enforcement for
the majority of staff.
**Status:** not yet acted on — deliberately out of scope for migration 011 (per explicit
instruction not to touch that migration for this). Tracked in `docs/ROADMAP.md` Phase 15.

### 2026-07-23 — Phase 14.2, F2 fixed and applied: staff storage scoped to can_access_document()
**Decision:** rewrite the staff storage SELECT policy, not document its firm-wide reach as
intentional — the two options the sweep doc offered. Migration 012 adds
`can_access_document(document_id)` (path segment `[3]` of
`{firm_id}/{client_id}/{document_id}/{uuid}.{ext}`) to both the staff storage SELECT policy AND
the staff storage INSERT policy, mirroring the client storage policy's existing pattern.
Applied cleanly in Studio, folded into `schema.sql`, migration header updated to
`✅ APPLIED 2026-07-23`.
**Rationale:** the deciding factor was that the client storage policy already joined through
`can_access_document()` — so the least-trusted role (`client_user`) was already more tightly
scoped at storage than staff were, which is an oversight, not a deliberate trust-model
asymmetry. Formally documenting firm-wide staff reach as intentional would have meant recording
a boundary the codebase couldn't actually back up, given it directly contradicted the
department-scoping model already enforced for `tasks`/`documents`.
**A second gap found and fixed in the same migration:** the staff storage INSERT policy had an
identical, narrower hole (no `document_id` check), letting a staff member with
`documents.upload` write bytes into another document's folder without any department access to
it. The SELECT fix alone would have *upgraded* this gap's severity — once storage reads are
properly scoped, a planted file inherits the read access of whoever legitimately owns that
folder — so shipping SELECT without INSERT would have been worse than shipping neither.
**Proof, not policy-reading:** verified the path-segment index (`[3]`) against the existing,
already-correct client policy rather than re-deriving it; verified upload ordering against
`src/lib/documents/actions.ts` directly (`documents` row always exists, and access is already
established, before the storage write, in both the new-document and new-version flows).
`scripts/verify/14-rls-sweep.mjs` gained 6 cases, all passing: no-access employee denied both
download and list; in-scope employee unaffected; partner bypass intact; `client_user`'s
untouched policy unaffected; a real upload plus a same-folder second upload (mirroring a
new-version upload) succeed end to end; and a no-access employee is denied *writing* into
another document's folder — the INSERT-side fix proven directly. 126/126 sweep checks pass.
**Status:** resolved and shipped, committed separately (`fe4b219`). F3 through F5 remain open.

### 2026-07-23 — Phase 14.2, F3 fixed and applied: block partner-on-partner profile deletion
**Decision:** the `profiles` DELETE policy's target-role gap is closed by blocking
partner-on-partner removal entirely (`AND role <> 'partner'` in the `USING` clause), not by
routing it through a narrower confirmation mechanism — the second option the sweep doc
offered. Applied cleanly in Studio, folded into `schema.sql`, migration 013's header updated
to `✅ APPLIED 2026-07-23`.
**Rationale:** mirrors the line migration 009 already drew for `user_permissions` (scoped to
`role = 'employee'` targets only, never a partner). A partner unilaterally removing a
co-partner's entire staff access with a single DELETE call, no consent or notification path,
is a governance-sensitive action for the product's ownership tier — if this is ever genuinely
needed, it should be a manual/support-assisted action outside the app, not an in-app one.
**A fourth case, not in the original plan, investigated rather than assumed:** the exclusion
is negative (`role <> 'partner'`), so a `client_user` target remains deletable. Checked whether
this is a gap that should instead become a positive `role = 'employee'`-only scope (matching
009's shape) — concluded no: no code in `src/` deletes any `profiles` row of any role today
(this policy is dormant at the app layer), there is no dedicated "revoke portal access" UI, and
a `client_user` carries none of the governance weight a co-partner does (no elevated privilege
to lose, still firm-scoped). Recorded as **intended**, not a gap requiring a follow-up
migration.
**Proof, not policy-reading:** `scripts/verify/14-rls-sweep.mjs` gained 4 cases, all passing:
partner-on-partner denied (the fix); partner removing an employee still succeeds (no
regression); self-deletion stays blocked (the pre-existing guard, untouched); and partner
removing a client_user still succeeds (the investigated case above, proven empirically with a
dedicated throwaway seed user rather than reusing UA1/UA2, which stay alive for the rest of the
run). 127/127 sweep checks pass.
**Status:** resolved and shipped, committed separately (`7952076`). F4 (architectural — Jay's
call, not yet made) and F5 remain open.

### 2026-07-23 — Phase 14.2, F4 fixed and applied: tasks.assign gets a real enforcement point
**Decision:** add a real RLS-layer enforcement point for `tasks.assign`, not formally accept
`tasks.update_department` as sufficient and correct the docs/catalog instead — the second
option the sweep doc offered. Migration 014 adds a `BEFORE UPDATE` trigger,
`enforce_task_assignment_permission()`, that blocks any change to `assigned_to` unless the
caller holds `has_permission('tasks.assign')`. Applied cleanly in Studio, folded into
`schema.sql` (new §9.4b), migration header updated to `✅ APPLIED 2026-07-23`.
**Rationale:** RLS policies are row-scoped, not column-scoped — no policy can say "this UPDATE
may touch `department_id` but not `assigned_to`" without narrowing the department-updater
policy's own intentionally broad reach (any column, any department task). This project already
has the matching pattern for exactly this class of problem — `enforce_profile_protected_fields()`
(§9.2) and `guard_firm_invoice`'s frozen-column list — reused here rather than inventing a third
mechanism. `has_permission('tasks.assign')` alone is sufficient inside the check (no separate
partner/super_admin branch needed, since `has_permission()` already resolves both true
internally). `auth.uid() IS NULL` (not `auth.role() = 'service_role'`, migration 010/011's
pattern) is the correct service-role signal here, because every UPDATE policy on `tasks` is
`TO authenticated` only — an anon caller can never reach this trigger, so the ambiguity that
motivated `auth.role()` for directly-callable SECURITY DEFINER RPCs doesn't exist for a trigger
gated behind a `TO authenticated`-only policy set.
**Proof, not policy-reading:** `scripts/verify/14-rls-sweep.mjs` gained 5 cases, all passing: the
fix itself (E0 denied); partner bypass intact; a real `tasks.assign` holder unaffected (no
regression); an unrelated-column update still succeeds (trigger correctly scoped to
`assigned_to` only); and a fifth case raised mid-review — `tasks.create` alone can still set an
initial assignee via INSERT, since the trigger is UPDATE-only. 131/131 sweep checks pass.
**The INSERT-time case, investigated rather than assumed:** concluded this is intended, not a
gap — create-and-assign in one step is normal workflow (the app's own `createTaskAction` already
allows it), and the INSERT itself stays gated to the creator's own department.
**A genuine follow-up gap, found while investigating that case, NOT one of the original 7
findings:** `assigned_to` has no firm-membership validation at all, on INSERT or UPDATE.
Confirmed directly: E0 created a Firm A task with `assigned_to` pointing to a Firm B employee,
and it succeeded with no error. Jay's call: fix now, same session (migration 015, drafted,
pushed, not yet applied at the time of this entry) rather than defer to 14.1b, since the trigger
is already open in context and this is a genuine cross-tenant data-integrity gap.
**Status:** F4 resolved and shipped, committed separately (`ad2fd8d`). The follow-up
firm-membership gap is drafted (migration 015) but not yet applied — see the next entry once
confirmed. F5 remains open.

### 2026-07-23 — Follow-up fixed and applied: assigned_to firm-membership check (migration 015)
**Decision:** fix the assigned_to firm-membership gap now, in the same session, rather than
deferring to 14.1b — the tasks-assignment trigger from migration 014 was already open in
context, and this is a genuine cross-tenant data-integrity gap, not a nicety that can wait.
Migration 015 extends `enforce_task_assignment_permission()` to also fire `BEFORE INSERT` and
validate that `assigned_to` belongs to `NEW.firm_id` whenever it's being set — unconditionally,
including for service-role writes, since this is a data-integrity check (a foreign-key-style
validity constraint), not an authorization decision the way the `tasks.assign` permission gate
is. Applied cleanly in Studio, folded into `schema.sql`, header updated to
`✅ APPLIED 2026-07-23`.
**Proof:** `scripts/verify/14-rls-sweep.mjs` gained 4 cases, all passing: cross-firm rejected on
INSERT; cross-firm rejected on UPDATE, even for a `tasks.assign` holder (proving the firm check
fires independently of, and in addition to, the permission check); same-firm assignment still
succeeds on both paths (no regression); and a direct service-role write with a cross-firm value
is also rejected (confirming the data-integrity check applies unconditionally, unlike the
permission gate). 135/135 sweep checks pass at that point.
**Status:** resolved and shipped, committed separately (`bb48a76`).

### 2026-07-23 — Follow-up fixed and applied: reviewer_id/department_id firm-membership checks (migration 016)
**Decision:** while confirming migration 015's fix, per Jay's explicit instruction to check
whether the same class of bug existed on `tasks`' other two profile/department FKs before
moving past F4 — it did, on both. `reviewer_id` had the identical exposure `assigned_to` did
(no firm check on INSERT or UPDATE), and was never gated by `tasks.assign` at all, unlike
`assigned_to`. `department_id` had a narrower, partner-only gap: the employee INSERT branch was
already implicitly firm-safe via department membership, but the partner branch bypassed that
check entirely, and the matching partner UPDATE path had the same hole. Migration 016 extends
the same trigger function with two more unconditional firm-membership checks, same shape as
`assigned_to`'s. Applied cleanly in Studio, folded into `schema.sql`, header updated to
`✅ APPLIED 2026-07-23`.
**Scoped deliberately to data integrity only:** neither new check touches the `tasks.assign`
permission gate. Whether `reviewer_id` assignment should also require `tasks.assign` — the way
`assigned_to` now does — is a real, open question, but answering it silently inside a
data-integrity fix is exactly how undocumented policy happens. **Recorded here as an open
question for a later, deliberate decision, NOT acted on:** should changing `reviewer_id` on an
existing task require `has_permission('tasks.assign')`, mirroring `assigned_to`'s migration-014
gate? Today it does not — any caller who can pass the department-updater (or partner) UPDATE
policy can change `reviewer_id` freely, with only the new firm-membership check (migration 016)
in place. No action taken on this question; flag it again before shipping any feature that
leans on `reviewer_id`'s current semantics.
**Proof, including a check that a shared trigger function wasn't silently broken by this
migration:** verified directly against the live database (`pg_trigger`, not inferred) that
`enforce_task_assignment`'s timing was unchanged after its function body was replaced —
`tgtype = 23` (`BEFORE INSERT OR UPDATE`), `tgenabled = 'O'` — and re-ran migration 015's four
`assigned_to` cases to confirm they still pass after this migration touched the same shared
function (extending a shared trigger is exactly the place a later migration could quietly break
an earlier fix). `scripts/verify/14-rls-sweep.mjs` gained 6 new cases, all passing: cross-firm
`reviewer_id` rejected on both INSERT and UPDATE; cross-firm `department_id` rejected for a
partner on both INSERT and UPDATE; same-firm values for both still succeed on both paths.
141/141 sweep checks pass.
**Status:** resolved and shipped, committed separately (`b5e7cab`). F5 remains open; the
`reviewer_id`/`tasks.assign` question above is open, not scheduled.

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
- **⚠ RESOLVED 2026-07-23 — migration 006 is fully applied (2026-07-18); this note's original
  "drafted, not applied" claim was stale, not a live-database problem.** This note originally
  said migration 006 (billing audit + pairing) was drafted and unapplied, awaiting the same
  Studio gate as every prior migration. Phase 14.1's exhaustive RLS sweep found
  `receipt_history` and nullable `receipts.invoice_id` live and flagged the contradiction as a
  ⚠ HUMAN item; a same-day follow-up reconciliation session confirmed via `git log` that
  migration 006 was applied 2026-07-18 (commit `45fa98c`, whose own message says so) and
  every object it defines matches the live database exactly — full application, not partial.
  The root cause: the migration file's own header was never updated to say APPLIED, and every
  downstream doc (including this note) trusted that stale header instead of checking the live
  database or the commit message. See `docs/verification/migration-006-reconciliation.md` for
  the full investigation, and the new "migration convention" decision entry above (this
  project now requires the folding session to also update the migration file's own header, not
  just the tracking docs, specifically to prevent this recurring). The truncation note below
  is a separate, still-accurate fact: on 2026-07-21 the migration 006 file (and
  `docs/ROADMAP.md`) were found accidentally truncated to near-empty in the working tree —
  restored from `origin/main`. **Do not treat a local truncation of this file as an
  intentional edit** — verify against `origin/main` before assuming any local state of
  migration 006 is meaningful.

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
