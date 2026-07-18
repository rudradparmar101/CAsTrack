# Phase 12 scope guards (billing & receivables)

- Fee masters: per-firm rate card, per-client override. SAC 9982 for CA services.
- Invoices: GST-compliant — firm GSTIN, client GSTIN, SAC, CGST/SGST vs IGST by
  place of supply, per-firm gapless invoice number series scoped to financial year.
- Issued invoices are IMMUTABLE. Cancel + reissue, never edit. Legal requirement.
- Receipts: partial payments, allocation against invoices.
- Outstanding ledger: per client, aged buckets.
- TDS u/s 194J: corporate clients deduct 10% on professional fees. The invoice must
  model expected TDS and reconcile receipt shortfall against it. If missed, the
  outstanding ledger is permanently wrong for every corporate client. HIGHEST RISK
  ITEM IN THIS PHASE.
- RLS: clients see only their own invoices; employees gated via has_permission()
  inside RLS as always.
- Razorpay stays OUT (Phase 15). Payments recorded manually in Phase 12.
- Invoice email delivery: build it, but the delivery exit-gate test is deferred
  pending Resend domain verification. Do not block the phase on it.

## Migration-004 review notes (2026-07-17) — constraints on the build phase

- **billing.manage implies billing.view** (review finding 4):
  issue_firm_invoice() is SECURITY INVOKER and opens with SELECT ... FOR
  UPDATE, which needs the firm_invoices SELECT policy — i.e. billing.view.
  An employee granted billing.manage WITHOUT billing.view gets "Invoice not
  found or not accessible" on every issue (partners bypass, so it only
  surfaces for a billing-only clerk). Any path that grants billing
  permissions — the Phase 13 user_permissions editor, verify-script seeding,
  manual service-role grants — MUST grant both keys together. Not fixed at
  the DB level; documented as a pairing rule.
- **tds_expected is write-only in v1** (accepted): nothing reads it — it is a
  display-only expectation; settlement math uses the ACTUAL tds_amount on
  receipts. Revisit if the pilot wants expected-vs-recorded TDS
  reconciliation surfaced.
- **issue_firm_invoice() does not validate place_of_supply / is_interstate**
  (accepted for v1): a GST-invalid invoice (e.g. interstate flag
  contradicting the state codes) can be issued; the UI should default these
  sensibly, but the DB does not enforce them.
- **On-account receipts are OUT of v1** (review finding 2):
  receipts.invoice_id is NOT NULL — an unallocated receipt would be
  invisible to client_outstanding and overstate receivables. Defer pending
  pilot demand.
- **Client invoice reads go through the client_invoices /
  client_invoice_items definer views only** (review finding 1) — the portal
  build must query those views, never firm_invoices/firm_invoice_items
  directly (a client_user gets zero rows from the base tables).

## Migration-005 note (2026-07-18) — definer views are a write path unless revoked

Any future DEFINER-rights view without an INSTEAD OF trigger or WITH CHECK
OPTION is auto-updatable by Postgres. `REVOKE ALL ... FROM anon, public`
does NOT cover `authenticated` — Supabase grants that role full DML on new
`public` objects by default, and `PUBLIC != authenticated`. Migration 005
closed this for client_invoices/client_invoice_items/client_outstanding
(docs/verification/portal-isolation.md §7). Any future definer view MUST
`REVOKE INSERT, UPDATE, DELETE ... FROM authenticated` in the SAME migration
that creates it — recreating a view (e.g. `CREATE OR REPLACE VIEW`) silently
restores default privileges, so the revoke must be re-applied whenever a
view is recreated, not just once at initial creation.
