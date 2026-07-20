# Recon: client-portal invite (prod bug) + invoice GST tax-split — 2026-07-21

> **Session type:** read-only reconnaissance. No code, migrations, or DB writes were made. Supabase MCP was used for schema reads only (`information_schema`, `pg_enum`, and plain `SELECT`s against `firms`) — no DDL/DML/`apply_migration` calls.

---

## Group A — Client portal invite (localhost:3000 link on praxida.in)

### A1. Where the invite URL's origin comes from

`src/app/(dashboard)/clients/portal-actions.ts:77`:

```ts
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const inviteUrl = `${siteUrl}/portal/accept-invite?token=${invitation.token}`;
```

Single env var, `NEXT_PUBLIC_SITE_URL`, with a hardcoded `http://localhost:3000` fallback. The invite modal itself (`clients/[id]/client-detail-client.tsx`) does no URL construction — it just displays `result.data.inviteUrl` verbatim from the action.

**Local `.env.local` currently has:**
```
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

This is the local dev value. The live praxida.in bug (showing a `localhost:3000` link) is exactly what you get if `NEXT_PUBLIC_SITE_URL` is either **unset in Vercel** (fallback fires) or **set to `http://localhost:3000`** there too (e.g. copied from `.env.local` verbatim rather than being overridden per-environment).

**Fix:** in the Vercel project (Production environment, and ideally Preview too with a preview-appropriate value), set:
```
NEXT_PUBLIC_SITE_URL=https://praxida.in
```
No trailing slash (the code does straight string concatenation with a `/` already in the template).

### A2. Does `inviteClientUserAction` call `sendEmail()`?

Yes, genuinely. `portal-actions.ts:82-90`:

```ts
await sendEmail({
  to: trimmedEmail,
  subject: `You're invited to ${firmRow?.name ?? 'your CA firm'}'s client portal`,
  html: portalInviteEmail({
    clientName: client.name,
    firmName: firmRow?.name ?? 'Your CA firm',
    inviteUrl,
  }),
});
```

This is a real Resend send via `lib/email/resend.ts`'s `sendEmail()`, not a stub — Phase 11 wired it. The invite email is genuinely dispatched (subject to A4's caveats about where it lands).

### A3. Is the modal's "Email sending isn't wired up yet" copy stale or accurate?

**Stale.** `client-detail-client.tsx:454-460`:

```tsx
if (inviteUrl) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text)]">
        Invitation created. Email sending isn&apos;t wired up yet — share this
        link with the client directly (valid for 7 days):
      </p>
      ...
```

