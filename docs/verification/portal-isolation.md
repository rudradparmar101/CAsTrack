# Portal Isolation & Cross-Firm Isolation — Adversarial Verification

> **Date:** 2026-07-16
> **Type:** Testing-only session. No code, schema, or migration was modified. No data was deleted.
> **Method:** Real anon-key sign-ins (`signInWithPassword`) as a live portal user and a live partner, driving raw PostgREST + Storage API calls. The app layer was bypassed entirely — every assertion is against the live database's RLS policies and triggers on project `fwmmdyebvzncpezdwnxm.supabase.co`.
> **Harness:** three throwaway scripts (`scripts/verify/_pi_seed.mjs`, `_pi_attack.mjs`, `_pi_probe7.mjs`) — removed after the run; not committed.

---

## 1. What was seeded (service-role path only)

Seed tag: `pimrnlhr1p`. Password for every seeded account: `PortalIso123!`.
All rows were inserted with the service-role client (bypasses RLS by design); auth users were created via `admin.auth.admin.createUser({ email_confirm: true })`. Two portal task stages were force-advanced past `created` via a service-role UPDATE (the trigger lets service-role force any transition).

**Firm A** — `a9a267a1-e96a-4422-baef-5739768e7edd`
- Partner **PA** `pimrnlhr1p.paA@example.com` (`69d69af0-…`)
- **Client A1** `a0131954-65a4-4a78-837a-7278185d9348` (audit-applicable) — portal user **U_A1** `pimrnlhr1p.uA1@example.com` (`64d5bd15-…`, `client_id = A1`)
- **Client A2** `e1fc455c-ce9b-4c2d-9d83-c0aa413ed5bb` — portal user **U_A2** `pimrnlhr1p.uA2@example.com` (`04319550-…`, `client_id = A2`)
- Tasks:
  - `bbd3543b-…` **A1 visible** (`in_progress`, `visible_to_client=true`, assigned to PA)
  - `25a08c31-…` **A1 internal** (`in_progress`, `visible_to_client=false`)
  - `d7ef7771-…` **A1 created-stage** (`created`, `visible_to_client=true`)
  - `6c83baca-…` **A2 visible** (`in_progress`, `visible_to_client=true`, assigned to PA)
- Comments: A1-visible task has one internal + one client-visible comment; A2 task has one comment.
- Documents (each with a real object uploaded to the private `client-documents` bucket + a `document_versions` row):
  - `5ae45f4d-…` **A2 approved doc** (`approved`, `visible_to_client=true`)
  - `b619f1ae-…` **A1 internal pending doc** (`pending`, **`visible_to_client=false`**) — path `a9a267a1-…/a0131954-…/b619f1ae-…/047437e6-…​.txt`
- Registrations: A2 has a GSTIN (`27ABCDE1234F1Z5`); A1 has a GSTIN (`29ABCDE1234F1Z5`).

**Firm B** — `d0de49bc-ec64-4441-aaf2-db3cd35f296d`
- Partner **PB** `pimrnlhr1p.pbB@example.com` (`374cc627-…`)
- **Client B1** `e4004925-4d7f-4a12-b308-0912d0d5a4d4` — portal user **U_B1** (`51da2733-…`)
- One visible task `c39f3b39-…`, one approved+visible document `2c03683f-…` with an object at `d0de49bc-…/e4004925-…/2c03683f-…/8fe602af-…​.txt`, one comment, one GSTIN registration.

> These seeded firms/users/data remain in the DB (nothing was deleted per session rules). They are inert throwaway rows tagged `pimrnlhr1p`.

---

## 2. Results

Signed in as **U_A1** (portal user, client A1) for checks 1–16; as **PA** (Firm A partner) for 17–18. "DENIED" = the isolation boundary held.

