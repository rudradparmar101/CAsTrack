# Migration 006 Reconciliation

> **Date:** 2026-07-23
> **Type:** Investigation-only session. No DDL applied, no writes of any kind. `migration
> 006`'s file was not edited. `schema.sql` was not edited. Supabase MCP used read-only
> (`execute_sql` with `SELECT`/introspection queries only, `list_tables`, `list_migrations`).
> **Trigger:** Phase 14.1's RLS sweep (`docs/verification/phase-14-rls-sweep.md`) found
> `receipt_history` live and `receipts.invoice_id` nullable on the live project, despite
> `project_context.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, and migration 006's own file
> header all describing it as "drafted, NOT YET APPLIED."

**Bottom line, stated up front: migration 006 was fully applied on 2026-07-18, correctly
folded into `schema.sql` in the same commit, and has never drifted since. The "not applied"
claim is a stale header comment that was never corrected after the fact — not a database
problem. `schema.sql` is a truthful record of the live database, both for migration 006 and
for every other recent migration checked (004, 005, 007, 008, 009). This is scenario (a),
confirmed with direct first-party evidence, not inferred.**

---

## Step 1 — Every object migration 006 creates or alters, checked against the live database

Migration 006 touches exactly 8 kinds of objects. Each was checked via a live, read-only
query (`information_schema`, `pg_catalog`, `pg_get_functiondef`, `pg_get_viewdef`,
`pg_get_triggerdef`) — not by reading `schema.sql` and assuming it's correct.

| # | Object | Migration 006 says | Live database (verified) | Match? |
|---|---|---|---|---|
| 1 | `receipts.invoice_id` nullability | `DROP NOT NULL` | `is_nullable = 'YES'` | ✅ exact |
| 2 | `receipts.invoice_id` column comment | `'NULL = on-account receipt, not yet allocated to any invoice (migration 006, review finding 2). Reflected in client_outstanding as on_account_credit, netted into outstanding.'` | Identical string, verified via `col_description()` | ✅ exact, word-for-word |
| 3 | `guard_receipt()` function | On-account (`NEW.invoice_id IS NULL`) rows skip validation and `RETURN NEW` early | `pg_get_functiondef()` returns byte-identical body (incl. the inline comment `-- on-account: unallocated, nothing to validate against (finding 2)`) | ✅ exact |
| 4 | `handle_receipt_change()` function | Skips `apply_receipts_to_invoice()` for NULL `invoice_id` in both INSERT/UPDATE and DELETE/UPDATE-away directions | `pg_get_functiondef()` byte-identical, including the `OLD` "not assigned yet" comment | ✅ exact |
| 5 | `client_outstanding` view | Rebuilt as `invoice_agg` + `on_account_agg` FULL OUTER JOIN, `on_account_credit` column, `security_invoker = true`, REVOKE/GRANT re-applied | `pg_get_viewdef()` shows the identical CTE structure, identical column list, `FULL JOIN` (Postgres's canonical rendering of `FULL OUTER JOIN` — semantically identical) | ✅ exact |
| 6 | `receipt_history` table | 10 columns (`id`, `firm_id`, `receipt_id`, `operation`, `client_id`, `invoice_id`, `old_data`, `new_data`, `changed_by`, `created_at`), not FK'd to `receipts` | `information_schema.columns` returns the exact same 10 columns, same types, same nullability (`receipt_id`/`client_id` NOT NULL, `invoice_id`/`old_data`/`new_data`/`changed_by` nullable) | ✅ exact |
| 7 | `receipt_history` indexes | `idx_receipt_history_receipt` (on `receipt_id`), `idx_receipt_history_firm` (on `firm_id, client_id`) | Both present via `pg_indexes`, identical `btree` definitions, plus the implicit PK index | ✅ exact |
| 8 | `log_receipt_change()` function + `log_receipt_mutation` trigger | AFTER INSERT/UPDATE/DELETE, writes before/after JSONB snapshots keyed by `TG_OP` | `pg_get_functiondef()` byte-identical; `pg_get_triggerdef()` confirms `CREATE TRIGGER log_receipt_mutation AFTER INSERT OR DELETE OR UPDATE ON public.receipts FOR EACH ROW EXECUTE FUNCTION log_receipt_change()` | ✅ exact |
| 9 | `receipt_history` RLS | `ENABLE ROW LEVEL SECURITY`, exactly 2 SELECT policies (`billing.view` + `is_super_admin()`), **no** INSERT/UPDATE/DELETE policy | `pg_class.relrowsecurity = true`; `pg_policies` returns exactly those 2 policies, both `SELECT`, qual strings match verbatim; zero write policies confirmed | ✅ exact |
| 10 | `has_permission(p_key)` function | `billing.manage` implies `billing.view`, checked before the `user_permissions` override lookup | `pg_get_functiondef()` byte-identical, including the multi-line explanatory comment referencing "migration 006, review finding 4" | ✅ exact |

**Every single object migration 006 defines is present, live, and matches the migration's own
text exactly** — not "close enough," not "mostly there." Function bodies matched down to
inline comments that reference "migration 006" and "review finding N" by name — these are not
generic phrases someone would independently reconstruct; they are specific enough that the
only credible explanation is that the actual migration text (or an exact copy of it) is what
executed.

**No partial-application symptoms found:** no duplicate function overloads (`pg_proc` shows
exactly one signature for each of `guard_receipt`, `handle_receipt_change`,
`log_receipt_change`, `has_permission`, `apply_receipts_to_invoice`), no orphaned old view
definition, no missing index, no missing policy, no stray column. The live `receipts` table
already has 3 on-account (`invoice_id IS NULL`) rows out of 15 total — genuine evidence the
nullable column has been exercised in practice, not merely schema-possible-but-unused (one of
these three is Phase 14.1's own seed row from this week; the others predate it).

---

## Step 2 — Which of (a)/(b)/(c)/(d), with evidence

**It is (a): migration 006 was fully applied in Studio and simply never recorded in the
docs — confirmed directly, not inferred from schema matching alone.**

The decisive evidence is `git log --follow -- supabase/ca-firm/migrations/006_billing_audit_and_pairing.sql`,
which shows **exactly one commit** ever touched this file:

```
commit 45fa98c07b79477305b927849b6eef02f3fb240a
Date:   Sat Jul 18 18:08:58 2026 +0530
    feat(schema): billing audit trail, on-account receipts, billing.manage/view pairing (migration 006)

    Closes Phase 12 review findings 2-4 at the DB level (Phase 14 scope): ...

    Applied to the live Supabase project via Studio; folded into schema.sql
    in the same change per the migrations-land-twice rule.
