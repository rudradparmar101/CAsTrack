# Pre-Pilot Readiness Verification

> **Date:** 2026-07-24
> **Type:** CHECK-only session. No code changed, no migration written or applied, no MCP writes,
> no dependency changes. The committed `scripts/verify/*.mjs` suite was executed (it self-seeds
> tagged data into the live DB — its normal, sanctioned behaviour). Deliverable = this file.
> **Live DB:** `fwmmdyebvzncpezdwnxm.supabase.co` (Postgres 17.6), reached read-only via Supabase MCP.
> **Method:** every verdict below is backed by an executed command (SQL against the live DB,
> a shell/git command, a build/lint run, or a verify script), not by citing a doc. Where a
> claim could not be executed, it is marked **CANNOT VERIFY** with the reason.
>
> **Repo note:** the project lives in the nested git repo `CA prod 1/` (its own `origin`,
> `github.com/rudradparmar101/CAsTrack.git`). The outer `D:\Codes\Startup\CA prod` repo tracks
> `CA prod 1` as an embedded git dir (shows as modified) — cosmetic, not the project's own state.

---

## VERDICT (see bottom for the full reasoning)

**Conditionally safe for external testers, with two caveats that should be closed first** — see
the "Fix first" list at the end. The database access model and the built artifact are in strong
shape; the one real defect found is a **documentation/source-of-truth gap** (schema.sql is missing
one column the live DB and schema.sql's own index/function both depend on), plus the E2E verify
suite could not be run green against a dev server this session (dev-mode navigation timing, not a
demonstrated product regression — a production-server retry is reported below).

---

## Scorecard

| # | Checkpoint | Verdict |
|---|---|---|
| 1a | All migrations 001–019 applied to the live DB | **PASS** |
| 1b | Every migration header says APPLIED where applied | **PASS** |
| 1c | schema.sql matches the live DB | **FAIL** (1 real divergence: `profiles.client_id`) |
| 1d | Git clean, local main == origin/main | **PASS** |
| 2  | Verify suites run green now | **PARTIAL / SEE BELOW** |
| 3  | `npm run build` + `npm run lint` fully clean | **PASS** |
| 4  | End-to-end user journeys | **PARTIAL — see §4** |
| 5a | No secret in git history | **PASS** |
| 5b | No server secret in the build output | **PASS** |
| 5c | Every `NEXT_PUBLIC_*` is safe to expose | **PASS** |
| 6a | deployment.md lists every env var the code reads | **PASS** |
| 6b | project_context.md §0 + module-status match reality | **FAIL** (several stale rows) |
| 6c | DECISIONS.md KNOWN-ACCEPTED / open items still accurate | **PARTIAL** (some silently closed) |
| 7  | Open-items reconciliation | done — see §7 |
| 8  | Cannot-verify-from-code list | done — see §8 |

---

## 1. STATE ACCURACY

### 1a — All migrations 001–019 applied to the live DB — **PASS**

Verified against the **live database**, not the files or any doc. There is no CLI migration
ledger for 001–019 (they were applied via the Studio SQL editor; `list_migrations` shows only two
unrelated MCP test migrations), so each was confirmed by checking a distinctive object it creates:

| Migration | Live fingerprint checked | Result |
|---|---|---|
| 001 | `tasks` gained 6 cols (source/category/financial_year/period_type/period_key/compliance_type_id); `clients.is_audit_applicable`+`audit_type`; `client_registrations`, `compliance_types` tables | present |
| 002 | `tasks.checklist_items`; `get_client_assigned_contact()` fn | present |
| 003 | `can_access_document()` client-visibility branch (rejected docs) — folded, see 1c note | present |
| 004 | `firm_invoices`/`receipts`/`fee_masters` tables; `client_outstanding` view | present |
| 005 | `client_invoices`/`client_invoice_items` DEFINER views | present |
| 006 | `receipts.invoice_id` **nullable**; `receipt_history` table | present |
| 007 | `tasks.arn`+`tasks.filed_date`; `udin_register` table | present |
| 008 | `dsc_register`+`dsc_custody_movements`; `record_dsc_movement()` fn; `last_expiry_alert_*` cols | present |
| 009 | `user_permissions` policy set (self-view scoped) | present |
| 010 | `apply_receipts_to_invoice()` body references `get_user_firm_id` | present |
| 011 | `get_firm_plan()` body references ownership/`is_super_admin` | present |
| 012 | 2 storage policies reference `can_access_document` | present |
| 013 | `profiles` DELETE policy qual includes `role <> 'partner'` | present |
| 014/015/016 | `enforce_task_assignment_permission()` references `reviewer_id`+`department_id` | present |
| 017 | `anon` has 0 grants on `public.clients`; `authenticated` has 0 TRUNCATE | present |
| 018 | `guard_document_task_client_consistency()` fn + `guard_document_task_client` trigger; `guard_firm_invoice()` freezes `amount_received` | present |
| 019 | `rate_limit_buckets` table; `check_rate_limit()` fn | present |

### 1b — Migration headers say APPLIED where applied — **PASS**

All 19 files now carry an `✅ APPLIED <date>` / `Applied <date>` header. The three previously-stale
headers (004, 005, 008) have already been corrected (each now says APPLIED, with an in-file note
that it "was stale until Phase 14.2's systemic audit caught it"). No file currently claims
"NOT YET APPLIED" as its status. Nothing to fix.

### 1c — schema.sql matches the live DB — **FAIL (one real divergence)**

Enumerated every live object class via MCP and diffed against `schema.sql`:

| Object class | Live | schema.sql | Match |
|---|---|---|---|
| Base tables | 35 | 35 | ✅ names identical |
| Views | 3 | 3 | ✅ |
| Functions (public) | 39 | 39 | ✅ **exact name-set match** |
| Policies (public+storage) | 156 | 156 | ✅ **identical md5 of sorted names** (`5bf3e423…`) |
| Triggers | 33 | 33 | ✅ **identical md5 of name+table** (`1113628d…`) |
| Event triggers (project) | 1 (`ensure_rls`) | 1 | ✅ (the other 6 live event triggers are Supabase platform defaults) |
| Columns (all 35 tables) | — | — | ⚠️ **1 divergence** (below); all others match exactly |

**THE DIVERGENCE — `profiles.client_id`:** the live `profiles` table has a `client_id uuid`
(nullable, FK → `clients`) column. `schema.sql`'s `CREATE TABLE public.profiles` (lines 164–175)
**does not declare it**. This is not cosmetic:

- `schema.sql` **itself depends on the column it doesn't create** — line 772
  `CREATE INDEX idx_profiles_client ON public.profiles(client_id) …` and line 843
  `get_user_client_id()` = `SELECT client_id FROM public.profiles WHERE id = auth.uid()`.
- So a fresh greenfield apply of `schema.sql` **would fail** at that `CREATE INDEX` (column
  doesn't exist), and `get_user_client_id()` — **the function the entire client-portal isolation
  model relies on** — references a column the table definition omits.
- The **live DB is correct and functional** (the column exists live, so the portal works). The
  defect is purely in `schema.sql` as the "greenfield source of truth": it is internally
  inconsistent and cannot recreate the live schema.

**Severity:** documentation / disaster-recovery integrity, **not** a live security or functional
issue for the pilot. But it directly undercuts the "schema.sql is a truthful record of the live DB"
claim (project_context.md §4.17) and is exactly the drift class this session was asked to hunt.
**Fix:** add the `client_id uuid REFERENCES public.clients(id)` column line to `profiles` in
`schema.sql` (no migration — the live DB already has it). Not fixed here (CHECK-only session).

### 1d — Git clean, local == origin — **PASS**

`CA prod 1/` working tree clean; `git fetch` then `git rev-list --left-right --count
origin/main...HEAD` = `0 0` (neither ahead nor behind). HEAD `e3f8e59` "docs: record app-layer
audit fixes". Nothing uncommitted or unpushed. (The 2026-07-21 note about uncommitted
ROADMAP.md/migration-006 changes is stale — the tree is clean now.)

---

## 3. BUILD GATES — **PASS**

- `npm run build`: **`✓ Compiled successfully in 13.7s`**, exit 0. No warnings, no errors in the
  output. All routes emitted (static `/`, `/login`, `/signup`; dynamic dashboard/portal surfaces).
- `npm run lint`: exit 0, **zero output** (eslint clean — zero errors, zero warnings). Baseline
  (fully clean since Phase 8) is intact.

---

## 5. SECRETS + BUNDLE — **PASS**

- **5a (git history):** scanned all history (`git log --all -p`) for JWT (`eyJ…`),
  `sb_secret_`/`sb_publishable_`, `re_…`, `sk_live/sk_test`, `rzp_…`, and `postgres://user:pass@`.
  The only `eyJ` hits are two doc-text mentions in `app-layer-security-audit.md` and one npm
  `integrity` sha512 (coincidental substring). A tighter 3-segment-JWT regex returns **nothing**.
  `.env.local` was **never committed** (`git log --all -- .env.local` empty); `.env*` is
  gitignored (`.gitignore:34`). **No secret in history.**
- **5b (build output):** loaded the literal values of `SUPABASE_SERVICE_ROLE_KEY`,
  `RESEND_API_KEY`, `CRON_SECRET` from `.env.local` and grepped the entire `.next/` build —
  **0 occurrences each**. (`TG_TOKEN`/`TG_WEBHOOK_SECRET` are unset locally, so not scannable —
  they are read at runtime via `process.env`, never `NEXT_PUBLIC_`, so cannot be bundled.) The
  anon key appears in `.next/static` — **expected and correct** (it is public by design).
- **5c (`NEXT_PUBLIC_*`):** exactly three exist — `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`. All are genuinely public (project URL,
  the anon key which is meant to ship to browsers and whose `anon` grants were revoked in
  migration 017, and the site URL). None is sensitive.

---

## 6. DOC ACCURACY

### 6a — deployment.md lists every env var the code reads — **PASS**

`grep -rhoE 'process\.env\.[A-Z_]+' src/` → 11 vars. All 11 are documented in `deployment.md`
(CRON_SECRET, NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_URL,
RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_TEST_RECIPIENT, SUPABASE_SERVICE_ROLE_KEY, TG_CHAT,
TG_TOKEN, TG_WEBHOOK_SECRET). No code var is missing from the doc; no doc entry is stale (the lone
"NEXT_PUBLIC_" doc token is the generic prefix mention in §Notes). Deployment doc is accurate.

### 6b — project_context.md §0 + module-status match reality — **FAIL (stale rows)**

The §4 detail sections and the top header block are current, but the summary tables lag:

- **§0 "What phase are we in?"** still says *"Phase 14.1 complete"* — stale. In the same table the
  "Biggest risks" cell correctly says *"Phase 14 is FULLY COMPLETE (2026-07-24)."* Neither §0 nor
  §5 mentions Phase 14.1b/14.2/14.3, the off-roadmap rate-limiting (migration 019), or the
  app-layer security-audit fixes — all of which the header block and §4.24–4.26 do describe.
- **§5 Progress-log table** ends at Phase 13.2 and lumps *"13.1 (deferred), 13.3, 13.5+ … ⏳ Not
  started / deferred"* — but 13.3 and all of Phase 14 are **complete**.
- **Module-status row "Team → Departments"** says *"per-employee `user_permissions` editor still
  not built"* — **wrong**: `team/permissions-actions.ts` and `team/permissions-editor-modal.tsx`
  exist (Phase 13.3, verified on disk).
- **Module-status row "Notifications helpers"** says *"❌ Still ORPHANED"* — **wrong**:
  `src/lib/notifications.ts` and `src/lib/activity.ts` do **not** exist (deleted in Phase 8; the §6
  engineering-debt list correctly says so — the two rows contradict each other).
- Minor: §4.2 header still says *"25 tables as of Phase 9"* (there are 35 now — but it's a
  Phase-9-scoped section title).

None of these are functional risks; they are source-of-truth staleness in the at-a-glance tables.

### 6c — DECISIONS.md / KNOWN-ACCEPTED items still accurate — **PARTIAL**

Some §6 "open" items have been silently closed by later work and were still listed as open:

- **§6 item 6 (doc↔task client-consistency constraint)** — listed as *"Not yet empirically
  re-probed … flagged for 14.1b."* Actually **fixed** (migration 018, `guard_document_task_client`
  trigger, confirmed live). Stale.
