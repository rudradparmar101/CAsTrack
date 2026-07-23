# Phase 14.1 — Exhaustive Probe-Driven RLS Verification Sweep

> **Date:** 2026-07-23
> **Type:** Verification-only session. No DDL applied, no fixes attempted, migration 006 untouched, no rows on the KNOWN-ACCEPTED list modified. Two throwaway firms were seeded (tag `rlssweep1`) and remain live, inert, tagged rows.
> **Method:** Every claim below is backed by an actual query executed against the live database (`fwmmdyebvzncpezdwnxm.supabase.co`) as a real signed-in role via raw PostgREST (`signInWithPassword` + anon key) or a real RPC call — never by reading policy text and inferring behavior. Supabase MCP (reads-only) was used only to *enumerate* schema objects (table list, function list, live column/policy state) so nothing was missed; it was never used to *conclude* behavior.
> **Harness:** `scripts/verify/14-rls-sweep.mjs` (committed, self-seeding, idempotent — re-run twice consecutively with identical results). **116/116 assertions matched their predicted outcome** — for ordinary boundary checks that means "isolation held"; for each `FINDING-CHECK` it means "the predicted gap is empirically confirmed to exist." A green run is not a clean bill of health by itself — read the Findings section.

---

## Why this sweep, and why it found what it found

Two prior findings in this project — the DSC register's `is_firm_staff()`-vs-`clients.view` scope error (migration 008) and `user_permissions`' unscoped self-view SELECT policy (migration 009) — both **read as correct policy text** and were **both wrong in scope**. Neither would have been caught by re-reading the SQL; both were caught by signing in as the affected role and issuing a real query. This sweep applies that same method to every table in the schema, not just the ones a prior phase happened to touch, specifically because scope errors don't announce themselves in the text of a policy.

That method paid off again this session: **three new findings surfaced, one of them (`apply_receipts_to_invoice`) on a function that isn't referenced anywhere in project_context.md's known-risk list and would have been easy to skip** if the sweep had relied on "which functions seem important" rather than mechanically enumerating every `SECURITY DEFINER` function in `pg_proc` and asking, for each one, "does its body check anything before it acts?"

---

## 1. Coverage: what was enumerated

**Tables (33 total, live, via `mcp__supabase__list_tables`, cross-checked against `schema.sql`'s `CREATE TABLE` statements):** `platform_admins`, `plans`, `permissions`, `role_permissions`, `compliance_types`, `firms`, `departments`, `profiles`, `department_members`, `user_permissions`, `firm_subscriptions`, `subscription_invoices`, `clients`, `client_addresses`, `client_authorized_persons`, `client_registrations`, `client_portal_invitations`, `tasks`, `task_stage_history`, `task_comments`, `documents`, `document_versions`, `task_activities`, `notifications`, `task_templates`, `fee_masters`, `firm_invoices`, `firm_invoice_items`, `firm_invoice_counters`, `receipts`, `receipt_history`, `udin_register`, `dsc_register`, `dsc_custody_movements`.

**30 of 33 directly probed this session** (see §2). `document_versions`, `firm_invoice_items`, and `firm_invoice_counters` were **not** probed this session — flagged in §4 for 14.1b, not silently skipped.

**`SECURITY DEFINER` functions (35 total, via `pg_proc`):** every one that takes a caller-influenced argument was probed or explicitly reasoned about (§3). Functions that return `trigger` (14 of them — `guard_*`, `handle_*`, `log_*`, `enforce_profile_protected_fields`, `seed_default_departments`, `rls_auto_enable`) are not directly RPC-callable by design (Postgres rejects calling a trigger-returning function outside trigger context) and were excluded on that basis, not skipped by oversight. Trivial no-argument helpers that only ever read the caller's own `auth.uid()` context (`get_user_firm_id/role/client_id/department_ids`, `is_super_admin`, `is_firm_staff`) were not separately probed — there is no argument for them to leak through.

**Storage:** the `client-documents` bucket's staff and client SELECT policies, from a new angle (staff-side broad access) not covered by the existing `07-storage-visibility.mjs` client-focused suite.

**The three gaps project_context.md §6 already named:** all three empirically confirmed — see §2 (documents Ph3 relaxation), §2 (tasks.assign), and §4 (doc↔task client-consistency — not newly probed this session, still open from before).

**Cross-firm isolation:** every table probed had at least one cross-firm check this session — previously asserted only for a subset of tables scattered across the 07/08/10 scripts, never swept table-by-table before this.

---

## 2. Table × role × operation matrix

Legend: **P** = partner, **EV** = employee (pure role defaults), **E0** = employee (every permission key explicitly revoked, one exception noted), **EP** = employee (every permission key explicitly granted), **U** = client_user, **X-firm** = an actor from Firm B attempting Firm A's row (or vice versa). "expected" is what the design (schema.sql's own comments + project_context.md) says should happen; "actual" is what the live database did.