There is no condition gating this text on whether the send actually happened — it renders unconditionally whenever `inviteUrl` is set (i.e. every successful invite). The email genuinely goes out via Resend as shown in A2; this string is a leftover from before Phase 11 wired `sendEmail()` in and was never updated. It should say something like "An invite email has been sent — you can also share this link directly" (and could be made conditional on `sendEmail` actually succeeding, which it currently has no way to report — see A4's "swallowed errors" point).

### A4. If mail isn't arriving on the live site, causes to check

From code + local `.env.local`, in likely-impact order:

1. **`RESEND_TEST_RECIPIENT` still set in production → HIGH SUSPICION.** `.env.local` has:
   ```
   RESEND_TEST_RECIPIENT=rudradparmar101@gmail.com
   ```
   `lib/email/resend.ts:42-46` redirects *every* send to this address regardless of the real recipient (subject gets a `[to: <real>]` prefix). If this same value is set in Vercel's Production env (plausible — it may have been copied over along with the rest of `.env.local` when deploying), **every client invite email is silently landing in that one Gmail inbox, not the client's**. This is the single most likely explanation and is directly confirmed as a known, tracked gap in `docs/ROADMAP.md` line 71 ("until then every email … is redirected to the test recipient regardless of the real recipient"). **Needs you to check:** the Vercel dashboard's env vars for Production — I cannot read Vercel config from here.
2. **`RESEND_API_KEY` not set in Vercel.** Locally it is set (confirmed present, not printing the value). If it's missing in Vercel, `getClient()` in `resend.ts:24-29` returns `null` and `sendEmail()` just does `console.warn(...)` and returns — **no error surfaces to the UI at all**, the modal would still show the (stale) "isn't wired up" copy and the invite link, and no email would ever leave the server. **Needs you to check:** Vercel env vars.
3. **Resend from-address domain not verified.** `.env.local`'s comment block (`resend.ts:14-20`, `.env.local` inline comment) states the shared `onboarding@resend.dev` sender only delivers to the Resend **account owner's own inbox** until a custom domain is verified — this is a Resend platform restriction, independent of `RESEND_TEST_RECIPIENT`. If `RESEND_FROM_EMAIL` in Vercel is still `Praxida <onboarding@resend.dev>` (or equivalent) and no domain is verified in the Resend dashagement, mail to any client address would fail/bounce even with the API key present and `RESEND_TEST_RECIPIENT` unset. **Needs you to check:** Resend dashboard → Domains.
4. **`sendEmail()` swallows errors — fire-and-forget by design.** `resend.ts:48-53`:
   ```ts
   try {
     const { error } = await resend.emails.send({ from, to, subject, html: params.html });
     if (error) console.error('[email] Send failed:', error);
   } catch (err) {
     console.error('[email] Send failed:', err);
   }
   ```
   Any failure (bad API key, unverified domain, Resend API error) only reaches server logs (Vercel function logs), never the client or the modal. So on live praxida.in you would see the same "invitation created, link shown" UX whether the email sent, failed, or was never attempted. **Needs you to check:** Vercel function logs for `[email] Send failed` entries around invite times.

Summary of what's determinable from code alone vs. what needs your access: (1) and (4) are structural facts about the code, confirmable here; whether (1)/(2)/(3) are *actually* misconfigured in the live environment can only be confirmed by you in Vercel/Resend dashboards.

### A5. Two distinct delivery systems — confirmed

Yes. Supabase Auth's own signup-confirmation email is issued and sent entirely by Supabase's built-in mailer (triggered by `supabase.auth.signUp()` / `admin.generateLink()` flows in `(auth)/signup` and the forgot-password flow before Ph "off-roadmap" branding change) — that path does not touch Resend, `sendEmail()`, or any app code at all for the *signup* case specifically. The client-invite path is entirely the app's own: `client_portal_invitations` insert → `sendEmail()` → Resend SDK → `RESEND_FROM_EMAIL`/`RESEND_TEST_RECIPIENT`. These share no infrastructure. **Signup email arriving live is not evidence the invite path is healthy** — they can fail independently, and right now the invite path has at least one known-bad config (`RESEND_TEST_RECIPIENT`) that the signup path doesn't route through.

**Recommended scope (Group A):** Code-only fix, no migration.
1. Set `NEXT_PUBLIC_SITE_URL=https://praxida.in` in Vercel Production (and a suitable Preview value) — config change, not code.
2. Verify/remove `RESEND_TEST_RECIPIENT` from Vercel Production env, verify `RESEND_API_KEY` is set there, and verify a real sending domain in Resend, then set `RESEND_FROM_EMAIL` to it — config + external service change, not code, but blocks real delivery until done.
3. Update the modal copy in `client-detail-client.tsx` (~line 458) since email genuinely sends now — small code change (string only). Optionally have `inviteClientUserAction` return whether the send actually succeeded (currently `sendEmail()` returns `void` and swallows errors) so the modal can show an accurate "email sent" vs. "email failed, here's the link" state — this is a slightly larger code change (touches `sendEmail()`'s return type and its ~6 call sites) and should be scoped as its own small task, not bundled silently into the copy fix.

---

## Group B — Firm's own GSTIN / state

### B1. Does `firms` store its own GSTIN or state?

`firms` table columns (live schema, via MCP): `id, name, invite_code, frn, gstin, pan, contact_email, contact_phone, address (jsonb), storage_used_bytes, created_at, updated_at`.

So **`firms.gstin` and `firms.pan` already exist as columns** — but there is **no dedicated `state` / `state_code` column** on `firms` (unlike `client_addresses` and `client_registrations`, which both have `state` + `state_code`). `address` is a loose `jsonb` blob with no enforced shape.

Critically: **every firm row in the live DB has `gstin = null`, `pan = null`, `frn = null`** (checked via `SELECT id, name, gstin, pan, frn FROM firms` — all ~58 rows null). There is also **no UI or server action that ever sets these columns** — `provisionCreateFirm()` in `lib/provisioning.ts:84-88` only inserts `{ name: firmName }`, and `settings/settings-page-client.tsx` (the only settings surface) exposes firm rename only, no GSTIN/PAN/FRN/state fields. So the columns exist in the schema but are entirely dead — nothing populates or displays them today.

### B2. Where it would need to go & scope

To auto-derive CGST+SGST vs IGST you need the **firm's own state** (supplier state), which today can only come from the first 2 digits of `firms.gstin` — and that's null for every firm. Scope:

- **Not a migration** for GSTIN/PAN capture itself — `firms.gstin`/`firms.pan` columns already exist; this is purely: (a) add a settings-page form section to let a partner enter/edit them, gated by the existing partner-only settings write path, (b) a server action to update `firms.gstin`/`firms.pan` (currently no action exists to write these columns at all).
- **Is a migration** only if you want an explicit `firms.state` / `firms.state_code` column instead of (or in addition to) deriving state from `gstin[0:2]` — deriving from the GSTIN prefix avoids a schema change but requires the GST-state-code lookup table (see Group E) to translate "24" → "Gujarat", and silently produces nothing if `gstin` is null (which is the case for 100% of firms today, so this is a hard blocker, not an edge case). Recommend: add the settings UI + action for `gstin`/`pan` first (no migration), then decide whether a derived-from-GSTIN helper is sufficient or a first-class `state`/`state_code` column pair is worth the migration for firms that plausibly have no GSTIN (e.g. a very small practice) — worth an explicit product decision, not assumed.

---

## Group C — Invoice tax-split storage & computation

### C1. Separate CGST/SGST/IGST or one combined amount?

**Separate**, confirmed via live schema. `firm_invoices` has all three as distinct `numeric` columns: `cgst_amount`, `sgst_amount`, `igst_amount` (plus `subtotal`, `round_off`, `total_amount`, `is_interstate boolean`, `place_of_supply`, `place_of_supply_state_code`, `firm_gstin`, `client_gstin`). `firm_invoice_items` stores per-line `taxable_value` and `gst_rate` (a single combined rate per line, e.g. 18) — the CGST/SGST/IGST split only happens at the invoice-header level, not per line item.

### C2. Where is tax actually computed?

**In the DB function**, `public.issue_firm_invoice()` (`supabase/ca-firm/schema.sql:1431-1491`), not in the app. Quoting the computation (lines 1455-1483):

```sql
SELECT COUNT(*), COALESCE(SUM(taxable_value), 0),
       COALESCE(SUM(ROUND(taxable_value * gst_rate / 100, 2)), 0)
  INTO v_items, v_subtotal, v_gst
FROM public.firm_invoice_items WHERE invoice_id = p_invoice_id;
...
v_raw_total := v_subtotal + v_gst;
v_total     := ROUND(v_raw_total, 0);  -- round to whole rupee
...
UPDATE public.firm_invoices
SET ...
    subtotal       = v_subtotal,
    cgst_amount    = CASE WHEN is_interstate THEN 0 ELSE ROUND(v_gst / 2, 2) END,
    sgst_amount    = CASE WHEN is_interstate THEN 0 ELSE v_gst - ROUND(v_gst / 2, 2) END,
    igst_amount    = CASE WHEN is_interstate THEN v_gst ELSE 0 END,
    round_off      = v_total - v_raw_total,
    total_amount   = v_total
WHERE id = p_invoice_id
RETURNING * INTO v_inv;
```

The app (`invoice-form.tsx`) only computes a **preview** subtotal/GST total client-side for display (lines 52-53: `subtotal`/`gstTotal` reduces over `items`) before the draft is created — the authoritative computation and the CGST/SGST/IGST split happen only when the draft is issued, entirely inside this one SQL function.

### C3. Does `is_interstate` actually switch the computation, or is it stored and ignored?

**It genuinely switches the computation** — this contradicts the "may not validate" framing in the context doc's risk list, or rather: the *computation* is correct and driven by `is_interstate`; what's missing is *validation that `is_interstate` was set correctly in the first place*. The `CASE WHEN is_interstate THEN ... ELSE ...` branches shown above are exactly the intrastate/interstate split logic, and they do fire correctly — verified by reading the function body (not by running it, per the read-only constraint of this session).

The actual gap: **nothing checks that `is_interstate` is *consistent* with the firm's and client's actual GST states.** `is_interstate` is a free-standing checkbox in `invoice-form.tsx:133-136`:

```tsx
<label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
  <input type="checkbox" checked={isInterstate} onChange={(e) => setIsInterstate(e.target.checked)} />
  Interstate supply (IGST instead of CGST+SGST)
</label>
```

set entirely by the person creating the invoice, with no cross-check against `firm_gstin`'s state-code prefix vs `client_gstin`'s (or `place_of_supply_state_code`'s) state-code prefix. So a user can tick "interstate" for a same-state client (or leave it unticked for a genuinely interstate client) and `issue_firm_invoice()` will faithfully compute the *wrong* split with no error, since the DB function has no way to know it's wrong — it trusts the flag. This is the real crux: **the switch works; the input to the switch is unvalidated and currently manual.**

### C4. `place_of_supply` / `place_of_supply_state_code` — validated or free text?

Free text, both in the DB (`text` columns, no CHECK, no FK to any state-code table) and in the UI — `invoice-form.tsx:118-131`:

```tsx
<Input label="Place of Supply" value={placeOfSupply} onChange={...} placeholder="e.g. Gujarat" />
<Input label="State Code" value={placeOfSupplyStateCode} onChange={...} placeholder="e.g. 24" />
```

Plain `<Input>` text fields, not a `<Select>` bound to a canonical state list. Nothing stops a typo, a mismatched name/code pair (e.g. "Gujarat" + state code "07"), or leaving both blank while still ticking "interstate."

**Recommended scope (Group C):** No migration needed — all the columns Group C needs already exist and are already wired correctly end-to-end in `issue_firm_invoice()`. The work is entirely **code-only, app-layer validation/UX**: (a) add the GST state-code list (Group E) and turn `place_of_supply`/`place_of_supply_state_code` into a linked dropdown instead of two free-text inputs; (b) once Group B's firm-state and Group D's client-state are available, auto-derive `is_interstate` (firm state ≠ client/place-of-supply state) as a default the user can still override, and/or add a soft warning when the manual checkbox disagrees with the derived value, rather than silently trusting the checkbox as today.

---

## Group D — Place-of-supply defaulting from the client

### D1. Does a client have a usable "state"?

Yes, in two places, both already in the live schema:
- **`client_addresses.state` / `state_code`** — per Group A/B schema dump: `type text NOT NULL DEFAULT 'registered'`, `state text NOT NULL`, `state_code text NULL`. `ADDRESS_TYPE_OPTIONS` in `lib/ca-options.ts:28-29` includes a `'registered'` type, so a client's registered-office state is capturable (state is `NOT NULL`, state_code is nullable/optional today).
- **`client_registrations.state` / `state_code`** — for `type = 'gstin'` rows specifically (the `registration_type` enum has `gstin, tan, pf, esi, pt, other`), each with its own nullable `state`/`state_code` — since a client can hold multiple GSTINs in different states (already flagged as a known modeling point elsewhere in `project_context.md`), this is the more GST-correct source for "which state is this invoice's place of supply" than the single registered address, if the client is billed against a specific GSTIN.

### D2. Is there an existing client → `place_of_supply` link?

**No.** Confirmed in `invoice-form.tsx`: `placeOfSupply`/`placeOfSupplyStateCode` are local `useState('')`, populated by nothing when `clientId` changes — no `useEffect` keyed on the selected client, no default pulled from `client_addresses` or `client_registrations`. Selecting a client only auto-fills `client_gstin` (line 75: `client_gstin: selectedClient?.gstin || null` — and note this reads `clients.gstin` directly, not `client_registrations`, so it's the client's single primary GSTIN field on the `clients` table itself, not the multi-registration table). Place of supply is always typed manually today, independent of which client/GSTIN was selected.

**Recommended scope (Group D):** No migration — both candidate source columns already exist. Code-only: when a client is selected in `invoice-form.tsx`, look up either their `'registered'` `client_addresses` row or (better, if invoicing is tied to a specific GSTIN) their `client_registrations` row of `type='gstin'`, and prefill `place_of_supply`/`place_of_supply_state_code` (still editable) instead of leaving them blank. This is a reasonably small addition (one query + one effect) but depends on a product decision: prefill from the client's registered address, or from a specific selected GSTIN registration if the client has more than one — the latter needs a GSTIN-picker UI that doesn't exist on the invoice form today.

---

## Group E — State code list

### E1. Does a GST state-code constant already exist?

**No.** Grepped `lib/ca-options.ts` and the rest of `src/lib/` for any `state_code`/`STATE_CODE`/`GST_STATE` constant or a recognizable state name (`Chhattisgarh`, `Puducherry`, etc.) — no matches anywhere in `src/`. `lib/types.ts` only has `state_code: string | null` as a *type* field on `ClientAddress`/`ClientRegistration`/invoice records — no accompanying value list exists to validate or drive a dropdown against.

**Recommended scope (Group E):** Code-only, no migration. A future build session should add the standard 38-entry Indian GST state/UT code list (e.g. `01` Jammu & Kashmir … `97` Other Territory, `99` Centre Jurisdiction) as a plain constant module (mirroring the `ADDRESS_TYPE_OPTIONS` pattern in `ca-options.ts`), then wire it into: the firm-settings GSTIN state derivation (Group B), the client address/registration state fields (already free-text `state`/`state_code` today — worth checking whether those forms also lack a dropdown, out of this recon's scope but likely the same pattern), and the invoice form's place-of-supply field (Group C/D). Not added now, per the read-only constraint of this session.

---

## Summary table

| Group | Root cause | Migration needed? |
|---|---|---|
| A — localhost invite link | `NEXT_PUBLIC_SITE_URL` missing/wrong in Vercel Production; fallback is `localhost:3000` | No — env var config only |
| A — invite email not arriving | Most likely `RESEND_TEST_RECIPIENT` set in prod redirecting all sends to one inbox; possibly also missing `RESEND_API_KEY` or unverified sending domain; failures are silently swallowed | No — env/Resend-dashboard config; optional code change to stop swallowing errors |
| A — stale modal copy | Copy never updated after Ph11 wired real `sendEmail()` | No — one string change |
| B — firm GSTIN/state | Columns exist (`gstin`,`pan`) but are null for every firm and nothing writes them; no `state`/`state_code` column at all | No, for GSTIN/PAN capture (settings UI + action). Yes, only if a first-class `state`/`state_code` column is chosen over GSTIN-prefix derivation |
| C — tax split storage/computation | Already correctly implemented (separate CGST/SGST/IGST columns, correct `is_interstate` branch in `issue_firm_invoice()`); the real gap is that `is_interstate`/place-of-supply are manually entered and unvalidated | No — app-layer validation/autofill only |
| D — place-of-supply defaulting | Client state exists in `client_addresses`/`client_registrations` but is never read by the invoice form | No — app-layer autofill only |
| E — state code list | Does not exist anywhere in the codebase | No — new constants module |

**Net finding: none of Groups B–E require a migration.** All underlying columns needed already exist in the live schema; every fix here is app-layer code (forms, server actions, a new constants file) plus, for Group A, Vercel/Resend environment configuration that only you can apply.
