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
