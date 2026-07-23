# Application-Layer Security Audit

> **Date:** 2026-07-24
> **Type:** Audit-only session. **No code was changed, no migration written, no dependency
> updated, `npm audit fix` was never run.** Supabase access was read-only throughout
> (`SELECT` against `storage.buckets`, `storage.objects`, `pg_constraint` only).
> **Scope:** the APPLICATION layer — server actions, route handlers, middleware, the upload
> path, email rendering, dependencies, error surfaces. Phase 14 covered the *database* access
> model (RLS, policies, `SECURITY DEFINER` functions) and explicitly could not claim anything
> about this layer. This audit is that gap.
> **Method:** every finding below cites a file and line. Where a claim could be checked against
> something real rather than reasoned about, it was: the client bundle was scanned for the
> actual secret values from `.env.local`; the whole 103-commit git history was scanned for
> secret patterns; a signed storage URL was fetched and its response headers read; production
> response headers were fetched from `praxida.in`; DB `CHECK` constraints were enumerated from
> `pg_constraint` rather than from `schema.sql`. Anything reasoned rather than executed is
> labelled **(reasoned, not probed)**.

---

## 0. Headline

**No CRITICAL finding. Nothing needed a stop-the-session escalation.**

- **No secret has ever been committed** — verified across all 103 commits, not taken from
  `project_context.md`'s word.
- **No secret is reachable from the client bundle** — verified by scanning the built output for
  the literal key values, not by reading imports.
- **No unauthenticated route exposes tenant data** — every API route either 401s without a
  bearer secret (confirmed live against production) or is a public auth flow.
- The dual-layer design (app guard + RLS) holds: **every one of the 40 exported server actions
  has an authentication guard, and every mutating one has a permission or role check.** Not one
  missing guard was found. That is a genuinely good result and the single most important thing
  this audit set out to test.

The real findings are concentrated in three places Phase 14 had no reason to look at: **the
upload path trusts the client's declared file type completely**, **email HTML is built by string
concatenation with zero escaping**, and **the deployed Next.js version is 7 patch releases
behind 22 published advisories**.

**One HIGH, six MEDIUM, eight LOW, five informational.**

---

## 1. Findings, ranked

### H1 — HIGH — Next.js 16.2.4 is running in production with 22 published advisories, including two rated ≥8.0

**Evidence:** `package.json:15` pins `"next": "16.2.4"` exactly. `npm audit` reports 22
advisories against that version. The two highest:

| Advisory | CVSS | What it is |
|---|---|---|
| `GHSA-c4j6-fc7j-m34r` | **8.6** | SSRF in applications using WebSocket upgrades |
| `GHSA-492v-c6pp-mqqv` | **8.1** | Middleware/Proxy bypass via dynamic route parameter injection |
| `GHSA-267c-6grr-h53f`, `GHSA-26hh-7cqf-hhc6` | 7.5 | Middleware/Proxy bypass via segment-prefetch routes |
| `GHSA-955p-x3mx-jcvp` | — | Unauthenticated disclosure of internal Server Function endpoints |
| `GHSA-8h8q-6873-q5fj`, `GHSA-mg66-mrh9-m8jx`, `GHSA-m99w-x7hq-7vfj` | 7.5 | Various DoS (Server Components, Cache Components, Server Actions) |

**Exploitability, honestly assessed:** the middleware-bypass class is the one that names this
app's own architecture — `src/middleware.ts` → `src/lib/supabase/middleware.ts` is the
unauthenticated-redirect and role-routing gate. **But a middleware bypass alone does not leak
tenant data here**, and that is worth stating plainly because it is the payoff of a design
decision this project already made: `src/app/(dashboard)/layout.tsx:15-17` independently
redirects any `client_user` away from the staff surface, every page calls `getAuthContext()`
(`src/lib/auth.ts:33-35`) which redirects on no session, and RLS is the final authority. An
attacker who fully defeats middleware still hits three more layers. The SSRF advisory does not
apply — this app has no WebSocket upgrade handling and no `rewrites`. The DoS advisories are
real and unmitigated.

So the severity is HIGH not because a specific exploit chain to tenant data was demonstrated,
but because an internet-facing framework is 22 advisories and 7 patch releases behind with a
**non-breaking fix available**, and that is not a defensible position for a product about to
onboard paying firms.

**Recommended fix:** `npm i next@16.2.11 eslint-config-next@16.2.11`. npm reports this as
`isSemVerMajor: false` — it is a **patch bump inside the same minor**, `16.2.4 → 16.2.11`. React
19.2.4 is untouched by it. npm's "outside the stated dependency range" warning is purely because
the version is pinned exactly with no caret; it is not a signal of breakage risk. The session
brief's caution about Next 16 / React 19 being version-sensitive is well-founded in general but
does not apply to this particular bump.
**Effort: 30 minutes** (bump, `npm run build`, `npm run lint`, smoke the auth flows). Do this
first; it is the highest value-per-minute item in the whole audit.

---

### M1 — MEDIUM — The upload path performs no file-type validation of any kind, and signed URLs serve the client-declared Content-Type inline

**Evidence:**
- `src/lib/documents/actions.ts:36-41` — `getValidFile()` checks presence and size. **That is
  the entire validation.** No extension allowlist, no MIME allowlist, no magic-byte sniffing.
- `src/lib/documents/actions.ts:118` and `:222` — `upload(filePath, file, { contentType:
  file.type || 'application/octet-stream' })`. `file.type` is whatever the client put in the
  multipart part's `Content-Type`. It is stored verbatim as the object's mimetype.
- Storage bucket has no backstop either — **verified live** via `select ... from storage.buckets`:
  `client-documents` has `allowed_mime_types = null` and `file_size_limit = null`.
