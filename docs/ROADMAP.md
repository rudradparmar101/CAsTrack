# ROADMAP — execution plan (v2, 2026-07-09)

## Protocol
- Sessions are started with a runner prompt pointing here. Execute the FIRST phase not marked [x]. If a phase is marked [~] (in progress), resume it from its findings/progress notes instead of restarting.
- ONE phase per session. When the exit gate is met, stop and report — never begin the next phase, even if green.
- Read project_context.md fully before starting any phase. It defines expected behavior; this file defines the work.
- Phase end ritual: npm run build + npm run lint green vs baseline → update project_context.md (header date, §0 rows, §5 phase row, any §6 items resolved) → mark the phase [x] here → commit with the given message → report summary + blockers.
- Bug protocol: small bugs (labels, missing revalidate, wrong notification mapping) → minimal fix, own `fix:` commit, log in the phase findings file. Architectural findings (schema, RLS policy, trigger, auth/provisioning) → STOP, write up, report, wait for approval.
- Testing and deletion NEVER in the same phase/session.
- ⚠ HUMAN items: stop and ask Jay; do not work around them.
- KNOWN-ACCEPTED (do not "fix"; each has a designated phase): tasks.assign app-layer-only; .update().select().single() false-denial on visibility-moving updates; task_stage_history.note unwritable; portal lists unpaginated (Ph11); task search not covering client names.
- Never commit .env.local or any key. Before ANY remote push: verify .env.local is gitignored AND absent from all history (git log --all -- .env.local); if it was ever committed, STOP — key rotation required.
- Lint baseline today: 2 pre-existing notification-bell.tsx errors + 4 unused-var warnings. From Phase 8 onward the baseline is fully clean.