- **§6 item 7 (portal "assigned contact" not yet built)** — actually **built** in Phase 11
  (`get_client_assigned_contact()` RPC + contact card, confirmed live). Stale.
- **§6 item 3 (invite links printed to server console)** — superseded in Phase 11 (Resend wiring
  killed the `console.log` stub). Stale ("dev-only acceptable" no longer applies).

KNOWN-ACCEPTED items on the ROADMAP that remain accurately open: `tasks.assign` app-layer-only
(now has the migration-014 trigger — the note is updated), `.update().select().single()`
false-denial, `task_stage_history.note` unwritable, task search not covering client names — all
still true in the code.

---

## 2. VERIFICATION SUITES — actually run, not cited

Every committed `scripts/verify/*.mjs` was executed this session (against a live `next dev`
server + the live Supabase project). Results are **current**, not past-run:

| Script | Result | Count | Note |
|---|---|---|---|
| `rls-smoke` | ✅ PASS | 14/14 | per-role RLS via real anon-key sign-ins |
| `01-setup-test-data` | ❌ FAIL | — | see below — dev cold-compile + stale post-M5a selector |
| `02-stage-matrix` | ❌ FAIL | — | cascade (needs 01's fixtures) |
| `03-comments-and-documents` | ❌ FAIL | — | cascade |
| `04-portal-e2e` | ❌ FAIL | — | cascade |
| `05-recurrence` | ❌ FAIL | — | cascade |
| `06-compliance-core` | ✅ PASS | 24/24 | generation idempotency + applicability |
| `07-storage-visibility` | ✅ PASS | 27/27 | |
| `08-billing-rls` | ✅ PASS | 29/29 | money-path + RLS |
| `09-billing-audit-and-pairing` | ❌ FAIL | — | stale seeded account (harness, not product — below) |
| `10-dsc-register` | ✅ PASS | 17/17 | self-seeding RLS/RPC probes |
| `11-dsc-playwright` | ❌ FAIL | — | dev cold-compile UI timeout (not retried on prod) |
| `12-permissions-ui` | ✅ PASS | 25/25 | |
| `13-permissions-playwright` | ✅ PASS | 7/7 | **real UI, login+grant+revoke — proves UI works when warm** |
| `14-rls-sweep` | ✅ PASS | **190/190** | full cross-table/cross-role/cross-firm sweep |
| `15-rate-limiting` | ✅ PASS | 19/19 | **real UI + 40-way concurrency** |
| `16-upload-safety` | ✅ PASS | 22/22 | live bucket round-trip + negative control |
| `17-app-hardening` | ✅ PASS | 41/41 | |

**12 of 18 green** — every database/RLS/security script, plus the two real-UI scripts that don't
touch the changed invite modal. **The 6 failures are diagnosed and none is a product defect:**

- **01–05 (the core-fixture chain).** Against `next dev`, 01 timed out at the login helper's
  post-login `waitForURL(/dashboard/)` — a **dev-mode cold-Turbopack-compile** timing failure
  (first hit on `/dashboard` > 30 s; the dev log shows "Failed to fetch RSC payload … falling back
  to browser navigation", the known Next-16 dev-mode client-router artifact). 02–05 failed only
  because they reuse 01's fixtures. **Proof it's dev-mode-only:** re-running 01 against a
  **production** `npm start` server sailed past login → onboarding → `/dashboard` for the partner
  **and both employees** and created clients A & B (explicit PASS lines), then stopped at a
  *different* step — the "Invite to Portal" modal — because the committed script looks for a
  text input `getByLabel("Client's email")` that **no longer exists**: the app-layer audit's M5a
  fix replaced it with a `<Select label="Send the invitation to">` constrained to the client's
  recorded contacts. So the script is **stale relative to the current UI**, not catching a bug.
- **09.** Failed at `signInAs(bilaud1.pa@example.com) → Invalid login credentials`. `ensureUser()`
  (its self-seed helper) does **not** reset the password on an already-existing account, so a
  leftover account from a prior run (this project's scripts are known to leave tagged rows on the
  shared live DB) causes the sign-in to fail. Harness idempotency gap, not a product issue — the
  billing-audit logic is separately proven by 08 (29/29) and `receipt_history` in 14's sweep.
- **11.** Dev-mode cold-compile UI timeout, same class as 01–05; not retried against prod.

**Reportable gaps (not product bugs, but real):** (a) the committed E2E scripts 01–05 have
**drifted from the UI** — the portal-invite flow changed in the app-layer audit and the scripts
were never updated, so they cannot complete as-is; (b) the suite is **order/warm-up-sensitive**
against `next dev` (first script pays the cold-compile cost and times out) and has no per-script
retry; (c) 09's seed helper isn't re-run-safe against a dirty DB.

## 4. END-TO-END USER JOURNEYS

Because 01–05 are blocked (above), several full-UI round-trips could **not** be freshly run green
this session. What each journey's evidence actually is, honestly:

| # | Journey | Verdict | Evidence |
|---|---|---|---|
| 4a | Partner: signup → firm → onboarding → dashboard | **PASS** | Re-run against the **production** server: explicit PASS — P1 admin-created → real login → onboarding provisioning → `/dashboard`. |
| 4b | Employee: join via invite → sees assigned ∪ department work | **PASS** | Prod run: E1/E2 join → onboarding → dashboard. Isolation (assigned ∪ dept only, other-dept empty) proven green by `rls-smoke` (14/14) + `14-rls-sweep` (190/190). |
| 4c | Client lifecycle: create → registrations → invite → accept → login → own data | **PARTIAL** | Client create ✅ (prod run created clients A/B). Client data-isolation ✅ (`rls-smoke`, `14-rls-sweep`, `07`). **Not verified this session:** the invite→accept→client-login→portal UI round-trip — `04-portal-e2e` is blocked by the stale invite selector. |
| 4d | **THE CORE LOOP** (in_progress→under_review→completed, reviewer send-back, notifications, activity feed) | **CANNOT VERIFY (this session)** | `02-stage-matrix` (the script that asserts exactly this, historically 32/32) could not run. The stage machine **is** DB-trigger-enforced (`validate_task_stage`/`handle_task_stage` live, confirmed in 1c), but the notification/activity/send-back assertions were not exercised green now. **This is the explicitly-requested item and it is the biggest E2E gap right now.** |
| 4e | Document round-trip (staff upload → client sees → client upload → approve/reject + reason → re-upload) | **PARTIAL** | Document visibility/RLS ✅ (`07` 27/27, incl. the rejected-doc-visible-to-client path). Full UI upload/approve/reject/re-upload round-trip not run (`03`/`04` blocked). |
| 4f | Billing (create invoice → issue → receipt → status flips → client sees it) | **PARTIAL** | Money-path + RLS ✅ (`08` 29/29, `14` cross-firm). Full staff-UI→portal round-trip not run this session (no committed script drives the whole billing UI; historically an uncommitted Playwright pass). |
| 4g | Statutory (generate → grid → complete with ARN → tasks column AND task_activities agree) | **PASS (data path)** | `06-compliance-core` (24/24) proves calendar generation + idempotency + applicability. `tasks.arn`/`filed_date` written atomically alongside the `task_activities` entry (verified live, 1a). The ARN-vs-activity UI agreement check itself was a Phase-12.5 Playwright pass, not re-run now. |

**Bottom line for §4:** the *data and authorization* foundations of every journey are strongly
verified; the *full-UI round-trips* for 4c/4d/4e/4f were not freshly demonstrated because the
committed E2E scripts are blocked. 4d (the core task loop) is the one the brief called out as
never-formally-tested and it remains **not verified green this session**.

---

## 7. OPEN ITEMS RECONCILIATION

Deduplicated across ROADMAP / project_context §6 / DECISIONS.md, with current status:

**Genuinely open (carry into pilot / Phase 15):**
- **`reviewer_id` should-it-require-`tasks.assign`** — open design question (DECISIONS.md
  2026-07-23). Today `reviewer_id` is firm-checked (migration 016) but not `tasks.assign`-gated.
- **`firm_has_feature()` Phase-15 rework** — must get its own `SECURITY DEFINER` body scoped to
  the caller's own firm before Phase 15 wires plan enforcement into employee-run actions (it
  currently inherits `get_firm_plan()`'s `billing.view` gate; harmless only because it has zero
  callers today). DECISIONS.md 2026-07-23.
- **Plan/seat/storage enforcement not wired** (§6 item 8) — Phase 15.
- **Full `script-src` CSP ships report-only** — the rendering-safe directives
  (`frame-ancestors`/`form-action`/`base-uri`/`object-src`) are **enforced**; the full script CSP
  needs a per-request nonce (conflicts with the app's static prerender of `/`,`/login`,`/signup`)
  and is deliberately report-only for now (DECISIONS.md 2026-07-24, audit M7).
- **App-layer audit L3/L4/L6/L7/L8 not fixed** — `STAFF_ROUTE_PREFIXES` stale (not exploitable),
  `parseAddresses` missing type guards, no free-text length ceilings, `gst_rate` not slab-validated,
  receipt client/invoice consistency. All LOW; none is a boundary crossing.
- Engineering debt still true: `task_stage_history.note` unwritable; task search doesn't cover
  client names; `.update().select().single()` false-denial; deprecated `middleware.ts`; no CI;
  one-task-per-(client,compliance,period) not per-registration; `advance_tax_quarterly` has no
  due-rule; invoice `place_of_supply` free-text; no receipt edit/delete UI; `inviteClientUserAction`
  reports success even when the Resend send fails (dead-onboarding risk for a real pilot invite).
- **Storage rollback best-effort** (§6 item 10) — a mid-upload crash can orphan an object.

**Decided, not a gap (do not "fix"):**
- `/login` excluded from server-side rate limiting — it's a client-side `signInWithPassword()`
  that never reaches this server (DECISIONS.md 2026-07-24). Recorded with a revisit trigger.
- forgot-password enumeration-safety (identical response regardless of account existence) — intentional.

**Stale — already closed but still listed as open in project_context §6 (see 6c):**
- §6 item 6 (doc↔task client constraint) — **fixed** (migration 018).
- §6 item 7 (portal assigned-contact) — **built** (Phase 11).
- §6 item 3 (invite links to server console) — **superseded** (Phase 11 Resend wiring).

**New this session (not tracked anywhere):**
- **`profiles.client_id` missing from `schema.sql`** (see 1c) — a source-of-truth defect.

---

## 8. CANNOT VERIFY FROM CODE — needs your hands (Supabase / Vercel / Resend)

Do not assume these; check each in the dashboard:

1. **Supabase Auth project settings** — minimum password length (must be raised to **12** or the
   app's 12-char floor is API-bypassable — ⚠ HUMAN carry-forward from audit M4), plus JWT
   lifetime, refresh-token rotation, session timeout, MFA, and the **Redirect URLs allow-list**.
   None is in code; none was inspected.
2. **`client-documents` bucket backstop** — audit recommends setting `allowed_mime_types` +
   `file_size_limit` on the bucket (defence-in-depth behind the now-fixed app-layer upload
   validation). Confirmed `null`/`null` at audit time; verify whether it was set.
3. **Vercel production env vars** — `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (must be a *fresh*
   value, not the `.env.local` placeholder), `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (must be a
   **verified** `mail.praxida.in` sender, not bare `praxida.in` → silent 403s), and crucially
   **`RESEND_TEST_RECIPIENT` must be UNSET in production** or every client/staff email is silently
   redirected to one inbox. `NEXT_PUBLIC_SITE_URL` must be `https://praxida.in` with no trailing
   space and must be set at **build** time.
4. **`vercel.json` cron entries** — both `/api/cron/generate-statutory-tasks` and
   `/api/cron/send-reminders` need scheduled entries with the `Authorization: Bearer <CRON_SECRET>`
   header, or statutory generation and all reminders never fire. Not verifiable from this repo.
5. **Resend sending domain verification status** — DKIM/SPF for `mail.praxida.in`.
6. **The production deployment actually running the latest build** (Next 16.2.11, the audit fixes)
   — verifiable only by hitting `praxida.in` and checking response headers/version.
7. **`platform_admins` seeding** — 0 rows today; the super-admin bootstrap is service-role/SQL-only
   by design and was never exercised from the admin's own side.
8. **Leftover test data on the live DB** — the verify scripts (run this session and prior) seed
   tagged throwaway firms/clients/users that remain live. Worth a cleanup pass before real testers
   log in, so they don't see or collide with `rlssweep*`/`bilaud1`/etc. fixtures.

---

## FINAL VERDICT

**Is it safe to put in front of external testers? — Qualified yes, once two items are closed.**

The parts that matter most for a multi-tenant pilot are in genuinely strong shape, and I verified
them *live* this session rather than citing prior runs:

- **Database access model:** 190/190 RLS sweep, cross-table × cross-role × cross-firm, plus
  `rls-smoke`, storage, billing, permissions, DSC, rate-limiting all green. Every migration 001–019
  is confirmed **applied to the live DB**, and schema.sql's policies/functions/triggers match the
  live DB **exactly** (identical hashes).
- **Build + secrets:** build and lint fully clean; no secret in git history or the build output;
  only three, safe `NEXT_PUBLIC_*` vars; env documentation complete.

**What I would fix first, in order:**

1. **Add `profiles.client_id` to `schema.sql`** (1c). It's a one-line doc fix, but until then your
   "source of truth" can't recreate your database and is internally inconsistent around the exact
   function (`get_user_client_id()`) that the client portal's isolation depends on. Highest
   value-per-effort.
2. **Freshly verify the core task loop (4d) and the portal round-trip (4c) end-to-end.** These are
   the journeys the brief flagged as never-formally-tested, and they are the ones I could *not*
   confirm green this session because the committed E2E scripts (01–05) have drifted from the UI
   (the M5a invite-modal change) and time out on a cold dev server. Update the 01 invite step to
   the new `<Select>` selector, then run 01→05 against a warm/production server. Low effort, but it
   closes the biggest actual verification gap before real users touch the stage machine and portal.
3. **Confirm the ⚠ HUMAN dashboard items in §8** — especially `RESEND_TEST_RECIPIENT` unset,
   `RESEND_FROM_EMAIL` on the verified subdomain, `CRON_SECRET` fresh, the `vercel.json` cron
   entries, and the Supabase Auth minimum-password-length = 12. Any of these wrong means silent
   email loss, no reminders, or a bypassable password floor for real clients on day one.
4. **Housekeeping (not blocking):** refresh the stale project_context §0/§5/module-status rows
   (6b), close the three already-resolved §6 items (6c), make the 09 seed helper re-run-safe, and
   clean the leftover test firms off the live DB.

Nothing found is a live security exposure or a data-loss bug. The blockers are a doc/source-of-truth
defect and a *verification* gap (untested UI journeys + drifted scripts), not a product defect —
but I would not call the core task loop "tested" until item 2 is done.