- `src/components/documents-section.tsx:225-235` and `:244-254` render the download as a plain
  `<a href={signedUrl} target="_blank">` — **no `download` attribute**, and `createSignedUrl()`
  is called without `{ download: true }` in all five call sites
  (`src/app/(dashboard)/clients/[id]/page.tsx:99`, `src/app/(dashboard)/tasks/[id]/page.tsx:136`,
  `src/app/portal/actions.ts:64`, `src/app/portal/page.tsx:73`,
  `src/app/portal/tasks/[id]/page.tsx:74`).

**Probed, not assumed:** a signed URL was generated for an existing object and fetched. The
response was `200` with `content-type: text/plain` and **no `Content-Disposition` header at
all** and no `X-Content-Type-Options: nosniff`. So Supabase serves the stored content-type
inline. An object uploaded as `text/html` or `image/svg+xml` will render and execute JavaScript
when a user clicks Download.

**Exploitability:** any authenticated uploader, **including a `client_user`** — the portal
upload path requires no permission key at all (`src/lib/documents/actions.ts:69-73`, access is
structural). Upload `invoice.pdf` with the multipart `Content-Type` set to `text/html`; a staff
member clicks Download; attacker JavaScript executes.

**Why MEDIUM and not HIGH:** the execution origin is `fwmmdyebvzncpezdwnxm.supabase.co`, not
`praxida.in`. The app's session lives in cookies on `praxida.in`, so the injected script cannot
read it, cannot touch the app's DOM, and cannot act as the victim. It *is* same-origin with the
Supabase REST/Auth API, but there is no session material in that origin to steal and migration
017 already revoked `anon`'s table grants. The realistic impact is a convincing phishing or
malware-delivery page hosted under a domain the victim's own CA firm told them to trust, plus
arbitrary-file hosting. That is real and worth fixing; it is not tenant-data exfiltration.

**Recommended fix (three parts, all cheap):**
1. Set `allowed_mime_types` on the `client-documents` bucket to the document types the product
   actually accepts (`application/pdf`, `image/png`, `image/jpeg`, the Office types, `text/csv`).
   This is a bucket-config change, one line, no migration. It alone closes the vector.
2. Pass `{ download: file_name }` to `createSignedUrl()` at all five call sites, which makes
   Supabase serve `Content-Disposition: attachment` — nothing renders inline, ever.
3. Add an extension + declared-MIME allowlist in `getValidFile()`. Magic-byte sniffing is the
   textbook answer but is genuinely optional once (1) and (2) are in place, since neither
   depends on the client's claim being honest.
**Effort: 2–3 hours** for all three.

---

### M2 — MEDIUM — Email HTML is assembled by string concatenation with zero escaping; user-controlled values reach client inboxes

**Evidence:** `src/lib/email/templates.ts` — **every** interpolation is raw. `layout()` at
`:18` (`preheader`), `:25` (`firmName`), `:30` (`heading`), `:31` (`bodyHtml`), `:35`
(`ctaUrl`/`ctaLabel`). There is no `escapeHtml()` in the file or anywhere in `src/`.

The values flowing in are all user-controlled:

| Value | Who controls it | Which email it reaches |
|---|---|---|
| `taskTitle` | any staff with `tasks.create` | `statutoryReminderEmail:99-102`, `waitingClientNagEmail:174-177` → **the client's inbox** |
| `clientName` | any staff with `clients.manage` | reminder, nag, invoice, portal invite |
| `firmName` | set at signup (`signup/actions.ts:29`) or by a partner (`settings/actions.ts:51`) | every template |
| `message` / `title` | rejection reasons, comment text, document names | `notificationEmail:64` |
| `holderName` | `dsc_register` writer | `dscExpiryAlertEmail:156-158` |

**Exploitability:** a task titled
`</strong></p><a href="https://evil.example/gst-portal">Verify your GST credentials</a><p>`
produces a phishing link embedded inside a legitimate, DKIM-signed email sent from the firm's
own verified `mail.praxida.in` domain, addressed to that firm's client, in the firm's branding.
Email clients strip `<script>`, so this is not classic XSS — it is HTML/link injection into a
trusted channel, which for a CA-firm product handling statutory credentials is arguably worse.
The precondition is a malicious or compromised staff account within one firm; the victims are
that firm's clients.

`ctaUrl` is app-constructed at every call site (`siteUrl + path`), so attribute-breakout via
`ctaUrl` is not reachable today — but nothing structurally prevents a future call site from
passing user data there.

**Recommended fix:** one `escapeHtml()` helper (`& < > " '`) applied to every interpolation
except `bodyHtml` (which is template-authored HTML by design), plus a URL-scheme check on
`ctaUrl`. This is a ~20-line change confined to one file with no call-site changes.
**Effort: 1 hour.**

---

### M3 — MEDIUM — `changePasswordAction` changes the password without re-authentication

**Evidence:** `src/app/(dashboard)/settings/actions.ts:77-101`. It reads `new_password` and
`confirm_password`, checks length ≥ 8 and equality, then calls
`supabase.auth.updateUser({ password })`. **It never asks for or verifies the current
password**, and there is no re-auth challenge, no session-recency requirement, and no
invalidation of the user's other sessions.

**Exploitability:** anyone holding a stolen session cookie — from an XSS, a shared/unlocked
machine, or a leaked device — converts a temporary session into permanent account takeover in
one request, and simultaneously locks the legitimate owner out. This is the standard escalation
step after any session compromise, and it is what the "verify current password" control exists
to block.