```

That commit's own message — written contemporaneously, on the day of the work, by the person
who did it — states plainly that the migration **was applied to the live project via Studio**
and **schema.sql was folded in the same commit**. `git show --stat` on that commit confirms
both files changed together: the new migration file (399 lines) and `schema.sql` (+186/−33
lines) in one atomic commit.

**What actually went wrong:** the migration file itself was authored using this project's
standard pre-apply template (the same "NOT YET APPLIED — present to Jay for approval first"
boilerplate every migration file opens with, since the template is written before you know
the outcome) — and **that in-file header was never edited afterward to say "applied," even
though the commit message describing the same change says it was.** `git show 45fa98c` (the
diff, not just the message) confirms the header text was already "NOT YET APPLIED" at the
moment of the very commit that applied it — a same-commit inconsistency between the commit
message (accurate) and the file's own header comment (never updated to match). Every
downstream document — `project_context.md`, `docs/ROADMAP.md`, and the `docs/DECISIONS.md`
entry created five days later on 2026-07-23 (`git log -S "migration 006"` shows the phrase
first entering the docs in that session) — inherited the stale in-file header as if it were
current truth, rather than checking the live database or the commit message.

**Distinguishing (a) from (c):** (c) would require some *other* mechanism having produced
these exact objects — e.g., a different migration file, or hand-typed equivalent SQL. There
is no other migration file in `supabase/ca-firm/migrations/` that touches `receipts`,
`receipt_history`, `client_outstanding`, or `has_permission`'s billing pairing (004 is core
billing, 005 is the view-write-through fix, 007/008/009 are UDIN/DSC/permissions — none
overlap). Combined with the function-body comments matching "migration 006" by name
verbatim and the commit message's explicit first-party claim, (c) has no credible path here.
**Confidence: high, not a guess** — this is not a case where (a) and (c) need to be flagged as
indistinguishable to you; the commit message resolves it.

**(b) partial application:** ruled out — every object matches completely, no orphaned or
half-created pieces found anywhere.

**(d) something else:** not needed — (a) fits every piece of evidence found.

---

## Step 3 — Drift check: is schema.sql trustworthy for 004, 005, 007, 008, 009 too?

Spot-checked the objects most likely to reveal drift for each of these five migrations —
privileges (where this project has a known recurring bug class: Supabase's default
privileges grant `authenticated`/`anon` more than intended on new objects), triggers, columns,
and RLS policies.

| Migration | Object checked | Live result | Matches schema.sql? |
|---|---|---|---|
| 004 | `client_invoices`/`client_invoice_items` grants for `authenticated`/`anon` | `authenticated`: SELECT/REFERENCES/TRIGGER/TRUNCATE only (no DML); `anon`: **zero rows** (no privileges at all) | ✅ matches — migration 004's `REVOKE ALL ... FROM anon, public` is fully in effect |
| 005 | `guard_firm_invoice_no_delete` trigger on `firm_invoices` | Present: `BEFORE DELETE ... EXECUTE FUNCTION guard_firm_invoice_no_delete()` | ✅ matches |
| 005 | `client_invoices`/`client_invoice_items`/`client_outstanding` DML revoke from `authenticated` | Confirmed no INSERT/UPDATE/DELETE grant for `authenticated` on any of the three | ✅ matches |
| 007 | `udin_register` columns + RLS policies | All 13 columns match; 5 policies match exactly (`reports.view`-gated SELECT, partner-only INSERT/UPDATE/DELETE) | ✅ matches |
| 008 | `dsc_register` + `dsc_custody_movements` columns | All columns present on both tables, including `last_expiry_alert_tier`/`last_expiry_alert_sent_for_expiry` | ✅ matches |
| 008 | `dsc_register`/`dsc_custody_movements` RLS policies | `clients.view`-gated SELECT on both, partner-only INSERT/UPDATE on `dsc_register`, no DELETE policy, no write policy at all on `dsc_custody_movements` | ✅ matches |
| 009 | `user_permissions` self-view SELECT policy | `"Employees can view their own permission overrides"` — qual is `(user_id = auth.uid()) AND (get_user_role() = 'employee')` | ✅ matches — the migration-009 fix is live and correctly scoped |

**No divergence found in any of the five migrations checked.** `schema.sql` is a truthful
record of the live database everywhere this session looked.

### One separate finding surfaced while checking privileges (not a 006-vs-live discrepancy)

`client_outstanding`'s live grants include **`anon`: INSERT, DELETE, SELECT, UPDATE** — `anon`
was never revoked from this view, only `authenticated` was (both migration 005's original
REVOKE and migration 006's re-applied REVOKE after the `DROP VIEW`/`CREATE VIEW` explicitly
target `FROM authenticated` only — never `anon`). This is **not** a live-vs-`schema.sql`
mismatch — `schema.sql`'s own `REVOKE INSERT, UPDATE, DELETE ON public.client_outstanding FROM
authenticated;` (line ~1662) has exactly the same narrow scope, so the live grant matches what
`schema.sql` actually says, word for word. The gap is in the *migration/schema text itself*,
not in whether it was applied.

Practical risk is low: `client_outstanding` is `security_invoker`, so an anonymous (unauthenticated)
caller's writes would run under `anon`'s own session — `get_user_firm_id()`/`get_user_client_id()`
resolve `NULL` with no matching `profiles` row, and RLS on the underlying `firm_invoices`/`receipts`
tables default-denies with no policy branch for an unauthenticated caller, so a write would
affect zero rows today. But it's the same class of gap `docs/ROADMAP.md`'s Phase 14.2 already
tracks ("Supabase default privileges grant authenticated full DML on new public objects... audit
all objects for this class of bug") — this narrows that item to note it should also cover `anon`,
not just `authenticated`, and that `client_outstanding` specifically still has the gap even after
two migrations (005, 006) touched its grants. **Not part of this session's fix — recorded for
Phase 14.2.**

---

## Does Phase 14.1's finding list change now that 006's real state is known?

**No finding is retracted, but two findings' context sharpens:**

- **F0 (`apply_receipts_to_invoice()`, critical) is unaffected and unrelated to migration 006's
  content.** Migration 006 modified `handle_receipt_change()` to skip calling
  `apply_receipts_to_invoice()` for on-account (NULL `invoice_id`) rows — it did not touch
  `apply_receipts_to_invoice()` itself, and did not add or remove any ownership check there.
  F0 stands exactly as reported.
- **F1-RPC (`get_firm_plan()`, high) is unaffected.** Not touched by migration 006 at all.
- **The `receipt_history` table (migration 006) is itself a genuinely useful, already-live
  mitigation for a *different*, lower-priority ROADMAP item** — `docs/ROADMAP.md`'s Phase 14.3
  bullet "receipt mutation audit trail — receipts are DELETE/UPDATE-able by billing.manage with
  no history" is **already substantially addressed**, live, today: every receipt
  INSERT/UPDATE/DELETE is logged to `receipt_history` with a full before/after JSONB snapshot,
  trigger-only-writable, `billing.view`-gated read. This was flagged as still-open in Phase
  14.1's writeup and in `docs/ROADMAP.md`'s Phase 14.3 section; it should be marked resolved
  rather than treated as new work.
- **No new finding was introduced by migration 006 itself** — every object it touches was
  re-examined this session and none of them exhibit an F0–F5-style gap (the `has_permission()`
  billing-pairing change is narrow and intentional; `guard_receipt`'s on-account skip is
  correctly scoped to `NEW.invoice_id IS NULL` only; `client_outstanding`'s `security_invoker`
  status means it carries no privilege-escalation risk analogous to F0/F1-RPC even with the
  `anon` grant gap noted above).
- **The one new item this session adds to the list is the `client_outstanding`-anon-grant
  observation above** — low severity, folded into the existing Phase 14.2 default-privileges
  audit item rather than a new numbered finding.

---

## Is schema.sql currently a truthful record of the live DB?

**Yes — confirmed for migration 006 fully, and for 004/005/007/008/009 on every object
checked.** No evidence of drift anywhere this session looked. The failure was entirely at the
documentation layer (stale in-file header text + docs that trusted it without checking the
live database), not at the `schema.sql`-vs-live layer.

---

## Recommended reconciliation

### (i) Doc-only corrections — no DDL, can be approved and applied immediately

1. **`supabase/ca-firm/migrations/006_billing_audit_and_pairing.sql`** — update the header
   (lines 1–9) from "NOT YET APPLIED — present to Jay for approval first" to reflect that it
   was applied 2026-07-18 and folded into `schema.sql` in the same commit (`45fa98c`) —
   matching the header-correction convention already used on migrations 003/005/007/008/009
   after their applications were confirmed.
2. **`project_context.md`** — remove/correct the "Do NOT touch migration 006 (drafted Ph14,
   unapplied)" framing wherever it appears (including the 2026-07-21 truncation note's
   phrasing, which should be split into two facts: the working-tree truncation incident on
   2026-07-21 is real and separate; the "unapplied" characterization it carried is not).
3. **`docs/ROADMAP.md`** — Phase 14.3's first bullet (the migration-006 reconciliation task)
   is now answered: replace it with a note that 006 was confirmed applied 2026-07-18, and move
   its "receipt mutation audit trail" bullet to resolved/done, citing `receipt_history` as the
   already-live mitigation.
4. **`docs/DECISIONS.md`** — the entry added 2026-07-23 correcting the operational-knowledge
   note (from this session's predecessor) should itself be corrected: instead of "needs a
   human reconciliation... possibly a small delta," it can now state definitively that 006 is
   fully applied, dated 2026-07-18, with this document as the evidence trail.
5. Optionally: fold the `client_outstanding`-`anon`-grant observation into Phase 14.2's
   existing "audit all default-privilege grants" bullet, explicitly widening its scope to
   `anon` in addition to `authenticated`.

I have **not** made any of these five edits this session, per the investigation-only scope —
listed here for your approval.

### (ii) Anything requiring DDL — normal Studio gate, not this session

- **`client_outstanding`: `REVOKE INSERT, UPDATE, DELETE ON public.client_outstanding FROM
  anon;`** (one line) — closes the narrow, low-risk privilege-hygiene gap found in Step 3.
  Low priority given `security_invoker` + RLS already blocks any practical exploitation, but
  cheap to close and consistent with the "audit all objects for this class of bug" Phase 14.2
  item. Not drafted as a migration file this session (out of scope — investigation only).
- Everything else Phase 14.1 already found (F0–F5) is untouched by this session and remains
  Phase 14.2's scope, unaffected by migration 006's real status.

---

## Summary

Migration 006 is **fully live**, applied 2026-07-18, matching its own text exactly across
every object it touches, and correctly folded into `schema.sql` in the same commit. The
"drafted, not applied" belief traces to a single in-file header comment that was never
updated after a successful apply, propagated into three separate docs by later sessions that
trusted the header instead of the database. No related drift was found in migrations 004,
005, 007, or 008, or 009 — `schema.sql` is a reliable baseline for Phase 14.2. One small,
low-risk, previously-undiscovered privilege gap (`client_outstanding`'s residual `anon` DML
grants) was found while checking and is recommended for the same Phase 14.2 pass, not treated
as urgent.

**Phase 14.2 can proceed against `schema.sql` as a trustworthy baseline.**
