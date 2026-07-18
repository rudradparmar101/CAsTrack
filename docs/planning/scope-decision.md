# Praxida — Scope Decision (2026-07-16)

## Context
Competitive scan of Indian CA practice-management SaaS (QwikCA, ATOM by Vider,
Zoho Practice, Jamku, PracticeStacks, Turia, WebLedger). Findings:

- The category is mature, not empty. 10+ credible players. Novelty is not a wedge.
- Price is not a wedge: Zoho Practice is free to 3 users; QwikCA is ~Rs.100-120/user/month.
- QwikCA's marketing site is far ahead of its product: self-described beta,
  contradictory traction claims (230+ firms vs "thousands"), 13 Trustpilot reviews,
  unreplaced dev-platform template boilerplate still live on their docs site,
  and an offer to custom-build features free on request. Their published feature
  list is a roadmap presented as shipped. We are closer to level than it appears.
- Real constraint is willingness to pay, not competition: ~100,000 CA firms in
  India, ~72,000 sole proprietorships, mostly low-margin.

## FLOOR — required to be demo-credible (not optional)
- Billing + GST-compliant invoicing (Phase 12)
- Credentials vault + DSC register + expiry alerts (Phase 13)
- ARN/acknowledgment capture (Phase 12.5)
- UDIN register — ICAI mandatory (Phase 12.5)
- Bulk client import from Excel (Phase 12.5)
- WhatsApp client comms — deferred; interim is wa.me click-to-chat deep links

## WEDGE — the one differentiator
Notices & litigation lifecycle (Phase 13.5). Rationale: only ATOM seriously serves
it; the pain is acute and expensive (143(1)/139(9)/148/ASMT-10/DRC-01 response
windows); our existing architecture already fits it (handle_task_stage() stage
machine, calendar-driven non-suppressing generation, idempotent period keys);
and unlike the rest of the category it does not require GST/IT portal access,
so our biggest weakness does not bite.

Positioning: "Everyone tracks your filings. We track what happens when the
department writes back."

GATED: do not build until >=15 real CA firm conversations confirm notice deadline
pain. If they do not, the wedge is wrong — re-scope the wedge, not the project.