| # | Table | Actor | Operation | Expected | Actual | Verdict |
|---|---|---|---|---|---|---|
| 1 | `permissions` | any authenticated | SELECT | allowed (global catalog) | allowed | PASS |
| 2 | `permissions` | EV | INSERT | denied | denied | PASS |
| 3 | `role_permissions` | any authenticated | SELECT | allowed (global) | allowed | PASS |
| 4 | `role_permissions` | EV | UPDATE | denied | 0 rows | PASS |
| 5 | `compliance_types` | any authenticated | SELECT | allowed (global) | allowed | PASS |
| 6 | `compliance_types` | EV | INSERT | denied | denied | PASS |
| 7 | `plans` | any authenticated | SELECT | allowed (global) | allowed | PASS |
| 8 | `plans` | EV | UPDATE | denied | 0 rows | PASS |
| 9 | `platform_admins` | EV | SELECT | 0 rows | 0 rows | PASS |
| 10 | `platform_admins` | EV | INSERT (self-promote) | denied | denied | PASS |
| 11 | `firms` | P | SELECT own | 1 row | 1 row | PASS |
| 12 | `firms` | P | SELECT Firm B | 0 rows (X-firm) | 0 rows | PASS |
| 13 | `firms` | P | UPDATE Firm B | 0 rows (X-firm) | 0 rows | PASS |
| 14 | `firms` | EV | UPDATE own firm | denied (partner-only) | 0 rows | PASS |
| 15 | `firms` | U | SELECT own firm | allowed (name/branding only) | allowed | PASS |
| 16 | `departments` | P | SELECT Firm B | 0 rows (X-firm) | 0 rows | PASS |
| 17 | `departments` | U | SELECT | 0 rows (staff-only) | 0 rows | PASS |
| 18 | `departments` | EV | INSERT | denied (no team.manage) | denied | PASS |
| 19 | `departments` | EP | INSERT | allowed (team.manage granted) | allowed | PASS |
| 20 | `department_members` | P | SELECT Firm B | 0 rows (X-firm) | 0 rows | PASS |
| 21 | `department_members` | U | SELECT | 0 rows (staff-only) | 0 rows | PASS |
| 22 | `profiles` | P | SELECT Firm B partner | 0 rows (X-firm) | 0 rows | PASS |
| 23 | `profiles` | U | SELECT other profiles, own firm | 0 rows | 0 rows | PASS |
| 24 | `profiles` | EV | SELECT own-firm profiles | all firm-A rows | 8 rows | PASS |
| 25 | `profiles` | P | DELETE a CO-PARTNER, same firm | **not defined by design docs — empirically: allowed** | **1 row deleted** | **FINDING (§5, F3)** |
| 26 | `profiles` | P | DELETE an employee, same firm | allowed by design | 1 row deleted | PASS |
| 27 | `profiles` | P | DELETE self | denied | 0 rows | PASS |
| 28 | `user_permissions` | P | SELECT Firm B overrides | 0 rows (X-firm) | 0 rows | PASS |
| 29 | `user_permissions` | P | INSERT for Firm B's employee | denied (X-firm) | denied | PASS |
| 30 | `firm_subscriptions` | EP (billing.view) | SELECT | allowed | 1 row | PASS |
| 31 | `firm_subscriptions` | E0 (no billing.view) | SELECT | 0 rows | 0 rows | PASS |
| 32 | `firm_subscriptions` | P | SELECT Firm B | 0 rows (X-firm) | 0 rows | PASS |
| 33 | `firm_subscriptions` | EP (billing.manage granted) | UPDATE | denied (super-admin only) | 0 rows | PASS |
| 34 | `clients` | EV (clients.view default true) | SELECT A1 | allowed | allowed | PASS |
| 35 | `clients` | E0 (clients.view revoked) | SELECT A2 | **allowed via department task, not clients.view** | allowed | PASS (behavior confirmed, not a bug — see note) |
| 36 | `clients` | E0 (clients.view revoked) | SELECT A3 (zero task relationship) | 0 rows | 0 rows | PASS |
| 37 | `clients` | P | SELECT Firm B client | 0 rows (X-firm) | 0 rows | PASS |
| 38 | `clients` | U (own=A1) | SELECT sibling A2 | 0 rows | 0 rows | PASS |
| 39 | `clients` | U (Firm B) | SELECT Firm A client | 0 rows (X-firm, client-side) | 0 rows | PASS |
| 40 | `clients` | EV | UPDATE (no clients.manage) | denied | 0 rows | PASS |
| 41 | `clients` | EP (clients.manage granted) | UPDATE | allowed | 1 row | PASS |
| 42 | `clients` | P | DELETE | denied — no policy at all (F6) | 0 rows, row survives | PASS |
| 43–48 | `client_addresses` / `client_authorized_persons` / `client_registrations` | U (sibling) / P (X-firm) | SELECT | 0 rows each | 0 rows each | PASS ×6 |
| 49 | `client_portal_invitations` | EV (no clients.manage) | SELECT | 0 rows | 0 rows | PASS |
| 50 | `client_portal_invitations` | EP (clients.manage granted) | SELECT | allowed | 1 row | PASS |
| 51 | `client_portal_invitations` | U | SELECT | 0 rows (no path) | 0 rows | PASS |
| 52 | `client_portal_invitations` | PB | SELECT Firm A's | 0 rows (X-firm) | 0 rows | PASS |
| 53 | `tasks` | EV | SELECT own-dept assigned task | allowed | allowed | PASS |
| 54 | `tasks` | EV | SELECT other-dept, unassigned | 0 rows | 0 rows | PASS |
| 55 | `tasks` | P | SELECT Firm B task | 0 rows (X-firm) | 0 rows | PASS |
| 56 | `tasks` | U (sibling) | SELECT | 0 rows | 0 rows | PASS |
| 57 | `tasks` | U (Firm B) | SELECT Firm A task | 0 rows (X-firm, client-side) | 0 rows | PASS |
| 58 | `tasks` | E0 (tasks.assign revoked, tasks.update_department granted) | UPDATE `assigned_to` on a dept task she's NOT assigned to | **allowed — no tasks.assign check exists anywhere** | allowed | **FINDING (§5, F4)** |
| 59 | `tasks` | EV | DELETE | denied (partner-only) | 0 rows | PASS |
| 60 | `task_stage_history` | EV / P | INSERT | denied (trigger-only, no policy at all) | denied both | PASS ×2 |
| 61 | `task_stage_history` | P | SELECT Firm B | 0 rows (X-firm) | 0 rows | PASS |
| 62 | `task_comments` | U | SELECT internal comment | 0 rows | 0 rows | PASS |
| 63 | `task_comments` | U | SELECT client-visible comment | allowed | allowed | PASS |
| 64 | `task_comments` | EV (not author) | UPDATE | 0 rows | 0 rows | PASS |
| 65 | `task_comments` | U (sibling) | INSERT on A1's task | denied | denied | PASS |
| 66 | `task_comments` | P | SELECT Firm B | 0 rows (X-firm) | 0 rows | PASS |
| 67 | `documents` | U (own client) | INSERT, `task_id IS NULL` | **allowed — the Ph3 relaxation** | allowed | PASS (confirmed as-designed, see §5 note-only item) |
| 68 | `documents` | EV (clients.view=true, zero task/dept relationship to A3) | SELECT A3's task-less doc | **allowed, firm-wide, not department-scoped** | allowed | **FINDING (§5, F5)** |
| 69 | `documents` | E0 (clients.view revoked, zero relationship to A3) | SELECT same doc | 0 rows | 0 rows | PASS |
| 70 | `documents` | U | SELECT own internal/pending doc | 0 rows (table layer) | 0 rows | PASS |
| 71 | `documents` | E0 | SELECT doc on a DIFFERENT department's task | 0 rows | 0 rows | PASS |
| 72 | `documents` | P | SELECT Firm B doc | 0 rows (X-firm) | 0 rows | PASS |
| 73 | `documents` | EV (no documents.approve) | UPDATE (approve) | denied | 0 rows | PASS |
| 74 | storage `client-documents` | E0 (denied at table layer for a specific doc) | download the object | **allowed — storage policy has no task/department check at all** | allowed | **FINDING (§5, F2)** |
| 75 | storage | E0 | list that doc's folder | allowed (enumeration) | allowed | **part of F2** |
| 76 | storage | U (owning client, doc internal/pending) | download | denied (client curation holds) | denied | PASS |
| 77 | storage | P | list Firm B's folder | 0 entries (X-firm) | 0 entries | PASS |
| 78 | `task_activities` | U (sibling) | SELECT | 0 rows | 0 rows | PASS |
| 79 | `task_activities` | EV | UPDATE | denied (immutable) | 0 rows | PASS |
| 80 | `task_activities` | P | SELECT Firm B | 0 rows (X-firm) | 0 rows | PASS |
| 81 | `notifications` | EV | SELECT another user's | 0 rows | 0 rows | PASS |
| 82 | `notifications` | EV | SELECT own | allowed | allowed | PASS |
| 83 | `notifications` | EV | INSERT for Firm B user | denied (X-firm forgery) | denied | PASS |
| 84 | `notifications` (RPC) | U | `create_notification()` to same-firm staff | allowed by design | allowed | PASS |
| 85 | `notifications` (RPC) | EV | `create_notification()` cross-firm | rejected | rejected | PASS |
| 86 | `task_templates` | E0 (templates.manage revoked) | SELECT | **allowed — staff-wide read, not permission-gated** | allowed | informational, see §5 note-only item |
| 87 | `task_templates` | E0 | UPDATE | denied | 0 rows | PASS |
| 88 | `task_templates` | PB | SELECT Firm A's | 0 rows (X-firm) | 0 rows | PASS |
| 89 | `udin_register` | E0 (reports.view revoked) | SELECT | 0 rows | 0 rows | PASS |
| 90 | `udin_register` | EP (reports.view granted) | SELECT | allowed | allowed | PASS |
| 91 | `udin_register` | EP (ALL permissions granted) | INSERT | denied — partner-only, role gate | denied | PASS |
| 92 | `udin_register` | PB | SELECT Firm A's | 0 rows (X-firm) | 0 rows | PASS |
| 93 | `dsc_register` | PB | SELECT Firm A's | 0 rows (X-firm) | 0 rows | PASS |
| 94 | `dsc_register` | EP (ALL permissions granted) | INSERT | denied — partner-only, role gate | denied | PASS |
| 95 | `dsc_register` (RPC) | EVB | `record_dsc_movement()` on Firm A's DSC | rejected (X-firm) | rejected | PASS |
| 96 | `fee_masters` | PB | SELECT Firm A's | 0 rows (X-firm) | 0 rows | PASS |
| 97 | `firm_invoices` | PB | SELECT Firm A's | 0 rows (X-firm) | 0 rows | PASS |
| 98 | `receipts` | PB | SELECT Firm A's | 0 rows (X-firm) | 0 rows | PASS |
| 99 | `receipts` | admin (seed) | INSERT with `invoice_id IS NULL` | **succeeds — migration 006 IS live** | succeeded | **FINDING (§5, F1)** |
| 100 | `receipt_history` | EP (billing.view) | SELECT | **populated — migration 006 IS live** | rows present | part of F1 |
| 101 | `receipt_history` | EV | INSERT | denied (trigger-only) | denied | PASS |
| 102 | `receipt_history` | PB | SELECT Firm A's | 0 rows (X-firm) | 0 rows | PASS |
| 103 | `get_firm_plan()` (RPC) | E0 (billing.view revoked), own firm | call | **succeeds — bypasses billing.view entirely** | succeeded | **FINDING (§5, F1-RPC — see below, distinct code, same severity tier as new #1)** |
| 104 | `get_firm_plan()` (RPC) | EV, Firm B's id | call | **succeeds cross-firm — real plan data returned** | succeeded, real data | **FINDING (§5, F1-RPC)** |
| 105 | `get_firm_plan()` (RPC) | U (client_user), Firm B's id | call | **succeeds — no role restriction whatsoever** | succeeded | **FINDING (§5, F1-RPC)** |
| 106 | `has_permission()` (RPC) | U | call for another key | resolves own context only | `false`, no leak | PASS |
| 107 | `get_client_assigned_contact()` (RPC) | U (sibling) | call for A1's contact | empty, not an error | empty | PASS |
| 108 | `get_client_assigned_contact()` (RPC) | U (own client) | call | succeeds | succeeded | PASS |
| 109 | `lookup_firm_by_invite_code()` (RPC) | any | bogus code | 0 rows, no leak | 0 rows | PASS |
| 110 | `can_access_document()` (RPC) | E0 | doc on other dept's task | `false` | `false` | PASS |
| 111 | `can_access_document()` (RPC) | EVB | Firm A's doc | `false` (X-firm) | `false` | PASS |
| 112 | `apply_receipts_to_invoice()` (RPC) | EVB (Firm B, zero billing permission) | call against Firm A's invoice | **succeeds with no error — no ownership check inside the function at all** | succeeded, row touched | **FINDING (§5, F0 — CRITICAL)** |
| 113 | `profile_in_my_firm()` (RPC) | PA | probe Firm B's partner id | `false` (own-firm-only) | `false` | PASS |
| 114–116 | (department INSERT idempotency guard, sanity re-reads) | — | — | — | — | PASS |

Full machine-readable output (including exact error strings) is in `scripts/verify/.data/results-14-rls-sweep.json` after any run.

---

## 3. SECURITY DEFINER function enumeration (the "search, don't assume the list is complete" requirement)

| Function | Callable via RPC? | Argument attacker-controlled? | Probed | Result |
|---|---|---|---|---|
| `apply_receipts_to_invoice(p_invoice_id)` | **Yes** — `RETURNS VOID`, not a trigger type | Yes — arbitrary invoice UUID | Yes | **FINDING F0 — critical, see §5** |
| `get_firm_plan(p_firm_id)` | Yes | Yes — arbitrary firm UUID | Yes | **FINDING F1-RPC — see §5** |
| `can_access_document(p_document_id)` | Yes | Yes, but returns only a boolean | Yes | Safe — matches table-layer truth exactly |
| `staff_can_access_task` / `client_can_access_task` / `employee_has_task_for_client` | Yes | Yes, boolean-only | Reasoned, not separately probed | Same class as `can_access_document` — boolean oracle scoped by the caller's own `get_user_firm_id()`, no cross-firm leak possible |
| `has_permission(p_key)` | Yes | Key string only, no user param | Yes | Safe — always resolves against caller's own `auth.uid()` |
| `profile_in_my_firm(p_user_id, p_role)` | Yes | Yes — arbitrary profile UUID | Yes | Safe — scoped by `get_user_firm_id()`, resolves `false` cross-firm |
| `get_client_assigned_contact(p_client_id)` | Yes (explicit `GRANT EXECUTE`) | Yes — arbitrary client UUID | Yes | Safe — internal `auth.uid()`-bound-to-client_id check gates the entire function body |
| `lookup_firm_by_invite_code(p_code)` | Yes (intentionally pre-auth) | Yes — code string | Yes | Safe by design — returns 0 rows for a wrong guess, no partial leak |
| `lookup_client_invitation(p_token)` | Yes (intentionally pre-auth) | Yes — token string | Not separately probed this session | Same shape as `lookup_firm_by_invite_code`; low priority for 14.1b (random long token, not brute-forceable in practice) |
| `create_notification(...)` | Yes | Yes — arbitrary target user | Yes | Safe — explicit same-firm `RAISE EXCEPTION` |
| `record_dsc_movement(...)` | Yes | Yes — arbitrary DSC id | Yes | Safe — internal check rejects cross-firm |
| `issue_firm_invoice(...)` | Yes (`SECURITY INVOKER`, explicit grant) | Yes — arbitrary invoice id | Not probed this session (already exhaustively covered by `08-billing-rls.mjs`'s I1–I8, 29/29) | No new probing needed — SECURITY INVOKER means the caller's own RLS governs it, unlike every finding in §5 |
| `get_firm_plan` dependents (`firm_has_feature`) | Yes | No — uses caller's own firm internally | Not separately probed | No attacker-controlled argument; low priority |
| 14 trigger-type functions (`guard_*`, `handle_*`, `log_*`, `enforce_profile_protected_fields`, `seed_default_departments`, `rls_auto_enable`) | **No** | N/A | N/A | Not directly callable outside trigger context — excluded on that structural basis |

---

## 4. Explicitly NOT covered this session (for 14.1b to pick up precisely here)

- **`document_versions`, `firm_invoice_items`, `firm_invoice_counters`, `subscription_invoices`** — zero checks run against these four tables this session. `firm_invoice_items` has reasonable indirect coverage from `08-billing-rls.mjs` (not cross-firm, and not against this session's Firm A/B pair); the other three have **no** dedicated cross-firm or role-matrix coverage anywhere in the committed suite yet.
- **A real `platform_admins`/super_admin positive path.** Every check here proves a *non*-admin gets denied; no check in this sweep signs in as an actual super admin and confirms the cross-firm-visibility-by-design behavior from the admin's own side (existing `platform_admins` table has 0 seed rows in this run — a super admin account would need to be seeded and is a bigger decision than this session's scope, since `platform_admins` bootstrapping is explicitly service-role/SQL-editor-only by design).
- **`lookup_client_invitation()`** — reasoned about, not empirically probed this session (see §3).
- **The doc↔task client-consistency gap** (project_context.md §6 item 6 — no DB constraint that a linked document's `client_id` matches its `task_id`'s client) — not newly probed this session; still an open, previously-flagged item, not re-verified here. Worth an explicit empirical probe in 14.1b: as a permitted staff member, attempt `documents.INSERT`/`UPDATE` with a `client_id`/`task_id` pair from two *different* clients and confirm whether it's actually accepted.
- **Full billing money-path re-verification** — deliberately not repeated; `08-billing-rls.mjs` (29/29) already covers gapless numbering, concurrent issuing, TDS settlement, etc. in depth. This session only added cross-firm angles that script didn't have.
- **Rate-limiting / abuse-control probing** on public pre-auth RPCs (`lookup_firm_by_invite_code`, `lookup_client_invitation`, signup) — out of scope for an RLS sweep; already tracked as project_context.md §6 item 9.

---

## 5. Findings, ranked by severity

### F0 — CRITICAL — `apply_receipts_to_invoice()` is a cross-tenant write primitive with zero ownership check

**What was proven:** `apply_receipts_to_invoice(p_invoice_id UUID)` is `SECURITY DEFINER`, `RETURNS VOID` (not a trigger-only type), and is called today only from the `on_receipt_change` trigger — but nothing stops a direct RPC call. Its body (`schema.sql` lines 1442–1460) does **no** firm check, no `has_permission()` check, and no confirmation that the invoice belongs to the caller's firm at all before running an `UPDATE ... firm_invoices ... WHERE i.id = p_invoice_id`. **EVB, a Firm B employee with zero billing permission of any kind, called this RPC against Firm A's invoice and it succeeded with no error, and the row's `updated_at` changed** — proven empirically, not inferred (check #112).

**Blast radius:** the function recomputes `amount_received`/`tds_received`/`status` from whatever rows exist in `receipts WHERE invoice_id = p_invoice_id` — today that's always correctly firm-scoped data (since `receipts.invoice_id` legitimately only ever points at same-firm invoices via the app), so in the *current* data shape this doesn't let an attacker inject arbitrary numbers. But it **does** let any authenticated user, in any firm, with no permission of any kind, force a write to any OTHER firm's `firm_invoices` row on demand — bypassing the `billing.manage`-gated UPDATE policy entirely, and bypassing firm isolation entirely. If a future receipt/invoice mismatch is ever possible for any reason (a second bug, a bulk-import path, a migration edge case), this function would silently launder that mismatch into `firm_invoices.status`/`amount_received` for a firm the caller has no relationship to.

**Recommended fix:** add an ownership check at the top of the function body — `IF NOT EXISTS (SELECT 1 FROM firm_invoices WHERE id = p_invoice_id AND firm_id = get_user_firm_id()) THEN RETURN; END IF;` (or `RAISE EXCEPTION`) — mirroring the same-firm guard pattern already used in `create_notification()` and `record_dsc_movement()`. Since this function is meant to be internal-only (trigger-invoked), an alternative closure is to `REVOKE EXECUTE ... FROM authenticated` entirely and rely solely on the trigger's `SECURITY DEFINER` context to invoke it — simpler, and matches the fact that no legitimate caller should ever invoke this directly.
**Needs a migration:** yes.

### F1-RPC — HIGH — `get_firm_plan()` leaks any firm's subscription plan/features cross-tenant, bypassing `billing.view`

**What was proven:** `get_firm_plan(p_firm_id UUID)` takes an arbitrary firm UUID with no ownership check, is `SECURITY DEFINER` (bypasses `firm_subscriptions`' `billing.view`-gated RLS entirely), and has no `REVOKE EXECUTE` anywhere in `schema.sql`. **E0 (billing.view revoked) got her own firm's plan anyway; EV (Firm A employee) got Firm B's real plan data (code `starter`, price, `max_users`, `max_clients`, `features` JSONB) by supplying Firm B's UUID; a client_user (UA1) could do the exact same cross-firm call** — all three empirically confirmed with real, non-null returned data (checks #103–105).

**Severity note:** a plan/pricing tier is lower-sensitivity than client-confidential data, but this is still a clean cross-tenant boundary violation (any firm can learn any other firm's subscription plan/feature-flag configuration by UUID) and a clean permission-bypass (an employee explicitly denied `billing.view` gets the data anyway via the RPC). Firm UUIDs are not published anywhere in the UI today, which is the only reason this is latent rather than actively exploited — the same "not reachable through the app today" caveat this project has flagged for several prior findings (portal-isolation.md's #7, the `firms`→`firm_invoices` cascade finding).

**Recommended fix:** add `IF p_firm_id <> get_user_firm_id() AND NOT is_super_admin() THEN RETURN NULL; END IF;` at the top, or require `has_permission('billing.view')` inside the function body (matching the RLS it's meant to sit alongside).
**Needs a migration:** yes.

### F2 — HIGH — Staff storage policy has no task/department scoping at all (mirrors the historical client-side #7, but for staff)

**What was proven:** `"Staff can read their firm's document files"` (the storage SELECT policy for staff) checks only `is_firm_staff()` and a matching firm-id folder segment — it does **not** consult `staff_can_access_task()`, `has_permission('clients.view')`, or the `documents` table at all. **E0 was confirmed denied at the table layer for `docInternalOtherDept`** (a document on a task in a department she does not belong to — check #71/sanity check), **but the same E0 downloaded that exact object's bytes from storage, and listed its folder**, via the same storage policy every staff member shares (checks #74–75).

**Context:** the schema.sql comment above this policy explicitly calls it "the firm-wide defense-in-depth floor" for staff — so *some* broadness for staff is intentional (unlike the client-side #7 finding from `portal-isolation.md`, which was a genuine unintended gap the docs never called out). But "firm-wide" here means the storage layer doesn't honor the *department*-scoping model the `documents`/`tasks` tables otherwise enforce for every employee in this schema — an employee locked out of a department's tasks and documents at the table layer can still read every file under that department's clients directly from the bucket, and can enumerate them via `list()` without knowing any path in advance. This is architecturally the same shape of gap as the original portal-isolation.md #7 (storage broader than the table layer it's supposed to mirror), just on the staff side instead of the client side.

**Recommended fix (architectural — a decision, not a one-line patch, per this project's own precedent from portal-isolation.md §3):** either (a) accept this as intentional and document it explicitly in `ROLES_AND_RLS.md` (currently it's asserted in a schema.sql comment but not in the design doc, and it directly contradicts the department-scoping model documented for the `tasks`/`documents` tables), or (b) rewrite the staff storage SELECT policy to join through `documents` on the `document_id` path segment and re-apply `staff_can_access_task()`/`has_permission('clients.view')`, mirroring how the client storage policy already reuses `can_access_document()`.
**Needs a migration:** yes, if (b) is chosen; no code/schema change if (a) is chosen (documentation only).

### F3 — MEDIUM — `profiles` DELETE policy has no target-role exclusion: a partner can delete a co-partner's profile

**What was proven:** `"Partners can remove profiles in their firm"` is `firm_id = own AND get_user_role() = 'partner' AND id <> auth.uid()` — no restriction on the *target's* role. **PA successfully deleted PA2's profile row — a second, same-firm partner, not an employee** (check #25). The legitimate case (a partner removing an employee) also succeeds, as designed; a partner cannot delete their own row, also as designed. The gap is specifically the missing "target must not also be a partner" exclusion.

**Why this matters:** every other privilege-boundary finding fixed in this project so far (migration 009's `user_permissions` self-view, the DSC/documents `clients.view` scoping) drew the line at "a partner acting on another partner" as something that should require an explicit, deliberate design decision, not fall out of a generic policy. This is the one remaining table where that line isn't drawn: one partner can unilaterally remove a co-partner's entire staff access with a single DELETE call and no consent or notification path, which is a governance-sensitive action for what the product model treats as a firm's ownership tier.

**Recommended fix:** add `AND (SELECT role FROM profiles WHERE id = <target>) <> 'partner'` to the `USING` clause (a self-referencing subquery, same pattern already used for `profile_in_my_firm()`), or route partner-removal through a narrower mechanism requiring confirmation. This is a genuine product/business decision (should a partner ever be able to remove a co-partner at all, and if so how), not purely a security patch — flagged for Jay's call, not fixed here.
**Needs a migration:** yes, if tightened.

### F4 — MEDIUM — `tasks.assign` has no RLS branch anywhere; reassignment rides `tasks.update_department` (or self-assignment) with no separate check

**What was proven:** project_context.md §6 already flagged this ("No RLS policy references it"); this sweep proves *exactly* what it permits. **E0, with `tasks.assign` explicitly revoked and only `tasks.update_department` explicitly granted, successfully changed `assigned_to` on a department task she was not even the assignee of** (check #58) — via the `"Department updaters can update department tasks"` policy, which checks `tasks.update_department` and department membership only. Separately, an employee who *is* the current assignee cannot reassign herself away via the `"Employees can update assigned tasks"` policy specifically (an earlier draft of this check, since corrected, ran into Postgres's implicit `WITH CHECK = USING` default rejecting a self-assignment change — a real, if narrower, side-observation: that one specific path is accidentally *more* restrictive than intended, not less).

**Recommended fix:** this is the same "decide, don't patch" situation project_context.md already flagged: either add a genuine `tasks.assign`-gated policy branch for changing `assigned_to` specifically (would need a trigger or column-level check, since RLS can't distinguish "this UPDATE only touches `assigned_to`" cleanly), or formally accept that `tasks.update_department` implies assignment authority within one's own department and document that explicitly (removing `tasks.assign` from the catalog, or repurposing it for cross-department reassignment only).
**Needs a migration:** yes, if a dedicated check is added; no schema change if the decision is to formally accept current behavior (documentation only).

### F5 — LOW — task-less documents are visible firm-wide to any `clients.view` holder, not department-scoped (the Ph3 relaxation, now precisely characterized)

**What was proven:** this is the flagged-but-never-precisely-characterized "Ph3 documents INSERT relaxation." The sweep confirms both halves empirically: **a client_user can INSERT a task-less document under her own client** (check #67, the write side, intentional per the schema comment — "portal uploads can precede tasks"), **and any employee with `clients.view` (the employee default) can SELECT that task-less document for a client they have ZERO task or department relationship to at all** (check #68) — the `(task_id IS NULL AND clients.view)` branch has no department scoping, unlike every task-linked document access path in the same table. An employee with `clients.view` revoked correctly gets 0 rows for the same document (check #69).

**Severity note:** this is lower severity than F0–F3 because `clients.view` is the employee default (`true`) specifically because most CA-firm employees are expected to see client-identifying data broadly — this isn't a permission bypass, it's a scoping question (firm-wide vs. department-wide) for employees who already have the relevant permission. Still worth a deliberate decision since it's inconsistent with the department-scoping principle applied everywhere else in this schema.
**Recommended fix:** if department-scoping is wanted for task-less documents too, the `(task_id IS NULL AND clients.view)` branch would need to also check `employee_has_task_for_client()` OR department-membership against the client's *own* department affiliation (clients don't currently carry a department, so this would need either a new column or accepting firm-wide reach as correct for task-less documents specifically, since they have no task to inherit a department from).
**Needs a migration:** only if department-scoping is chosen; otherwise documentation-only (formally accept current behavior in `ROLES_AND_RLS.md`).

### Informational — not findings, no fix needed

- **`task_templates` SELECT is staff-wide, not `templates.manage`-gated** (check #86) — any employee can read the templates table directly via raw PostgREST even though the app's `/templates` page redirects non-`templates.manage` employees away. Since template rows carry no client/tenant-sensitive data (just title/description/checklist scaffolding), this is an app-vs-RLS inconsistency, not a security hole. No fix recommended; noted for awareness only.
- **Global catalogs** (`permissions`, `role_permissions`, `plans`, `compliance_types`) are readable by any authenticated user by design — confirmed, no tenant data in any of them, matches documented intent exactly.

### Documentation-accuracy finding (not a security issue, but changes what "unapplied" means for 14.3)

**Migration 006 is LIVE on the production project**, despite `project_context.md`, `docs/ROADMAP.md`, and `docs/DECISIONS.md` all describing it as "drafted, not applied" and this session's own instructions explicitly saying "Do NOT touch migration 006 (drafted Ph14, unapplied — it's 14.3's scope, not this session's)."

**Empirically confirmed (checks #99–100, plus direct `information_schema`/`pg_policies` queries via Supabase MCP before any write):**
- `receipts.invoice_id` is nullable on the live project (an on-account receipt with `invoice_id = NULL` was successfully seeded).
- `receipt_history` exists live, has RLS enabled, carries the exact policy set migration 006's header describes (`"Billing viewers can see receipt history"` / `"Super admins can view all receipt history"`, no write policy — trigger-only), and already held 8 pre-existing rows before this session's seed ran.

**What this changes:** this session did not touch migration 006 or apply any DDL, consistent with the instruction — but the instruction's premise (that 006 is unapplied) does not match the live database. This needs a human reconciliation before 14.3: either migration 006 was applied outside the documented process and the docs need correcting to "applied," or only *part* of it was applied (the on-account-receipt column change + `receipt_history` table, specifically) and the rest of the file needs a line-by-line diff against live `pg_policies`/`information_schema` to determine what, if anything, from 006 is still genuinely pending. This sweep did not attempt that line-by-line reconciliation — flagged for 14.3, not resolved here.
**Needs a migration:** unknown until the reconciliation above happens — possibly zero (if fully applied), possibly a small delta (if partially applied). **This is a ⚠ HUMAN item.**

---

## 6. Summary

**116/116 assertions matched their predicted outcome.** Of those, **7 findings** (F0 critical, F1-RPC/F2 high, F3/F4 medium, F5 low, plus the migration-006 documentation-accuracy item) represent real gaps or open decisions, all left unfixed per this session's verification-only scope. No DDL was applied. No fix was attempted. `scripts/verify/14-rls-sweep.mjs` is committed and re-runnable (confirmed idempotent across two consecutive runs) for whenever a fix session wants to re-verify any of the above.

**Immediate priority for a fix session, in order:** F0 (cross-tenant write primitive) → F1-RPC (cross-tenant read + permission bypass) → the migration-006 reconciliation (⚠ HUMAN, blocks knowing what 14.3's actual scope is) → F2/F3/F4 (each a genuine architectural decision, not a one-line patch) → F5 (lowest severity, decide-or-document).
