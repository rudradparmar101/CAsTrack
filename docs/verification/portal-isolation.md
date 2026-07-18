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

---

## 7. Billing RLS & money-path verification — migration 004 (2026-07-18) — **NEW ARCHITECTURAL FINDING**

> **Date:** 2026-07-18
> **Type:** Testing-only session. No code, schema, or migration was modified. No production data was deleted.
> **Scope:** `004_client_billing.sql`, reported applied to the live project (`fwmmdyebvzncpezdwnxm`). This is the first adversarial attack on the billing surface, and specifically on the migration's architectural exception: client access to invoices runs through the **DEFINER views** `client_invoices` / `client_invoice_items` (predicate `client_id = get_user_client_id() AND status <> 'draft'`), NOT through RLS — `client_users` have no policy on any billing table. That view path had never been attacked before; every view assertion here is a **primary** check of a new mechanism.
> **Harness:** `scripts/verify/08-billing-rls.mjs` (committed, self-seeding, idempotent — seed tag `bilrls1`, password `PortalIso123!`). Service-role for seeding; anon-key `signInWithPassword` sessions for every assertion (partner, three employees at different permission levels, three portal clients across two firms). The app layer is bypassed entirely.

### 7.1 Result summary

**27 of 29 assertions PASS. 2 FAIL — both the same finding: portal clients can WRITE to `firm_invoices` through the auto-updatable DEFINER views.**

| Group | Check | Verdict |
|---|---|---|
| **Client read path (primary — the DEFINER-view exception)** | | |
| C1 ×5 | U_A1 direct `SELECT` on `firm_invoices` / `firm_invoice_items` / `receipts` / `fee_masters` / `firm_invoice_counters` → 0 rows each | **PASS** |
| C1b | U_A1 `SELECT client_outstanding` (security_invoker view) → 0 rows | **PASS** |
| C6 | U_A1 `client_invoices` → own non-draft rows only, incl. the issued one (not a brick) | **PASS** |
| C7 | `client_invoices` exposes neither `internal_notes` nor `cancellation_reason` (columns absent; explicit select errors) | **PASS** |
| C8 | `client_invoice_items` → own issued items visible, sibling items 0 | **PASS** |
| C9 | U_A1 `client_invoices` for sibling A2 → 0 rows | **PASS** |
| C10 | U_A1 own **draft** invoice not visible through `client_invoices` | **PASS** |
| C11 | Cross-firm: U_B1 sees only Firm B; neither client sees the other firm's invoice | **PASS** |
| C12a | U_A1 **INSERT** through the views → denied | **PASS** *(but incidental — see 7.3)* |
| **C12b** | **U_A1 `UPDATE` own issued invoice `status='paid'` through the view → expected DENIED** | **FAIL** |
| **C12c** | **U_A1 `UPDATE` own invoice `amount_received` through the view → expected DENIED** | **FAIL** |
| C13 | U_A1 `rpc issue_firm_invoice(own draft)` → denied; draft unchanged | **PASS** |
| **Staff permission matrix** | | |
| S1 | PA (partner) reads invoices / receipts / fee_masters | **PASS** |
| S2 | E0 (employee, no billing perm) reads nothing across all 5 billing tables | **PASS** |
| S3 | EV (`billing.view`) reads invoices / receipts / fee_masters / counters | **PASS** |
| S4 | EV (view only) cannot INSERT draft / UPDATE invoice / INSERT receipt | **PASS** |
| S5 | EM (`billing.view` + `billing.manage`) creates a draft and issues it (finding-4 pairing rule, end-to-end under an employee JWT) | **PASS** |
| **Integrity / money paths** | | |
| I1 | Two **concurrent** issues in one firm+FY → both succeed, distinct seqs | **PASS** |
| I2 | Delete a draft → next issued number is counter+1 (no gap consumed) | **PASS** |
| I3 | UPDATE frozen column on an issued invoice → rejected by `guard_firm_invoice` | **PASS** |
| I4 | Line-item INSERT/UPDATE/DELETE on an issued invoice → all rejected by `guard_invoice_items_frozen` | **PASS** |
| I5 | Receipt 90% cash + 10% TDS (u/s 194J) → invoice `paid`, `client_outstanding` zero | **PASS** |
| I6 | Cancel an invoice with receipts applied → rejected | **PASS** |
| I7 | Receipt whose `client_id` ≠ the invoice's client → rejected by `guard_receipt` | **PASS** |
| I8 | Gapless series audit in a fresh FY: N issues → seqs exactly 1..N, counter == N, interleaved draft-delete no gap | **PASS** |