**Recommended fix:** require `current_password` and verify it with a
`signInWithPassword({ email, password: current })` call against the user's own email before
calling `updateUser`. Optionally enable Supabase Auth's `secure_password_change` project setting,
which enforces recent re-auth server-side.
**Effort: 1–2 hours** (action + form field + the error path).

---

### M4 — MEDIUM — Password floor is 6 characters, with no complexity, length ceiling, or breach check

**Evidence:** `src/lib/auth/password-policy.ts:7-12` — `password.length < 6`. Used by
`signup/actions.ts:36` and `reset-password/actions.ts`. `accept-invite/actions.ts:39-41`
hardcodes its own duplicate `< 6` check instead of calling the shared validator.
`settings/actions.ts:86` uses a *third*, different rule (`< 8`) — the policy module's own
comment at `:3-6` acknowledges this divergence.

**Exploitability:** six characters is below every current baseline (NIST SP 800-63B says 8
minimum; OWASP ASVS L1 says 12 for a new application). This product stores clients' PAN, GSTIN,
TAN, CIN, DSC custody records, and invoice data — a compromise is a data-protection incident for
the firm's clients, not just for one user. There is no compensating control at the app layer:
`/login` is deliberately outside this project's rate limiter
(`docs/DECISIONS.md`, 2026-07-24), so the only brute-force resistance is Supabase's own native
Auth rate limiting, which this project neither configures nor verifies.