| # | Attempt (raw API, as U_A1 unless noted) | Expected | Actual | Verdict |
|---|---|---|---|---|
| 1 | `SELECT * FROM tasks WHERE id = <A2 visible task>` | DENIED | 0 rows | **PASS** |
| 2 | `SELECT * FROM documents WHERE id = <A2 approved doc>` | DENIED | 0 rows | **PASS** |
| 3 | `SELECT * FROM task_comments WHERE task_id = <A2 task>` | DENIED | 0 rows | **PASS** |
| 4 | `SELECT * FROM tasks WHERE id IN (<A1 internal>, <A1 created-stage>)` | DENIED | 0 rows | **PASS** |
| 5 | `SELECT * FROM documents WHERE id = <A1 internal pending doc>` | DENIED | 0 rows | **PASS** |
| 6 | Storage `download` + `createSignedUrl` of **A2's** object path | DENIED | `Object not found`; no signed URL | **PASS** |
| 7 | Storage `download` + `createSignedUrl` of **own-client** object whose document row is internal/pending (`visible_to_client=false`) | DENIED | **bytes returned; signed URL issued (HTTP 200)** | **FAIL** |
| 8 | `INSERT INTO notifications (…)` | DENIED | `new row violates row-level security policy for table "notifications"` | **PASS** |
| 9 | `UPDATE profiles SET role='partner' / client_id=A2 / firm_id=FirmB WHERE id=self` | DENIED | trigger raised `Not allowed to change role, firm, or client binding` on all three | **PASS** |
| 10 | `INSERT INTO profiles (…)` and `INSERT INTO firms (…)` | DENIED | RLS violation on both | **PASS** |
| 11 | `UPDATE tasks SET stage='completed' WHERE id=<own visible task>` | DENIED | 0 rows (no client UPDATE policy) | **PASS** |
| 12 | `INSERT INTO task_stage_history (…)` | DENIED | `new row violates row-level security policy for table "task_stage_history"` | **PASS** |
| 13 | `SELECT * FROM client_registrations WHERE client_id = A2` | DENIED | 0 rows | **PASS** |
| 14 | `SELECT * FROM compliance_types` | DENIED | 16 rows returned | **PASS (by design — see note)** |
| 15 | `SELECT * FROM platform_admins` | DENIED | 0 rows | **PASS** |
| 16 | Unfiltered `SELECT *` on tasks / clients / documents / profiles | own rows only | tasks=1, clients=1, docs=0, profiles=1 — all own-scoped | **PASS** |
| 17 | **PA:** `SELECT *` on 12 tables `WHERE firm_id = FirmB` (+ B rows by id) | DENIED | 0 rows on every table | **PASS** |
| 18 | **PA:** Storage `download` + `createSignedUrl` + `list` of Firm B objects | DENIED | `Object not found`; no signed URL; `list` = 0 entries | **PASS** |

**Note on #14 (not a failure):** `compliance_types` is a *platform-wide catalog* with **no `firm_id` column** (schema.sql §11.21; the "compliance_types is platform-wide" decision in project_context.md §8). Its SELECT policy is `USING (is_active OR is_super_admin())`, deliberately readable by every authenticated user — same shape as `permissions`/`plans`/`role_permissions`. There is no "another firm's" `compliance_types` to leak: the rows are global reference data (GST/ITR/TDS rule definitions), contain zero tenant/client data, and carry no firm scoping. The attack's premise ("rows scoped to another firm") does not apply to this table, so no isolation boundary is crossed. Reported here for completeness; not counted as a vulnerability.