Every boundary the prompt enumerated holds **except** the "INSERT/UPDATE/DELETE through the views — denied" item, which is where the finding lives.

### 7.2 The finding — portal clients can write to `firm_invoices` through the DEFINER views

`client_invoices` and `client_invoice_items` are **DEFINER-rights** views (deliberately **not** `security_invoker` — with no client policy on the base tables, an invoker view would return nothing). They have **no `INSTEAD OF` trigger** and **no `WITH CHECK OPTION`**, so PostgreSQL treats them as **auto-updatable**: a write through the view is rewritten as a write against `firm_invoices` executed **with the view owner's rights**, which bypasses the fact that the base table has *no client write policy at all*.

Demonstrated as **U_A1 (a portal client, own anon-key JWT), raw PostgREST**, against a fresh receiptless *issued* invoice owned by that client:

```js
// as U_A1 — marks OWN issued invoice paid with ZERO money received
await uA1.from('client_invoices').update({ status: 'paid' }).eq('id', invId);
//   → error: none; rows: 1;  DB status after: 'paid'  (amount_received still 0)

// as U_A1 — rewrites the receivables ledger directly
await uA1.from('client_invoices').update({ amount_received: 999999 }).eq('id', invId);
//   → error: none;  DB amount_received after: 999999
```

Out-of-band probes (not in the committed suite, run once against throwaway `bilrls1` rows) established the full blast radius:

- **DELETE succeeds.** `uA1.from('client_invoices').delete().eq('id', <own receiptless issued invoice>)` returned 1 row and removed the row from `firm_invoices` — a portal client can **delete a statutory issued invoice**, which also **gaps the "gapless" per-firm-per-FY series** (the counter is not decremented). This permanently gapped firm A's live `2026-27` seed series during this session (a throwaway seed firm; noted for transparency — it is why the suite's gapless audit runs in a fresh, isolated FY).
- **INSERT is blocked — but only incidentally.** The insert fails on `created_by` `NOT NULL` (that column is not part of the view, so it defaults to NULL), **not** on any access-control rule. Had the view exposed `created_by`, or the column been nullable/defaulted, a client could forge invoice rows for its own `client_id`.
- **Writes are bounded to the client's own `client_id`** — an UPDATE filtered by a sibling's `client_id` affected 0 rows (the view predicate does scope the rewritten write). So this is **not** a cross-tenant breach; it is a client tampering with **its own** billing records.

### 7.3 Root cause

Migration 004 ends the view block with:

```sql
REVOKE ALL ON public.client_invoices, public.client_invoice_items FROM anon, public;
GRANT SELECT ON public.client_invoices, public.client_invoice_items TO authenticated;
```

The `REVOKE` targets `anon` and `PUBLIC`, but **`authenticated` is a separate role — `PUBLIC` ≠ `authenticated`** — and Supabase's default privileges grant `authenticated` full DML on newly created objects in `public`. The `GRANT SELECT ... TO authenticated` is therefore **additive**; it never removes the pre-existing INSERT/UPDATE/DELETE that Supabase's defaults already handed `authenticated` on these views. Combined with the views being auto-updatable definer views, that residual DML privilege is exactly what lets a portal client's UPDATE/DELETE reach `firm_invoices` with the owner's rights. The migration's stated invariants — "the ONLY read path for `client_users`", "issued invoices are immutable — cancel and reissue", "issued invoices are cancelled, never deleted" — are all defeated from the portal by this one gap.