## Phase 7 — Runtime verification [x]  (testing only: no new features, no deletions, no refactors)
**Progress note (2026-07-10):** `scripts/verify/*.mjs` (admin API + Playwright, `playwright` added as devDependency) is the working implementation of this phase's checklist. Steps 1–4 are done and green (see each checklist item for details). Recurrence spawn and the RLS smoke script have not been started — resume here next session. Findings doc (`docs/verification/phase-7-runtime.md`) not yet written. None of this is committed yet (playwright dep + scripts/ + schema.sql/ROLES_AND_RLS.md RLS-widening edits + documents-section.tsx button fix still sit uncommitted).
- [x] Pre-flight: build/lint at baseline; .env.local → live CA project; npm run dev starts.
- [x] Test data (fresh firm; reuse the Ph5 admin-API workaround for the signup-email rate limit; service-role only in local scripts): P1 partner via real signup→onboarding; E1 employee via invite code, GST department, default perms; E2 employee, no department, clients.view revoked via direct service-role INSERT into user_permissions (no UI yet — expected, Ph13); clients A & B with addresses/persons; tasks incl. one with reviewer, one without, one monthly recurring, mixed client-visibility; portal invite for A — capture link from SERVER CONSOLE (expected, not a bug). — `01-setup-test-data.mjs`, green.
- [x] Stage matrix as E1 via UI: every legal arrow (created→assigned auto on assign, assigned→in_progress, in_progress⇄waiting_client, in_progress→under_review, under_review→in_progress send-back with note, under_review→completed, completed→archived). Reviewer rule both ways: reviewer set ⇒ E1 in_progress→completed REJECTED with friendly message; reviewer NULL ⇒ succeeds. — `02-stage-matrix.mjs`, green.
- [x] One illegal transition (e.g. waiting_client→completed as E1): rejected in UI AND retried via direct authenticated PostgREST to prove the DB trigger enforces, not just hidden buttons. — covered in `02-stage-matrix.mjs`.
- [x] One partner force via override select (e.g. completed→in_progress) succeeds. — covered in `02-stage-matrix.mjs`.
- [x] After each transition: task_stage_history row + correct activity entry. — covered in `02-stage-matrix.mjs`.
- [x] Notifications (table rows + one bell spot-check) per §4.5 map: task_assigned; approval_requested; task_rejected (carries note); task_completed to creator (+ task_approved to assignee when via review); comment_added; document_uploaded; waiting_client → NONE (intentional). — covered in `02-stage-matrix.mjs`.
- [x] Comments isolation: E1 posts one internal + one client-visible on a visible client-A task; client replies are labeled (client) and force-visible — attempt visible_to_client=false from the portal path, must not stick. — `03-comments-and-documents.mjs`, green.
- [x] Documents: new version → current_version bumps AND approval resets to pending; approve → uploader notified; reject WITH reason → stored; attach-existing same-client works (partner or documents.approve); cross-client attach (B-doc onto A-task) via the action → blocked. — `03-comments-and-documents.mjs`, green (cross-client block verified by code inspection, not independently exercised live — noted in the results file).
- [x] Portal e2e (NEVER tested — centerpiece): console invite link in clean browser → accept-invite → auto-confirmed login → middleware lands /portal. Only client-A visible non-archived tasks (pending first); the internal comment is INVISIBLE; staff author renders "Your CA firm"; softened stage wording + waiting_client banner/CTA; portal reply + upload land staff-side with activity entries; rejection reason verbatim + "Upload a corrected file"; a staff stage change reflects on portal refresh. — `04-portal-e2e.mjs`, 18/19 green. **Resolved (2026-07-10):** Jay approved widening client document visibility to include rejected (not just approved); applied to the live DB (`can_access_document()` + the `documents` SELECT policy, both in schema.sql) and confirmed live via direct RPC/RLS probes before re-running. That surfaced a second real bug in the same area: `DocumentsSection`'s "Upload a corrected file" button was gated on `doc.uploaded_by === currentUserId` (client must be the ORIGINAL uploader), stricter than both the new RLS visibility and the `document_versions` INSERT policy (which only requires `can_access_document()`, no uploader match) — so a client could see a rejection reason but never act on it if staff had uploaded the document on their behalf. Fixed: gated on `viewer === 'client' && canUpload && approval_status === 'rejected'` instead; `currentUserId` was then dead in `DocumentsSection` and cascaded out of 4 call sites (`task-documents.tsx`, `client-detail-client.tsx`, and their own callers) to keep lint at baseline. Also fixed two test-script-only bugs found while re-running: the "N tasks are waiting on you" banner check used a bare regex `getByText` that strict-mode-matched both the inner `<span>` and its parent `<p>`, silently swallowed by `.catch(() => false)` — narrowed with `.first()`; the "activity feed logs the client comment" check queried `task_activities` as a one-shot read immediately after posting a comment, but `addTaskCommentAction` awaits the comment insert, then `notifyUsers`, then `logTaskActivity` sequentially server-side, so it could read before the third step landed — switched to the same `waitForCond` polling pattern already used for the comment-row check. Remaining 1/19 failure ("Accept-invite → lands on /portal") is the pre-existing, already-documented dev-mode redirect-timing race (same class as `/onboarding`): the assertion's own URL check sometimes fails, but every subsequent assertion on that page (welcome text, task list, etc.) passes moments later, confirming the portal does load correctly — logged as known test-harness flakiness in the findings doc, not a product bug, not reinvested in further.
- [x] Recurrence: complete the monthly task → next spawns (due + statutory dates shifted, period_label cleared, parent_task_id set, recurring_generated activity). — `05-recurrence.mjs`, 12/12 green, first run.
- [x] scripts/verify/rls-smoke.ts (committed; ANON key sign-ins as P1/E1/E2/client-A): E1 sees assigned ∪ GST-dept only, other-dept client-B task → empty select + failed UPDATE; E2 → EMPTY clients select despite employee default; client-A cannot select internal comments, cannot see client-B tasks/docs, cannot UPDATE tasks, cannot INSERT notifications directly (RPC-only), forced-visible comments; task_stage_history readable by staff, empty for client. — written as `rls-smoke.mjs` (no TS runner configured in this project; every other verify script is `.mjs` too), 14/14 green, first run.
- [x] Findings: docs/verification/phase-7-runtime.md (checklist pass/fail, bugs + fixes, deferred). Written.
- Exit gate: all checks pass or documented; commit `test: phase 7 — runtime verification (stage matrix, documents, portal e2e, RLS smoke) + findings`.