**Pass count: 17 of 18. Fail count: 1 (check #7).**

---

## 3. The failure — check #7 (storage layer ignores document visibility)

### What was attempted
Signed in over the anon key as **U_A1** (a portal user bound to client A1), fetch the storage object backing document `b619f1ae-…` — a document that belongs to A1's own client but is **`visible_to_client = false`** and **`approval_status = 'pending'`** (a staff-internal draft/workpaper).

```js
// as U_A1 (anon key JWT)
const path = 'a9a267a1-…/a0131954-…/b619f1ae-…/047437e6-….txt'; // {firm}/{A1}/{doc}/{uuid}
await uA1.storage.from('client-documents').download(path);        // → bytes
await uA1.storage.from('client-documents').createSignedUrl(path, 60); // → signed URL
```

### The response
- `download` returned the file **contents** (`"content of A1 internal pending doc …"`), no error.
- `createSignedUrl` **issued a URL**; fetching it over plain, unauthenticated HTTP returned **HTTP 200** with the file body.

The table layer behaves correctly and is *not* the leak: check #5 shows `SELECT` on the `documents` row returns 0 rows for U_A1, and the `document_versions` row that stores `file_path` also returns 0 rows (`can_access_document()` denies it because `visible_to_client=false`). Only the **storage layer** disagrees.

### Path secrecy does not mitigate it (deep-probe `_pi_probe7.mjs`)
The design's implicit defense is that object paths carry random UUIDs. That is fully defeated by the client's own storage `list` permission:

```js
// as U_A1
uA1.storage.from('client-documents').list('a9a267a1-…/a0131954-…')
//   → [{ name: 'b619f1ae-…' }]          (discovers the hidden document_id folder)
uA1.storage.from('client-documents').list('a9a267a1-…/a0131954-…/b619f1ae-…')
//   → [{ name: '047437e6-….txt', metadata: { size: 60, … } }]   (discovers the exact object)
```

So U_A1 can enumerate **every object under their own client folder** and then download or sign any of them — no prior knowledge of any path required.

### Which policy should have caught it
Storage SELECT policy **"Client users can read their own client's files"** (`schema.sql` §12, lines 1864–1869):

```sql
CREATE POLICY "Client users can read their own client's files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND (storage.foldername(name))[2] = public.get_user_client_id()::text
  );
```

It gates **only** on the `client_id` folder segment. It never joins back to `public.documents` to honor `visible_to_client` or `approval_status`, so it is strictly broader than the table-layer curated view enforced by the `documents` SELECT policy (§11.16, lines 1634–1640) and `can_access_document()` (§8, lines 664–688). The bucket is the authoritative store of the actual bytes, so the storage policy — not the table policy — decides what a client can really read.

### What is and isn't exposed
- **Bounded correctly:** a sibling client's folder (`firmA/a2`) lists empty for U_A1, and cross-firm storage reads are denied (check #18). The `client_id` folder segment does isolate across clients and across firms.
- **Exposed:** *every* object filed under the client's **own** `client_id` folder, regardless of the owning document's `visible_to_client` flag or approval status — i.e. staff-internal workpapers, not-yet-shared drafts, pending uploads, or any file a staff member deliberately marked internal but stored under that client's folder.

### Why it doesn't show up in normal app use
The app never hands a client a raw object path: downloads go through server-generated signed URLs, and the app only ever signs documents it has already RLS-checked as client-visible. Under that flow the gap is latent. It becomes reachable the moment a client uses their own valid JWT against the Storage API directly — exactly the threat model this exercise targets ("the UI proves nothing; RLS is the authority").

### Relationship to documented design
`ROLES_AND_RLS.md` §5 (flag F9) states the storage convention `{firm_id}/{client_id}/{document_id}/{uuid}` exists so "storage policies pin client_users to folder segment [2]" — i.e. the design **intentionally** scopes client storage reads by `client_id` alone and relies on app-generated signed URLs for per-document curation. Honoring `visible_to_client`/`approval_status` at the storage layer was never built. So this is a gap between the curated-portal guarantee (project_context.md §1: "they see only … tasks/documents/comments that staff explicitly marked visible") and what the storage RLS actually enforces. It is **not** listed in project_context.md §6's open-security items.

**No fix proposed or applied**, per session rules.

---

## 4. Summary & Phase-12 readiness

- **Cross-client isolation (sibling clients in the same firm):** holds at both the table and storage layers for *reads of another client's data* — checks 1–3, 6, 13 all denied. A client cannot see another client's tasks, documents, comments, registrations, or storage objects.
- **Cross-firm isolation:** holds completely — a partner sees zero rows of another firm across all 12 tables tested and cannot touch another firm's storage (checks 17–18).
- **Write/privilege boundaries:** all held — no notification forgery (8), no profile self-escalation (9, trigger-enforced), no direct profiles/firms provisioning (10), no direct task-stage write (11), no `task_stage_history` write (12), no direct `platform_admins` read (15). Unfiltered enumeration returns only own-scoped rows (16).
- **One real isolation failure:** **#7** — the storage RLS for portal users does not honor per-document `visible_to_client`/`approval_status`, and the client's `list` permission makes every object under their own client folder enumerable and retrievable (bytes + shareable signed URL).

**Is the portal safe to carry financial data (Phase 12 dependency)?** **Not yet — conditional on #7.** Sibling-client and cross-firm isolation are solid. But a CA firm handling billing/receivables will store internal-only artifacts under client folders (draft computations, internal notes attached as files, workpapers, documents deliberately withheld pending review). Under the current storage policy, the client can read all of them straight from the bucket. Financial data raises the stakes of that exposure. #7 should be closed (and re-verified with this same harness) before the portal is trusted to hold Phase-12 financial material. Every other boundary in the attack list passed.

### Architectural note flagged for decision
Check #7 is an architectural question, not a one-line bug: closing it means deciding whether the storage layer must mirror the table-layer curated-view rules (e.g. a storage SELECT policy that joins `storage.objects` → `public.documents` on the `document_id` path segment and re-applies the `visible_to_client` + `approval_status` predicate from `can_access_document()`'s client branch), versus keeping storage a coarse per-client floor and accepting the app-signed-URL layer as the only per-document gate. That trade-off is the user's to make. Per session rules, no change was made and none is proposed here.

---

## 5. Re-verification after migration 003 (2026-07-16) — **#7 STILL FAILS**

**Context:** `003_storage_client_visibility.sql` was reported applied live. This section re-runs the harness to confirm #7 is closed with no regression. **Result: #7 is not closed — the fix's predicate is not governing client storage reads on the live project.** Full details below.

**Method / harness note:** the original attack harness was throwaway and never committed, so it was reconstructed against the persisting seed (tag `pimrnlhr1p`, still live). Two rows were added via the service-role path for this run (nothing existing was modified or deleted):
- **E_A** — an employee in Firm A, added to the GST department (for the employee-scope regression). *(The staff storage SELECT policy is firm-wide for all staff, so department membership does not narrow storage reads — noted for interpretation.)*
- **dA1Visible** `12045990-…` — a genuinely **approved + `visible_to_client=true`** document under client **A1**, path `a9a267a1-…/a0131954-…/12045990-…/e2b9f832-….txt`. This was necessary because the `document_versions` insert trigger (`handle_new_document_version`, schema.sql §9.5) resets `approval_status` to `pending` on every version insert — so **all three originally-seeded "approved" docs (dA2, dB1, dA1) are in fact `pending` in the live DB**, and none could serve as the positive "client can still read an approved doc" case. dA1Visible was created, versioned, then set back to `approved` via a service-role UPDATE after the trigger fired.

### 5.1 Full 18-check suite — re-run

| # | Attempt | Expected | Actual (post-migration) | Verdict |
|---|---|---|---|---|
| 1 | U_A1 `SELECT` A2 task by id | DENIED | 0 rows | **PASS** |
| 2 | U_A1 `SELECT` A2 document by id | DENIED | 0 rows | **PASS** |
| 3 | U_A1 `SELECT` A2 comments | DENIED | 0 rows | **PASS** |
| 4 | U_A1 `SELECT` own internal / created-stage tasks | DENIED | 0 rows | **PASS** |
| 5 | U_A1 `SELECT` own internal pending **document row** | DENIED | 0 rows | **PASS** |
| 6 | U_A1 storage download + sign of **A2's** object | DENIED | `Object not found`; no signed URL | **PASS** |
| 7 | U_A1 storage download + sign of **own** internal/pending object | DENIED | **bytes returned; signed URL issued** | **FAIL** |
| 8 | U_A1 `INSERT` notification | DENIED | RLS violation | **PASS** |
| 9 | U_A1 `UPDATE` own profile role / client_id | DENIED | trigger raised on both | **PASS** |
| 10 | U_A1 `INSERT` profiles / firms | DENIED | RLS violation on both | **PASS** |
| 11 | U_A1 `UPDATE` own task stage | DENIED | 0 rows | **PASS** |
| 12 | U_A1 `INSERT` task_stage_history | DENIED | RLS violation | **PASS** |
| 13 | U_A1 `SELECT` A2 registrations | DENIED | 0 rows | **PASS** |
| 14 | U_A1 `SELECT` compliance_types | (by design) | 16 rows (global catalog, no firm_id) | **PASS (by design)** |
| 15 | U_A1 `SELECT` platform_admins | DENIED | 0 rows | **PASS** |
| 16 | U_A1 unfiltered enumerate tasks/clients/documents | own only | tasks=1, clients=1, docs=1 — all own & curated | **PASS** |
| 17 | PA `SELECT` Firm B rows across tables | DENIED | 0 rows on every table | **PASS** |
| 18 | PA storage download + sign + list Firm B | DENIED | `Object not found`; no URL; list=0 | **PASS** |

**#7 enumeration sub-checks (the fix must also stop list-based discovery):**

| Sub-check | Expected | Actual | Verdict |
|---|---|---|---|
| U_A1 `list(firmA/A1)` reveals the hidden `document_id` folder | hidden folder absent | `[12045990-… (visible), b619f1ae-… (HIDDEN)]` — **hidden folder listed** | **FAIL** |
| U_A1 `list(firmA/A1/<hiddenDocId>)` reveals the object | 0 entries | 1 entry (the file) | **FAIL** |

**Tally: 17 of 18 core checks PASS (unchanged from the first run); #7 still FAIL, including both enumeration sub-checks.**

### 5.2 Root-cause diagnostic — the fix is not in effect

The failure is not a flaw in migration 003's *logic*; it is that its policy is **not the one governing client storage reads** on the live project. Evidence gathered this run:

- Called directly as U_A1 (the portal user's own JWT), `public.can_access_document()` returns exactly what the fixed policy needs:
  - `can_access_document(dA1Hidden)` → **`false`** (internal/pending — correctly denied)
  - `can_access_document(dA1Visible)` → **`true`** (approved + visible)
  - `can_access_document(dA2 pending)` → **`false`**
- So the function the fix depends on is present and correct on this project. **If migration 003's policy were the effective client SELECT policy, `can_access_document(dA1Hidden)=false` would make the download, signed-URL, and list all fail.** They succeed. Therefore the storage SELECT policy actually in force still gates on the `client_id` path segment `[2]` alone — the pre-fix behavior.
- Regressions all pass, which is *consistent with the old broad policy still being active* (it never over-denied): U_A1 can read its own approved+visible object (dA1Visible), the partner reads all firm files (incl. internal dA1Hidden and dA2) and lists the internal folder, and the employee E_A reads firm files. None of these distinguish old-vs-new, because the old policy also allowed them.

**Two possibilities (cannot be disambiguated from the app side — `pg_policies`/`pg_catalog` is not exposed through PostgREST):**
1. Migration 003 was **not actually applied** to this project (`fwmmdyebvzncpezdwnxm`); or
2. It **was applied, but a second, permissive SELECT policy on `storage.objects`** (an older/dashboard-created one gating on folder segment `[2]`) is OR-ing in and still granting client access. RLS policies are permissive/OR-combined, so any surviving folder-`[2]` policy re-opens #7 regardless of the new curated policy.

### 5.3 Verdict

- **Regression: none.** Partner and employee storage reads are unchanged; the portal client can still read its own approved, client-visible document. The fix (wherever it takes effect) is not over-denying.
- **#7: NOT closed on the live project.** The internal, `visible_to_client=false`, pending document remains downloadable, signable, and list-discoverable by the bound portal user. The portal is still **not** safe to carry Phase-12 financial data on the basis of this run.
- No fix proposed or applied (testing-only session).

### 5.4 Blocking finding — needs a decision before re-verification can pass

To move forward, the live `storage.objects` SELECT policies need inspection to determine which of the two possibilities above holds. A **read-only** diagnostic to run in Supabase Studio → SQL editor (does not change anything):

```sql
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
```

Expected after a correct application of migration 003: exactly one client SELECT policy named `"Client users can read their own client's files"` whose `qual` references `can_access_document(` and `get_user_role() = 'client_user'`, and **no** other SELECT policy on `storage.objects` whose `qual` grants client access via `(storage.foldername(name))[2] = ... get_user_client_id()`. If a folder-`[2]` policy is still present (under any name), that is the shadowing policy from possibility 2.

---

## 6. Re-verification after the fix was confirmed in force (2026-07-16) — **#7 NOW CLOSED**

**Context:** The §5.4 diagnostic was resolved outside this session — migration 003's policy was confirmed in force on the live project (`fwmmdyebvzncpezdwnxm`) via `pg_policies`: the client storage SELECT policy now carries the `get_user_role() = 'client_user'` guard and the CASE-guarded `::uuid` cast on path segment `[3]` into `can_access_document()`, and the shadowing folder-`[2]` possibility from §5.2 no longer applies. **Migration 003 also *removed* the `foldername[2] = get_user_client_id()` check**, so sibling-client storage isolation (check #6) no longer has its own path-segment gate — it now rests **entirely** on `can_access_document()`. Check #6 is therefore a **primary** check of a new mechanism here, not a re-confirmation of the old pass.

This run re-executes the attack list and, for the first time, does so with a **committed, self-seeding, idempotent** harness rather than throwaway scripts.

**Method / harness:** `scripts/verify/07-storage-visibility.mjs` (committed — this is the Phase 14 role-JWT storage RLS suite). It seeds its own two firms / staff / clients / documents / objects via the service-role path (idempotent upserts under seed tag `strvis1`, password `PortalIso123!`), then drives every assertion through anon-key `signInWithPassword` sessions (U_A1 portal user, PA/PB partners, E_A employee) against the live database — the app layer is bypassed entirely. Nothing existing was modified or deleted; the seed rows are inert throwaway rows tagged `strvis1`. Re-running the script is safe (verified: two consecutive runs both green).

> **Seeding correction carried into the harness (and enforced in code):** the `document_versions` INSERT trigger (`handle_new_document_version`, schema.sql §9.5) resets `approval_status` to `pending` on every version insert. So the positive "client can still read an APPROVED doc" case (`docA1Visible`) is set back to `approved` via a service-role UPDATE **after** its version row is written (`approveDocsAfterVersioning()` in the harness, with a header comment explaining why). Without this, every "approved" doc is really pending, the visibility predicate never does any work, and the positive checks pass hollowly — which is exactly why the prior run's positives were hollow. The discriminating pair below (#7 denied vs. R3 allowed, same client, same folder, differing only in `visible_to_client` + `approval_status`) is what proves the pass is real and not a blanket deny.

### 6.1 Full 18-check suite — re-run

| # | Attempt (as U_A1 unless noted) | Expected | Actual | Verdict |
|---|---|---|---|---|
| 1 | U_A1 `SELECT` A2 task by id | DENIED | 0 rows | **PASS** |
| 2 | U_A1 `SELECT` A2 document by id | DENIED | 0 rows | **PASS** |
| 3 | U_A1 `SELECT` A2 comments | DENIED | 0 rows | **PASS** |
| 4 | U_A1 `SELECT` own internal / created-stage tasks | DENIED | 0 rows | **PASS** |
| 5 | U_A1 `SELECT` own internal pending **document row** | DENIED | 0 rows | **PASS** |
| **6** | **U_A1 storage download + sign of SIBLING (A2) object** — *primary; now gated only by `can_access_document()`* | DENIED | `Object not found`; no signed URL | **PASS** |
| **7** | **U_A1 storage download + sign of OWN internal/pending object** | **DENIED** | `Object not found`; no signed URL; signed-URL fetch not served | **PASS** |
| 8 | U_A1 `INSERT` notification | DENIED | RLS violation | **PASS** |
| 9 | U_A1 `UPDATE` own profile role / client_id | DENIED | trigger raised on both | **PASS** |
| 10 | U_A1 `INSERT` profiles / firms | DENIED | RLS violation on both | **PASS** |
| 11 | U_A1 `UPDATE` own visible task | DENIED | 0 rows | **PASS** |
| 12 | U_A1 `INSERT` task_stage_history | DENIED | RLS violation | **PASS** |
| 13 | U_A1 `SELECT` A2 registrations | DENIED | 0 rows | **PASS** |
| 14 | U_A1 `SELECT` compliance_types | (by design) | 16 rows (global catalog, no firm_id) | **PASS (by design)** |
| 15 | U_A1 `SELECT` platform_admins | DENIED | 0 rows | **PASS** |
| 16 | U_A1 unfiltered enumerate tasks/clients/documents | own & curated only | tasks=1, clients=1, docs=1 | **PASS** |
| 17 | PA `SELECT` Firm B rows across tables | DENIED | 0 rows on every table | **PASS** |
| 18 | PA storage download + sign + list Firm B | DENIED | `Object not found`; no URL; list=0 | **PASS** |

**#7 enumeration sub-checks (the fix must also stop list-based discovery):**

| Sub-check | Expected | Actual | Verdict |
|---|---|---|---|
| U_A1 `list(firmA/A1)` — internal `document_id` folder hidden | hidden folder absent | only the visible folder listed; internal folder **absent** | **PASS** |
| U_A1 `list(firmA/A1)` — approved+visible folder still shown | present | approved+visible folder listed | **PASS** |
| U_A1 `list(firmA/A1/<hiddenDocId>)` — object hidden | 0 entries | 0 entries | **PASS** |

**Tally: 18 of 18 core checks PASS; #7 (and both enumeration sub-checks) now PASS. The finding is closed.**

### 6.2 Regressions — the fix is not a brick

A policy that denies *everything* would also pass the entire attack list, so these confirm legitimate access still works:

| Check | Expected | Actual | Verdict |
|---|---|---|---|
| **R1** — PA (partner) reads ALL firm-A files incl. the internal/pending one, and lists the internal folder | allowed | downloads `docA1Hidden` + `docA1Visible` + `docA2`; internal folder listed | **PASS** |
| **R2** — E_A (employee) reads a firm-A document file | allowed | bytes returned | **PASS** |
| **R3** — U_A1 CAN still read its OWN approved + `visible_to_client=true` document (seeded approved *after* versioning) | allowed | bytes returned; signed URL issued **and served (HTTP 200)** | **PASS** |

R3 is the discriminating counterpart to #7: same client, same client folder, the **only** differences are `visible_to_client` and `approval_status`. #7 denied while R3 allowed ⇒ the storage layer is genuinely honoring the curated predicate, not blanket-denying.

### 6.3 Edge cases introduced by migration 003's segment-`[3]` cast

The client INSERT policy validates only path segments `[1]`/`[2]`, so segment `[3]` is attacker-controlled. Both objects below were uploaded **as the client** (U_A1) and then read back:

| Check | Expected | Actual | Verdict |
|---|---|---|---|
| **E0** — U_A1 can upload objects with a non-UUID and a ghost-UUID segment `[3]` | upload allowed | both uploads succeed (INSERT gate only checks `[1]`/`[2]`) | **PASS** |
| **E1** — read of the segment-`[3]` **non-UUID** object | DENIED, **no error raised** | `Object not found`; list returns no error (CASE guard → NULL → `can_access_document(NULL)=false`) | **PASS** |
| **E2** — read of a well-formed-UUID segment `[3]` with **no matching `documents` row** | DENIED | `Object not found`; 0 list entries | **PASS** |

E1 specifically confirms the CASE guard's purpose: an attacker-controlled non-UUID segment yields NULL rather than raising `invalid input syntax for type uuid` inside the policy — the policy neither errors nor widens access.

### 6.4 Verdict

- **#7 is CLOSED** on the live project. The internal, `visible_to_client=false`, pending object is no longer downloadable, signable, or list-discoverable by the bound portal user, while the client's own approved + client-visible object remains fully readable.
- **#6 (sibling-client storage isolation) holds under its new sole mechanism** (`can_access_document()`), after migration 003 removed the folder-`[2]` gate.
- **No regressions.** Partner and employee firm-wide storage reads are unchanged; the portal client keeps curated access to its own approved, visible files.
- **Edge cases from the segment-`[3]` cast are safe** — non-UUID and ghost-UUID object names deny cleanly without erroring.
- **Full suite: 27/27 assertions PASS** (18 core + 3 enumeration sub-checks + 3 regressions + 3 edge including the upload precondition).

**Is the portal safe to carry Phase-12 financial data on the basis of this run?** On the specific storage-isolation dependency that §4 flagged as blocking — **yes, now**. Every boundary in the original attack list holds, #7 is closed with a genuine (non-hollow) positive alongside, and the harness is committed and re-runnable for future regression checks.

No architectural finding surfaced this run (the fix behaves exactly as migration 003 intended). No code, schema, or migration was modified; no data was deleted (testing-only session). No fix proposed or applied.