Note the `guard_firm_invoice` trigger does *not* backstop this: its frozen-column list omits `status`, `amount_received`, `tds_received`, `internal_notes`, and `cancellation_reason` (by design — status/settlement move via the receipts trigger, notes stay editable post-issue). So a direct client write to `status` or `amount_received` sails through the guard, and a DELETE never reaches the guard at all (it's an UPDATE-only trigger).

### 7.4 Why it doesn't show up in normal app use

The app never issues writes against `client_invoices` — the portal only reads through it, and all staff writes go against the base tables under RLS. Under that flow the gap is latent. It becomes reachable the instant a portal client uses their own valid JWT against PostgREST directly — the exact threat model this exercise targets ("the UI proves nothing; RLS is the authority").

### 7.5 Verdict

- **Client read isolation through the DEFINER views is solid** (C1–C11, C13): no direct base-table access, no sibling or cross-firm leakage, drafts hidden, `internal_notes` / `cancellation_reason` never exposed, and `issue_firm_invoice()` cannot be called by a client.
- **Staff permission matrix and every server-side money-path invariant hold** (S1–S5, I1–I8): gapless numbering under concurrency, draft-delete without gap, issued-invoice and line-item immutability, TDS u/s 194J settlement, cancel-with-receipts rejection, and `guard_receipt`'s cross-client rejection all enforced by the database.
- **One real integrity failure: the DEFINER views are a write path, not just a read path.** A portal client can mark its own issued invoices paid, rewrite `amount_received`, and delete issued invoices (gapping the statutory series) — all via `authenticated`'s residual DML on auto-updatable definer views. Scoped to the client's own `client_id`; not cross-tenant.

**Is the portal safe to carry Phase-12 financial data on the basis of this run?** On the read/isolation dependency §4/§6 flagged — yes, the curated read path holds. **But not on write integrity:** a client can tamper with its own invoices' payment state and destroy issued records until this view write-through is closed and re-verified with this same committed harness (the harness fails exactly the two checks that must flip to PASS).

### 7.6 Architectural finding flagged for decision

Closing this is an architectural choice, not a one-line patch, so per session rules **no fix was proposed or applied**. The decision is *how* to make the views read-only for `authenticated` — e.g. `REVOKE INSERT, UPDATE, DELETE ON` both views `FROM authenticated` (and audit Supabase default-privilege grants so new objects don't silently re-open it), and/or add `INSTEAD OF INSERT/UPDATE/DELETE` triggers that raise, and/or reconsider whether these should be `security_invoker` views paired with a curated column-limited client SELECT policy. That trade-off is the user's to make. No code, schema, or migration was modified this session; no production data was deleted.

---

## 8. Re-verification after migration 005 (2026-07-18) — §7's write-through CLOSED; ON DELETE CASCADE regression found

> **Date:** 2026-07-18
> **Type:** Testing-only session. Migration 005 was reported applied to the live project (`fwmmdyebvzncpezdwnxm`). No code or schema was modified during this verification; the throwaway probe scripts written for the out-of-band checks (`_probe_005*.mjs`) were deleted after the run, per the committed-harness-only convention.
> **Scope:** re-run of `scripts/verify/08-billing-rls.mjs` (committed, unchanged) plus three out-of-band probes (P1–P3, not in the committed suite) covering exactly the items the apply-migration prompt called out: the client DELETE path through the view, a direct RLS-bypassing DELETE against the new backstop trigger, and the `firms` → `firm_invoices` `ON DELETE CASCADE` interaction.

### 8.1 Committed suite — 29/29 PASS, exit 0

Full re-run of `08-billing-rls.mjs` against the live project: **29/29 PASS**, process exit code `0`. The two checks that were the point of migration 005 now pass, and every previously-passing check still passes (no regressions in the committed suite):

| Check | §7 result | §8 result |
|---|---|---|
| **C12b** — U_A1 UPDATE own issued invoice `status='paid'` through `client_invoices` | FAIL (succeeded) | **PASS — DENIED** (`permission denied for view client_invoices`; DB `status` unchanged at `issued`) |
| **C12c** — U_A1 UPDATE own invoice `amount_received` through the view | FAIL (succeeded) | **PASS — DENIED** (same view-permission error; DB `amount_received` unchanged at `0`) |
| C1 / C1b (×6) — no direct base-table/view-bypass reads | PASS | PASS |
| C6–C11, C13 — curated client read path (own non-draft only, no `internal_notes`/`cancellation_reason`, sibling/cross-firm isolation, draft hidden, RPC denied) | PASS | PASS (unchanged) |
| C12a — client INSERT through the views denied | PASS | PASS |
| S1–S5 — staff permission matrix (partner, no-perm employee, view-only, view+manage pairing) | PASS | PASS |
| I1–I8 — money-path integrity (gapless concurrent issuing, draft-delete no gap, issued/line-item immutability, TDS 194J settlement, cancel-with-receipts rejection, cross-client receipt rejection, fresh-FY gapless audit) | PASS | PASS |

No regression: staff (partner/`billing.view`/`billing.manage`) reads and writes, draft creation + issuing, receipt recording, and draft-invoice DELETE by `billing.manage` are all unchanged and still green.

### 8.2 Out-of-band probes — P1/P2 PASS, **P3 FAILS (new finding)**

The apply-migration prompt asked for three checks the committed suite doesn't cover. Probes were written fresh (a first pass had a seeding bug — a missing `clients.created_by` NOT NULL value caused the throwaway client insert to fail silently, which cascaded into a false pass; corrected before these results were taken):

| Probe | Expected | Actual | Verdict |
|---|---|---|---|
| **P1** — U_A1 `DELETE` own issued invoice via `client_invoices` view | DENIED | `permission denied for view client_invoices`; row untouched | **PASS** |
| **P2** — service-role (RLS-bypassing) direct `DELETE` on a non-draft `firm_invoices` row | REJECTED by `guard_firm_invoice_no_delete` | `Only draft invoices can be deleted — cancel a issued invoice instead`; row untouched | **PASS** |
| **P3** — `firms` `DELETE` cascading to a non-draft `firm_invoices` row (fresh throwaway firm/client/invoice, invoice force-issued via service role) | Cascade succeeds; trigger does not block it | **The `firms` DELETE itself failed** with the same trigger error (`Only draft invoices can be deleted…`); neither the invoice nor the firm was removed | **FAIL** |

P2 confirms the backstop trigger is a real, unconditional guard — it fires even for the service-role client, which bypasses RLS but not triggers, exactly as intended for an "issued invoices are never deleted" invariant. But that same unconditional firing is what breaks P3.

### 8.3 Root cause of the P3 finding

`ON DELETE CASCADE` is implemented by Postgres issuing a real, row-level `DELETE` against the child table (`firm_invoices`) as part of the parent (`firms`) delete — and that row-level `DELETE` fires `BEFORE DELETE` triggers exactly like any other `DELETE`, cascade-originated or not. `guard_firm_invoice_no_delete` (migration 005) has no exception for this: it checks `OLD.status <> 'draft'` unconditionally. So the instant a firm has even one non-draft (issued/partially_paid/paid/cancelled) invoice, `DELETE FROM firms WHERE id = ...` — cascade or direct — raises the trigger's exception and the **entire transaction is rolled back**: the firm is not deleted, the invoice is not deleted, nothing is removed.

This is exactly the interaction the apply-migration prompt asked to verify ("Verify it does not interfere with ON DELETE CASCADE from firms") — and it does interfere. `firm_invoices.client_id` already uses `ON DELETE RESTRICT` (invoices are statutory records; clients aren't hard-deleted per project convention), but `firm_invoices.firm_id` uses `ON DELETE CASCADE` (`schema.sql` — `firm_id UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE`), on the assumption that deleting a firm should sweep all of its data. Migration 005's DELETE guard silently converts that cascade into a hard block for any firm with billing history.

**Whether this is reachable today:** no in-app path hard-deletes a `firms` row (`project_context.md` documents `is_active`-style deactivation, never a firms DELETE, as the house convention for every tenant-scoped entity). So the gap is currently latent — the same "not reachable through the app, only through direct DB access" pattern as the original §7 finding, and the same pattern the §5/§6 storage work also went through. It would surface the moment any future path (an admin hard-delete tool, an account-closure script, GDPR-style erasure, manual cleanup in the SQL editor) tries to delete a firm that has ever issued a single invoice.

### 8.4 Verdict

- **§7's finding is CLOSED.** C12b/C12c now deny as required; P1 (the client-side DELETE variant) also denies. No regression anywhere in the 29-check committed suite or in P2.
- **New architectural finding (P3):** `guard_firm_invoice_no_delete` has no carve-out for cascade-originated deletes, so it also blocks `firms` → `firm_invoices` `ON DELETE CASCADE` once any non-draft invoice exists — a firm with billing history can no longer be hard-deleted at all, through any path, cascade or direct.
- Per session rules, **no fix is proposed here.** The trade-off (e.g., scoping the guard to only reject non-cascade deletes via `pg_trigger_depth()`/`TG_OP` context, vs. deciding firms should never be hard-deleted anyway and documenting that as intentional, vs. some other mechanism) is the user's to make.
- **Cleanup:** the probe's throwaway firm/client/invoice (`99999999-0000-4000-8000-000000000008/…018/…028`) could not be removed by the probe itself — that's the finding in action — and remains live, tagged with the obviously-fake `99999999-…` UUID prefix used nowhere else in the schema, pending a decision on 8.3.