## Phase 8 — Type unification + deletions [ ]  (zero behavior change)
- [ ] Dashboard (admin-dashboard.tsx / member-dashboard.tsx) onto FirmTask*; delete components/task-card.tsx.
- [ ] Delete legacy-compat exports markTaskCompleteAction / deleteTaskAction (fold needed logic into the FirmTask path); delete lib/activity.ts + lib/notifications.ts (orphans); remove aliases Organization = Firm and 'admin'|'member' from UserRole; remove deprecated `organization` field from getAuthContext; fold templates/actions.ts onto FirmTaskTemplate.
- [ ] Move legacy supabase/ artifacts (old schema.sql, migrations/, cron.sql, fix-rls-policies.sql, functions/) to supabase/_legacy-deadlinetracker/ with a README: reference only, DO NOT APPLY.
- [ ] Fix the 2 notification-bell.tsx lint errors + 4 unused-var warnings → lint fully clean becomes the new baseline.
- [ ] ⚠ HUMAN: private GitHub repo / remote URL from Jay. Run the .env.local history check from Protocol, then push.
- [ ] Playwright spot-check: dashboard visually and functionally equivalent for partner + employee.
- Exit: build + lint FULLY clean; pushed to remote; commit `refactor: unify task types onto FirmTask; delete legacy surface` (separate `chore:` commits for archive/lint fine).

## Phase 9 — CA-core schema extension [ ]  (design + migration; live DB gate)
- [ ] Design migration 001 in supabase/ca-firm/migrations/: client_registrations (type: gstin|tan|pf|esi|pt|…, registration_number, state, GST scheme regular|composition|qrmp, is_active); audit-applicability flags on clients (or client_compliance_profile); compliance_types catalog (code, name, department mapping, periodicity monthly|quarterly|annual|event, due/statutory day rules, applicability predicate vs registrations) + seed rows for the confidently-known core set (GSTR-1, GSTR-3B incl. QRMP, TDS payment, 24Q/26Q, advance tax, GSTR-9, ITR variants, AOC-4, MGT-7 — extendable); tasks: financial_year, period_type, period_key, source manual|recurring|statutory, nullable compliance_type_id, category routine|notice (stopgap notice bucket); UNIQUE (client_id, compliance_type_id, period_key) for statutory; RLS for every new table written NOW (house style); indexes.
- [ ] Encode the locked decision: statutory tasks are CALENDAR-generated; completion-chaining remains ONLY for internal recurring tasks — guard the Ph4 spawn path to skip source='statutory'.
- [ ] Fold everything into schema.sql too (stays the greenfield source of truth); the migration file is the delta for the live DB.
- [ ] ⚠ HUMAN STOP: present migration SQL + rollback notes to Jay BEFORE applying to the live project. On approval: apply, verify, commit `feat(schema): CA compliance core — registrations, compliance_types, structured periods (migration 001)`.

## Phase 10 — Compliance core build [ ]  (sub-commit per chunk)
- [ ] (a) Registrations editor on client form/detail (JSON sub-form pattern like addresses; validate via ca-options.ts regexes).
- [ ] (b) Idempotent generation engine: per firm, active client × applicable compliance_type × current period → upsert task via the unique key; department from mapping; dates from rules; handles mid-year onboarding + applicability changes; partner "Generate now" server action + a Vercel cron route (service-role execution documented; pg_cron noted as alternative).
- [ ] (c) Filing-status grid: clients × periods per compliance type/month, stage-colored cells linking to tasks; partner + permitted staff.
- [ ] (d) Filing outcomes: ARN/ack no. + filed date captured at completion for statutory tasks; shown on task + grid.
- [ ] Scripted seed: demo firm, ~20 clients, mixed applicability; verify generation + grid against it.