**Recommended fix:** raise `validatePassword()` to 12 characters minimum with a 72-byte ceiling
(bcrypt's limit), have all three call sites use it, and mirror the same minimum in Supabase Auth's
project password settings so a direct API signup can't bypass the app. Deliberately *not*
recommending composition rules (upper/lower/digit/symbol) — length alone outperforms them and
NIST now advises against them.
**Effort: 1 hour** for the code; the Supabase Auth setting is a ⚠ HUMAN dashboard change.

---

### M5 — MEDIUM — No rate limit on any authenticated action, including the two that send email to caller-chosen addresses

Migration 019 covered public endpoints thoroughly and verified them live. **Zero authenticated
actions are rate-limited.** `grep` for `checkRateLimit` in `src/` returns hits only in
`signup/actions.ts`, `forgot-password/actions.ts`, `accept-invite/actions.ts`, and the
accept-invite page.

Most authenticated actions genuinely don't need one — a `clients.manage` employee creating
clients one at a time is bounded by RLS and by being a real employee. The brief asked where a
limit is *justified*, so here is the honest short list rather than a blanket recommendation:

| Action | File | Why it justifies a limit | Suggested bucket |
|---|---|---|---|
| **`inviteClientUserAction`** | `clients/portal-actions.ts:23-92` | **The strongest case.** The `email` argument is caller-supplied and is *not* checked against the client's stored email — a `clients.manage` holder can send a branded, DKIM-signed email from `mail.praxida.in` to any address on the internet, one per call, unbounded. This is an open email relay through the firm's sending reputation. It also writes an invitation row each time. | 20/hr/user **and** 50/hr/firm |
| **`commitClientImportAction`** | `clients/import-actions.ts:132-199` | Up to 500 sequential single-row INSERTs per call, each a network round trip, with no cap on call frequency. The 500-row cap bounds one call, nothing bounds the loop. | 10/hr/user |
| **`generateStatutoryTasksAction`** | `compliance/actions.ts:17` | Partner-only, but it walks every active client × every applicable compliance type across every department, on demand. Expensive and idempotent, so repeat calls are pure waste. | 6/hr/firm |
| `issueInvoiceAction` | `billing/actions.ts:140-182` | Sends an email per call and advances the firm's gapless invoice counter. Lower priority — the counter is the natural constraint and a fake issued invoice is a within-tenant integrity problem, not abuse. | 60/hr/firm |
| `uploadDocumentAction` | `documents/actions.ts:56` | Storage consumption is unbounded per user. Better addressed by Phase 15's plan/storage enforcement than by a request limiter. | defer to Phase 15 |

Everything else — task CRUD, comments, permission edits, DSC movements, receipts, fee masters —
does **not** warrant a limiter. Adding one there would be ceremony.

**On the fixed-window limiter: I agree, don't replace it.** Exponential backoff would buy
nothing here. The existing `check_rate_limit()` is atomic (proved at 40 concurrent callers
landing at exactly 20/20), fail-open by deliberate design, and verified against real production
traffic including a header-spoofing test. Its only real weakness is the boundary burst inherent
to fixed windows (up to 2× the limit across a window edge), which is irrelevant at these
thresholds. Rewriting a verified production control to fix a non-problem is the wrong trade.
No argument to make against the guardrail.

**Effort: 3–4 hours** for the three justified buckets, reusing `checkRateLimit()` as-is. The
only new piece is identifying by `userId`/`firmId` instead of IP, which the existing generic
`(action, identifier)` signature already supports with no schema change.

---

### M6 — MEDIUM — Thresholds are hardcoded at call sites; no single place to see or change them

**Evidence:** the eight live limits are literals scattered across four files —
`signup/actions.ts:42` (`20, 3600`), `:113` (`30, 3600`), `:133` (`20, 3600`),
`forgot-password/actions.ts:53-54` (`8, 3600` / `15, 3600`),
`accept-invite/actions.ts:45` (`20, 3600`), plus the accept-invite page's own copy of the same
bucket. The `auth_signup` limit appears **twice** with the same numbers, and the
`accept_invite_lookup` limit appears twice — already two pairs that can silently drift.

This is not a vulnerability; it is the maintenance hazard that produced this project's own
migration-header incident (a value duplicated in two places, one updated, one not).

**Recommended approach — a constants module, not DB-backed config.** Add
`src/lib/rate-limit-config.ts`:

```ts
export const RATE_LIMITS = {
  auth_signup:          { max: 20, windowSeconds: 3600 },
  invite_code_lookup:   { max: 30, windowSeconds: 3600 },
  forgot_password_email:{ max: 8,  windowSeconds: 3600 },
  forgot_password_ip:   { max: 15, windowSeconds: 3600 },
  accept_invite_lookup: { max: 20, windowSeconds: 3600 },
} as const;

export type RateLimitAction = keyof typeof RATE_LIMITS;
```

and narrow `checkRateLimit(action: RateLimitAction, identifier: string)` to look the numbers up
itself. The win beyond deduplication is that the action name becomes a **union type**, so a typo
in an action string becomes a compile error instead of a silently-separate bucket — which is the
one failure mode of this design that would be invisible in production.

**Why not DB-backed config:** it would add a read (or a cache with its own invalidation
problem) to the hot path of every public endpoint, and it would put the rate limiter's own
configuration inside the system the limiter protects — so a DB problem degrades the control
twice. These thresholds change roughly never; the deploy cycle is an appropriate change
control for them. If per-firm limits are ever needed (a plausible Phase 15 SaaS-tier feature),
revisit then — the table already exists and the RPC signature already takes the limit as an
argument, so the migration path stays open.
**Effort: 1–2 hours.**

---

### M7 — MEDIUM — No `Content-Security-Policy` and no frame-ancestors control in production

**Evidence — measured, not assumed.** `curl -D -` against `https://praxida.in/login` returns:

```
Strict-Transport-Security: max-age=63072000     ← present (Vercel default)
```

and **no** `Content-Security-Policy`, **no** `X-Frame-Options`, **no**
`X-Content-Type-Options`, **no** `Referrer-Policy`. `next.config.ts` has no `headers()` function
at all — it contains only a `turbopack.root` setting and a stray
`console.log("[next.config] ...")` at line 3.

**Exploitability:** the app can be iframed by any origin. The dashboard carries one-click
destructive controls — deactivate client, cancel invoice, delete draft invoice, revoke
permission, deactivate DSC — all of which are clickjackable against a logged-in partner.
Missing CSP additionally means there is no second line of defence if an XSS is ever introduced
(the `dangerouslySetInnerHTML` at `src/app/layout.tsx:41` is a static theme-bootstrap literal
with no user data, so it is safe today — but a CSP is what makes that guarantee durable).

`Access-Control-Allow-Origin: *` appears on prerendered pages; this is Vercel's default for
static assets and is **not** a finding — CORS without credentials cannot read authenticated
responses, and it was confirmed that `/dashboard` 307s to `/login` for an unauthenticated
caller.

**Recommended fix:** a `headers()` block in `next.config.ts` setting `X-Frame-Options: DENY`
(or `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, and
`Referrer-Policy: strict-origin-when-cross-origin`. A full CSP needs a nonce strategy because
of the inline theme script — worth doing, but scope it separately and expect to iterate against
report-only mode first.
**Effort: 1 hour** for the three simple headers; **1 day** for a real CSP with nonces.

---

### L1 — LOW — Open redirect in `/auth/callback` and `/auth/confirm` via the `next` parameter

**Evidence:** `src/app/auth/callback/route.ts:22` reads `next` from the query string and `:56`
does `NextResponse.redirect(`${origin}${target}`)`. `src/app/auth/confirm/route.ts:22` and `:35`
are the same shape. `next` is never validated.

**Verified by execution** (`node -e` over the exact concatenation):

```
"/dashboard"       -> https://praxida.in/dashboard        => host: praxida.in   ✓
"//evil.com"       -> https://praxida.in//evil.com        => host: praxida.in   ✓ (safe)
"@evil.com"        -> https://praxida.in@evil.com         => host: evil.com     ✗ OPEN REDIRECT
```

`next=@evil.com` makes `praxida.in` the URL's *userinfo* and `evil.com` the host.

**Exploitability — LOW, and the reason matters:** the redirect only fires *after* a successful
`exchangeCodeForSession(code)` / `verifyOtp(token_hash)`. On failure both routes redirect to a
safe hardcoded path. So an attacker must supply a valid one-time code or recovery token. The
realistic chain is an attacker minting a code for *their own* account and sending a victim
`.../auth/callback?code=<attacker's>&next=@evil.com` — session fixation plus off-site redirect.
Convoluted, but it is a real unvalidated redirect and the fix is three lines.

**Recommended fix:** `const next = raw?.startsWith('/') && !raw.startsWith('//') ? raw :
'/dashboard'` in both routes.
**Effort: 15 minutes.**

---

### L2 — LOW — Raw Postgres/PostgREST error messages are returned to the UI from ~50 call sites

**Evidence:** 50 occurrences of `error: error.message` (or `error?.message ||`) across the
action files. `rlsFriendly()` maps only the PGRST116 shape — its own body
(`billing/actions.ts:38-43` and four identical copies) is:

```ts
if (!message || message.includes('0 rows') || message.includes('multiple (or no) rows')) {
  return 'You do not have permission to make this change.';
}
return message;   // ← everything else goes to the user verbatim
```

So a `CHECK` violation surfaces as
`new row for relation "receipts" violates check constraint "receipts_amount_check"`, an RLS
denial on INSERT as `new row violates row-level security policy for table "clients"`, and a
trigger's `RAISE EXCEPTION` text verbatim. Many call sites don't even go through `rlsFriendly()`
— `documents/actions.ts:111,124,142,225,248`, `billing/actions.ts:96,116,134,146,197,235`,
`settings/actions.ts:27,69,97`, `notifications-actions.ts:24,45`.

**Exploitability — genuine information disclosure, but narrow.** This discloses table names,
constraint names, and policy existence to an **already-authenticated tenant user**. It does not
disclose data, file paths, stack traces, connection strings, or another tenant's anything. For
a single-tenant-per-firm SaaS where the schema is not a secret, this mostly aids an attacker
already inside a firm in mapping the schema faster.

**Explicitly checked and NOT a finding — stack traces in production.** Next.js's own docs
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:106-111`)
state that thrown Server Component errors are replaced in production with a generic message plus
a `digest` identifier. `src/app/(dashboard)/error.tsx:31` renders `error.message`, which reads
alarming, but in a production build that message is already the redacted one. **The distinction
that matters: Next's redaction covers *thrown* errors only. The 50 sites above are ordinary
return values, so they are entirely unaffected by it** — which is exactly why this is still a
finding.

**Recommended fix:** one shared `friendlyDbError()` in `src/lib/` that maps known Postgres
`code`s (`23505` unique, `23503` FK, `23514` check, `42501`/RLS, `P0001` raise) to human text
and returns a generic string plus a `console.error` for everything else. Replace all five
`rlsFriendly()` copies with it.
**Effort: 3–4 hours.**

---

### L3 — LOW — `STAFF_ROUTE_PREFIXES` is stale: `/billing`, `/compliance`, `/dsc`, `/udin` are missing

**Evidence:** `src/lib/supabase/middleware.ts:6-13` lists `/dashboard`, `/tasks`, `/clients`,
`/team`, `/templates`, `/settings`. Four staff routes added in Phases 10, 12, 12.5, and 13.2
were never added.

**Consequence, traced through carefully rather than assumed:**
- **Unauthenticated access is still blocked** — the guard at `:85` is a negative check
  (`!isPublicPage`), and `/billing` is not on the public list, so it still redirects to `/login`.
- **A `client_user` hitting `/billing` is not caught by middleware's role routing** (`:94`,
  which requires `isStaffRoute`). They are caught one layer later by
  `src/app/(dashboard)/layout.tsx:15-17`, which redirects `client_user` to `/portal`
  unconditionally.

**So this is not exploitable.** It is a stale list whose comment claims to enumerate "the
staff-only surface" while missing a third of it — and the next route added under `(dashboard)`
will inherit the same omission silently.

**Recommended fix:** add the four prefixes. Better: derive `isStaffRoute` from a single exported
constant that the sidebar nav also consumes, so the two can't diverge.
**Effort: 30 minutes.**

---

### L4 — LOW — `parseAddresses()` will throw on a non-string field value, unlike its two sibling parsers

**Evidence:** `src/app/(dashboard)/clients/actions.ts:107-134`. It casts
`entry as Record<string, string>` and calls `a.line1?.trim()` directly. Its siblings
`parsePersons()` (`:154-177`) and `parseRegistrations()` (`:199-233`) correctly guard every field
with `typeof p.x === 'string'` first.

**Exploitability:** posting `addresses=[{"type":"registered","line1":5,"city":"x","state":"y"}]`
throws `TypeError: a.line1.trim is not a function`, which is an unhandled server-action error →
500 with a digest. No data exposure (production redaction applies, see L2), no persistence.
It is a robustness gap and the clearest single illustration of the "hand-rolled validators drift"
problem.

**Recommended fix:** add the `typeof === 'string'` guards to match the siblings.
**Effort: 20 minutes.**

---

### L5 — LOW — The advertised 10 MB upload limit is unreachable; the real ceiling is 1 MB

**Evidence:** `src/lib/documents/actions.ts:29` sets `MAX_DOCUMENT_SIZE = 10 * 1024 * 1024` and
`:39` returns `'File exceeds the 10MB size limit.'`. But `next.config.ts` sets no
`serverActions.bodySizeLimit`, and Next's own docs
(`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:26`)
state the default body limit is **1 MB**. The framework rejects the request before the app's
check ever runs.

**Security-wise this is protective, not harmful** — the effective server-side limit is *tighter*
than advertised, and the DoS concern the brief raised (unbounded upload) does not exist. But it
is a real product bug: a 2 MB scanned PDF, which is entirely normal for this domain, fails with a
confusing framework error rather than the app's friendly message. Flagged here because the
security review is where the discrepancy surfaced.

**Recommended fix:** decide the real limit, then set `serverActions.bodySizeLimit` to match
`MAX_DOCUMENT_SIZE` (and set the bucket's `file_size_limit` to the same number as the
server-side backstop, alongside M1's `allowed_mime_types`).
**Effort: 30 minutes** plus a real-file test.

---

### L6 — LOW — No length ceiling on any free-text field

**Evidence:** `title`, `description`, `period_label` (`tasks/actions.ts:132-145`), `line1`/`city`
(`clients/actions.ts:125-133`), `notes`, `service_name` (`billing/actions.ts:256-263`),
`rejection_reason` (`documents/actions.ts:331`) are all trimmed and stored with no maximum. DB
columns are `TEXT` with only `length(trim(...)) > 0` checks (confirmed via `pg_constraint`).

**Exploitability:** an authenticated user can store ~1 MB per field (bounded only by the action
body limit from L5), repeatedly. Storage-cost abuse within a tenant, plus UI breakage. Low, and
partly Phase 15's storage-enforcement territory.

**Recommended fix:** ceilings in the shared validators — 200 for titles/names, 5,000 for
descriptions/notes.
**Effort: 1 hour.**

---

### L7 — LOW — `gst_rate` accepts any value 0–100, not the statutory GST slabs

**Evidence:** `billing/actions.ts:71-75` validates `description`, `quantity > 0`, and
`rate >= 0` — **`gst_rate` is not validated at all** and is inserted raw at `:107`. The DB's only
guard (confirmed live) is
`firm_invoice_items_gst_rate_check: gst_rate >= 0 AND gst_rate <= 100`. Similarly `tds_expected`
(`:88`) is unvalidated in the app; the DB requires `>= 0`.

**Exploitability:** requires `billing.manage` — an authorised user producing a statutorily
invalid invoice against their own firm's clients. Not a security boundary crossing; a GST
compliance-correctness gap on a document the firm issues to a client.

**Recommended fix:** validate `gst_rate` against `[0, 5, 12, 18, 28]` in
`createDraftInvoiceAction`, matching how `validateFeeMasterInput()` (`:256-263`) already
whitelists `periodicity`.
**Effort: 30 minutes.**

---

### L8 — LOW — `recordReceiptAction` does not verify that `client_id` matches `invoice_id`'s client

**Evidence:** `billing/actions.ts:204-240` inserts `client_id` and `invoice_id` straight from the
caller. `firm_id` comes from the guard, so cross-firm is closed by that plus RLS. But nothing
checks that the supplied `client_id` is the invoice's own client, at either layer.

**Exploitability:** a `billing.manage` holder can record a receipt against invoice X while
labelling it client Y within the same firm. `apply_receipts_to_invoice()` sums by `invoice_id` so
the invoice settles correctly, but `client_outstanding` and the receipts ledger are polluted.
Within-tenant integrity, not a boundary crossing.

**Note on the app-layer check that is there:** `:218` guards
`input.amount + input.tds_amount <= 0`. Because the values arrive from the client with no runtime
type check, string inputs make this concatenate rather than add (`"100" + "0"` → `"1000"`, which
is not `<= 0`). **This is not exploitable** — verified against `pg_constraint`, the DB enforces
`receipts_amount_check (amount >= 0)`, `receipts_tds_amount_check (tds_amount >= 0)`, and
`receipts_check ((amount + tds_amount) > 0)`. The dual-layer principle holds; the app-layer half
is just decorative here, and the failure surfaces as a raw constraint message (L2).

**Recommended fix:** resolve the invoice's `client_id` server-side and use it, ignoring the
caller's value entirely. Cheaper and stronger than validating it.
**Effort: 30 minutes.**

---

### Informational — noted, no fix recommended

- **`rlsFriendly()` is copy-pasted five times** — `billing/actions.ts:38`, `dsc/actions.ts:59`,
  `tasks/actions.ts:66`, `team/permissions-actions.ts:47`, `udin/actions.ts:32`. Identical bodies
  bar one string. Folded into L2's fix.
- **Non-constant-time secret comparison** — `api/cron/*/route.ts:30`
  (`authHeader !== \`Bearer ${secret}\``) and `api/telegram/webhook/route.ts:14`. Timing attacks
  against 48-char secrets over the public internet through Vercel's edge are not practical.
  `crypto.timingSafeEqual` if it ever feels cheap; not worth scheduling.
- **The Telegram webhook is correctly gated twice** — secret header *and* `chat.id === TG_CHAT`
  (`route.ts:14, 23`), and it returns data only to the operator's own Telegram chat, never in the
  HTTP response. It fails closed when `TG_WEBHOOK_SECRET` is unset. This route uses
  `createAdminClient()` and reads across all firms, so it was checked hard. **It is sound.**
- **No error boundary outside `(dashboard)`** — only `src/app/(dashboard)/error.tsx` exists; no
  `global-error.tsx`, and none for `/portal` or `(auth)`. A thrown error in the portal falls back
  to Next's default page. Production redaction still applies, so this is UX, not disclosure.
- **`arn` and unvalidated pagination `offset`** — `tasks/actions.ts:370-374` writes
  `filingOutcome.arn` with no format check (`filed_date` is caught by the DATE column). `offset`
  is unvalidated in all four `fetchMore*Action`s. React escapes on render, so no XSS; a negative
  offset yields a raw PostgREST error (L2). Cosmetic.

---

## 2. Category-by-category summary

### 1. Rate limiting — gaps only
Public endpoints confirmed complete and verified. **Zero authenticated actions limited.** Three
justified additions identified with thresholds (M5); a constants-module design proposed over
DB-backed config with reasoning (M6). Explicit agreement with the guardrail: do not replace the
fixed-window limiter.

### 2. Input validation
**Better than expected, and the FormData-JSON path specifically is not a trust gap.** All three
JSON payloads (`addresses`, `authorized_persons`, `registrations`) are `JSON.parse`'d inside
`try`, array-checked, and field-by-field validated against enum whitelists and the shared
regexes from `ca-options.ts` — `clients/actions.ts:92-236`. Invoice line items are validated at
`billing/actions.ts:71-75`. Task fields are enum- and date-regex-checked at
`tasks/actions.ts:108-146`. Task list filters go through an explicit whitelist
(`parseTaskFilters`).

Gaps found: `parseAddresses`'s missing type guards (L4), unvalidated `gst_rate`/`tds_expected`
(L7), receipt client/invoice consistency (L8), no length ceilings (L6), unvalidated `arn` and
`offset` (informational).

**On adding zod — recommended, but at LOW priority and for a specific reason.** The existing
manual validation is adequate *in coverage*; not one field reaches the DB genuinely unchecked in
a way the DB doesn't also catch. The argument for zod is not that it would find a hole the
current code misses — it is that the current code has **three near-identical parsers that have
already drifted** (L4 is exactly that drift, and `rlsFriendly` × 5 is the same pattern in the
error path). A schema library makes drift structurally impossible rather than a matter of
remembering. Introduce it on the next form-touching feature rather than as a big-bang refactor
of working, verified code.
**Effort if done: 1–2 days** for all action entry points.

### 3. Secrets — clean
- **Git history:** all 103 commits scanned for JWT (`eyJ...`), `sb_secret_`/`sb_publishable_`,
  `re_*`, `sk_live`/`sk_test`, `rzp_*`, and `postgres://user:pass@` patterns. **Zero hits.**
  Every path ever added matching `.env|secret|credential|.pem|.key` — **none.** `.env*` is
  gitignored (`.gitignore:32`). `project_context.md`'s claim is confirmed independently.
- **Client bundle:** the literal values of `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
  `CRON_SECRET`, and `TG_TOKEN` were extracted from `.env.local` and grepped across `.next/` and
  `.next/static/`. **Zero hits anywhere.** No `'use client'` file imports
  `supabase/admin`/`createAdminClient`/`lib/auth`.
- **`NEXT_PUBLIC_*` inventory** — only four exist: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`. All three are public by design (the
  anon key is meant to ship to browsers; migration 017 revoked `anon`'s table grants).
- **`scripts/verify/*.mjs`** — none hardcode a key. All route through `lib/env.mjs`, which reads
  `.env.local` at runtime (`env.mjs:9-31`). `lib/admin.mjs:6` takes the key from that module.
- **No hardcoded credential anywhere in `src/` or `scripts/`.**

### 4. Dependencies
7 advisories, 6 high + 1 low. Full triage:

| Package | Sev | Path | Real exploit path for THIS app? | Fix |
|---|---|---|---|---|
| **`next` 16.2.4** | high | **direct, prod** | **Yes — see H1** | `16.2.11`, **patch, safe** |
| `sharp` 0.34.5 | high | `next` → prod | **Barely.** `next/image` is used nowhere in `src/`. `/_next/image` still exists but has no `remotePatterns`, so only same-origin inputs; on Vercel, optimization runs on Vercel infra, not this bundled `sharp`. | rides the `next` bump |
| `postcss` 8.4.31 / 8.5.14 | high | `next` + `@tailwindcss/postcss` | **No — build-time only.** Both advisories need attacker-controlled CSS; this app compiles only its own. Never in the runtime bundle. | rides the `next` bump |
| `ws` 8.20.0 | high | `@supabase/supabase-js` → `realtime-js` → **prod** | **No.** Both advisories require connecting to a hostile WebSocket peer. The app never calls `.channel()`/`.subscribe()` anywhere, so the code path is dead. Browsers use native WebSocket regardless. | `npm audit fix`, non-breaking |
| `js-yaml` 4.1.1 | high | `eslint` → **dev only** | **No.** Not deployed. | dev noise |
| `brace-expansion` | high | `eslint`/`typescript-eslint` → **dev only** | **No.** Not deployed. | dev noise |
| `@babel/core` 7.29.0 | low | `eslint-plugin-react-hooks` → **dev only** | **No.** Not deployed. | dev noise |

**Bottom line: one of seven matters.** Three are dev-only and never ship; three more are prod-tree
but on dead or build-time-only code paths. `npm audit fix` was **not** run, per the guardrail.

### 5. Error handling
**No stack traces, file paths, or connection strings reach the UI** — verified against Next's own
production-redaction behaviour rather than assumed (L2). The real gap is ~50 explicitly-returned
raw DB messages, which redaction does not touch. `rlsFriendly()` maps only PGRST116 and passes
everything else through verbatim. Severity LOW: schema-name disclosure to an already-authenticated
tenant user, not data disclosure.

### 6. File upload safety

| Question asked | Answer |
|---|---|
| Type validated by magic bytes, or extension/MIME? | **Neither.** No validation of any kind — not extension, not MIME, not content. Bucket-level `allowed_mime_types` is also `null` (verified live). |
| Size limit, server-side? | Yes, `10 MB` at `documents/actions.ts:39` — but unreachable behind Next's 1 MB body default (L5). Bucket `file_size_limit` is `null`. |
| Can an upload execute? | **Yes, cross-origin.** Signed URLs serve the client-declared Content-Type with **no `Content-Disposition`** (probed live, not assumed). Private bucket + 1-hour expiry limits *who* gets the URL; it does nothing about *how the browser renders it* once they have it. That distinction is the finding (M1). |
| Filename sanitized / path traversal? | **Filename is not sanitized, but traversal is not achievable.** `storagePath()` (`:31-34`) discards the basename entirely for `crypto.randomUUID()` and keeps only `fileName.split('.').pop()`. Because the split delimiter is `.`, any `..` in the input collapses into empty segments — `pop()` can never return a string containing `..`. Traced through several crafted inputs. A crafted extension *can* inject extra `/` segments, but only *below* the document's own folder, so storage RLS's path-segment `[3]` document-id check (migration 012) is unaffected. **Not a finding.** |

### Also-checked
- **CSRF: in effect, no bypass.** Next compares a server action's `Origin` against the host by
  default; `next.config.ts` sets no `serverActions.allowedOrigins`, so only same-origin is
  accepted. The API routes are outside that protection but are `GET` + bearer-secret gated
  (`/api/cron/*` — **confirmed live: `401` unauthenticated**) or dual-secret gated
  (`/api/telegram/webhook`), and a browser-driven CSRF cannot attach either header.
- **XSS: one `dangerouslySetInnerHTML`, safe.** `src/app/layout.tsx:41` is a static theme
  bootstrap literal with no interpolation. No `innerHTML`, no `eval`, no `new Function`
  anywhere. React escapes all rendered user content. The real injection surface is the email
  templates (M2), not the app.
- **Auth checks: all 40 exported server actions have a guard.** Every one begins with
  `getAuthProfile()`/`getAuthContext()` (which redirect on no session) or an explicit
  `auth.getUser()` null check. Every mutating action additionally carries a role check or a
  `has_permission()` RPC call — `requireBillingManage`, `requireClientsManage`,
  `requireTeamManage`, `requireTemplatesManage`, `requireDscManage`, `requireClientsView`,
  `requirePartner`, `requireStaff`, `requireClientUser`, or an inline equivalent. Every page
  under `(dashboard)` also carries its own guard, on top of the layout's `client_user` redirect.
  **No missing check was found.**

---

## 3. What was audited vs. what was not

**Audited in full:** all 21 `actions.ts`/`route.ts` files and both `*-actions.ts` files (4,920
lines); `middleware.ts` + `lib/supabase/middleware.ts`; `lib/auth.ts`; `lib/rate-limit.ts`;
`lib/documents/actions.ts`; `lib/email/templates.ts` + `resend.ts`; `lib/supabase/admin.ts`;
`lib/csv.ts`; `lib/auth/password-policy.ts`; `next.config.ts`; all 13 `(dashboard)` `page.tsx`
guards; all 51 `'use client'` files (import-graph check only); the full git history; the built
client bundle; `npm audit` in full; live production response headers; live `storage.buckets` /
`storage.objects` / `pg_constraint` state.

**Not audited — stated precisely rather than glossed:**
1. **The `/login` client-side auth call.** `(auth)/login/page.tsx` calls
   `signInWithPassword()` directly from the browser, so it never reaches this server and has no
   server-side surface to audit. Already recorded as a deliberate exception in
   `docs/DECISIONS.md` (2026-07-24). M4's password-floor finding is the part of it that *is*
   app-layer.
2. **Supabase Auth project settings** — JWT lifetime, refresh-token rotation, session timeout,
   the project's own password requirements, MFA availability, and the Redirect URLs allow-list
   are all dashboard configuration, not code. They are a real part of the app-layer posture and
   they were **not** inspected. ⚠ HUMAN.
3. **No finding was exploited end-to-end.** M1's stored-XSS would require uploading a crafted
   HTML file to the production bucket — a write, which the audit-only guardrail forbids. The
   *serving* half was proved live (headers on an existing object); the *upload* half is
   **(reasoned, not probed)** from the unvalidated `contentType` pass-through at
   `documents/actions.ts:118`. A fix session should prove it before and after.
4. **Client components were checked only for server-only imports and XSS sinks**, not reviewed
   line by line for logic flaws. Client-side logic is not a security boundary here (every
   mutation re-checks server-side), so this is a deliberate scope call, not an omission.
5. **`REFERENCE_ARCHITECTURE.md` and the 212 KB `project_context.md` were not read in full** —
   only `AGENTS.md`, `ROADMAP.md`, `DECISIONS.md`, and `phase-14-rls-sweep.md`, per the session
   brief. If either contains an app-layer security assertion, it was not cross-checked.
6. **No load/DoS testing** of the unlimited authenticated actions in M5 — the need for a limiter
   is argued from the code path, not measured.

---

## 4. Recommended fix order

Ordered by value per unit of effort, not strictly by severity.

| # | Item | Sev | Effort | Why here |
|---|---|---|---|---|
| 1 | **Bump Next to 16.2.11** (H1) | HIGH | 30 min | Highest severity, smallest change, non-breaking patch. Nothing else competes on ratio. |
| 2 | **Bucket `allowed_mime_types` + `{download}` on signed URLs** (M1, parts 1–2) | MED | 1 hr | Closes the stored-XSS vector completely without touching the upload code. |
| 3 | **Escape HTML in `templates.ts`** (M2) | MED | 1 hr | One file, no call-site changes, removes a phishing channel that reaches clients. |
| 4 | **Security headers in `next.config.ts`** (M7, the three simple ones) | MED | 1 hr | Kills clickjacking against destructive dashboard controls. Defer full CSP. |
| 5 | **Require current password on change** (M3) | MED | 1–2 hr | Blocks the standard post-session-theft escalation. |
| 6 | **Raise the password floor to 12** (M4) | MED | 1 hr + ⚠ HUMAN | Do the Supabase Auth setting in the same pass, or the app check is bypassable via the API. |
| 7 | **Fix the open redirect** (L1) | LOW | 15 min | Trivially cheap; batch it with #4. |
| 8 | **Rate-limit `inviteClientUserAction`, `commitClientImportAction`, `generateStatutoryTasksAction`** (M5) | MED | 3–4 hr | The invite relay is the one with real external blast radius. |
| 9 | **`rate-limit-config.ts` constants module** (M6) | MED | 1–2 hr | Do it in the same session as #8 while the call sites are already open. |
| 10 | **Upload extension allowlist + body-size-limit reconciliation** (M1 part 3, L5) | MED/LOW | 2 hr | L5 is a product bug found by this audit; fix it with the upload work, not separately. |
| 11 | **Shared `friendlyDbError()`, retire the five `rlsFriendly()` copies** (L2) | LOW | 3–4 hr | Larger touch surface; genuine UX win alongside the security one. |
| 12 | **`parseAddresses` type guards, `gst_rate` slabs, receipt client consistency, `STAFF_ROUTE_PREFIXES`, length ceilings** (L3, L4, L6, L7, L8) | LOW | 3 hr total | Batch as one cleanup commit. |
| 13 | **Introduce zod on the next form-touching feature** | — | 1–2 days | Deliberately last, and deliberately incremental — the value is preventing future drift, not fixing a present hole. |

**Not recommended:** replacing the fixed-window rate limiter; `npm audit fix --force`; a
big-bang validation-library refactor of code that is currently working and verified.