## Phase 11 — Communication [ ]
- [ ] ⚠ HUMAN: RESEND_API_KEY + sending domain from Jay.
- [ ] Wire Resend: portal invites (kill the console.log stub), notification emails (assignment, review request, rejection with reason, completion); in-app notifications unchanged.
- [ ] Reminder scheduler behind a channel-agnostic sender (email now, WhatsApp later): T-7/T-3/T-1 statutory due-date reminders to client contacts; waiting_client nag after N days; cron route.
- [ ] Surface template checklist_items on portal tasks as per-item received/pending (staff toggle; client sees what's missing).
- [ ] Portal completion: assigned-contact SECURITY DEFINER RPC (NOT a widened profiles policy), client notification surfacing, portal pagination.
- Exit: emails observed in Resend logs; commit(s).

## PILOT CHECKPOINT — ⚠ HUMAN only [ ]
Onboard one friendly firm (lined up during Ph9–10). Collect feedback. Feedback may reorder Phases 12+ — Jay updates this file if so. No code.

## Phase 12 — Client billing & receivables [ ]
- [ ] Migration 002 (same ⚠ HUMAN approval gate as Ph9): fee_masters (client × service, amount, periodicity); firm_invoices + line items (firm→client, GST fields, SAC 9982, per-firm-FY numbering); receipts (mode, TDS u/s 194J deducted); outstanding view; fees_hold flag on clients.
- [ ] UI: invoice create + portal-visible/email delivery, receipts entry, per-client + firm-wide outstanding ledger, fees-hold banner on tasks/grid.

## Phase 13 — Registers + permissions UI [ ]
- [ ] Credentials vault (⚠ migration gate): pgsodium/Supabase Vault server-side encryption; reveal only via a narrow server action gated by new vault.view/vault.manage permissions; audit-log table recording every reveal.
- [ ] DSC register: dsc_records (holder client/person, expiry, storage location) + custody movements (in/out, who, when); expiry alerts into the Ph11 scheduler.
- [ ] Per-employee user_permissions editor on the Team page (grant/revoke overrides).

## Phase 14 — Final RLS pass + committed policy tests [ ]
- [ ] Re-review every policy vs finalized behavior: Ph3 documents INSERT relaxation; tasks.assign branch decision; doc↔task client-consistency trigger; stage-history note via session variable; all Ph9–13 tables. ⚠ migration gate for policy changes.
- [ ] Idempotent policy-recreator script; expand rls-smoke.ts into a committed role-JWT suite covering the full matrix; wire as an npm script.

## Phase 15 — SaaS plumbing [ ]
- [ ] Plan/seat/storage enforcement in server actions (existing DB helpers get_firm_plan / firm_has_feature / storage_used_bytes).
- [ ] ⚠ HUMAN: Razorpay account/keys. Webhooks → firm_subscriptions / subscription_invoices via service role.
- [ ] Super-admin /admin surface (plans, firms, subscriptions; platform_admins-gated).

## Deferred (post-pilot, promote to phases on demand)
Full notices module (Ph9 category tag is the stopgap) · client groups · timesheets/attendance · GSP/Tally sync · UDIN/challan registers · WhatsApp Business API channel (Meta application + hook into the Ph11 channel-agnostic sender) — Jay's call: do last, if at all. Meta approval takes weeks — start the application that far ahead of wanting it live.

## Appendix — Feature-gap reference (why these phases exist)
Tier 1 (sellability core): applicability engine + calendar-generated statutory tasks; filing-status grid; client billing/receivables; credentials vault; DSC register; notice tracker; WhatsApp-first automated reminders. Tier 2: UDIN register; FY-wise docs + permanent file; filing outcomes; portal document checklists; client groups; timesheets; challan register. Tier 3 (moat): GSP/ERI sync; Tally import; engagement letters/NOC/working papers. Core flaw fixed by Ph9–10: completion-chained recurrence means a stalled month never spawns the next statutory task.
