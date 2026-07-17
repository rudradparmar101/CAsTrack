// Phase 12 — committed role-JWT RLS + money-path suite for CLIENT BILLING
// (migration 004_client_billing.sql).
//
// Like 07-storage-visibility.mjs this is self-seeding and re-runnable against
// the live project: service-role for seeding, anon-key signInWithPassword
// sessions for every assertion — the database's own RLS/triggers are what is
// tested, never the app layer.
//
// WHAT IT PROVES (and why the view checks are PRIMARY, not regression)
//   Migration 004 introduced an architectural exception: client access to
//   invoices does NOT go through RLS at all. client_users have NO policy on
//   any billing table; their only read path is the DEFINER-rights views
//   client_invoices / client_invoice_items, whose baked-in predicate
//   (client_id = get_user_client_id() AND status <> 'draft') plus explicit
//   safe column list is the sole authority. Nothing had ever attacked that
//   path before this suite — every view assertion here is a primary check of
//   a new mechanism, not a re-confirmation of an old pass.
//
//   The money-path (integrity) half attacks the DB-enforced legal properties:
//   gapless per-firm-per-FY numbering under concurrency, draft deletion never
//   gapping the series, issued-invoice immutability, line-item freeze, TDS
//   u/s 194J settlement (90% cash + 10% TDS ⇒ paid), cancel-with-receipts
//   rejection, and guard_receipt's cross-client rejection.
//
// SEEDING NOTES
//   - Issued invoices are IMMUTABLE, so fixed-UUID invoice rows are ensured
//     with insert-if-absent (an upsert's UPDATE arm would trip the guard
//     trigger on re-run). Fixed drafts stay drafts forever; fixed issued
//     invoices are issued once (first run) via a partner session.
//   - Money-path tests need pristine settlement state, so they mint FRESH
//     random-UUID invoices every run (issued rows can never be reset — by
//     design). Re-runs therefore append a handful of tagged issued invoices
//     per run to the seed firm's series; they are inert throwaway rows and
//     the gapless audit at the end covers all of them.
//   - The fixed receipt on invA1Issued keeps it 'partially_paid' (500 of
//     5900) so the frozen-column test always runs against a non-draft row
//     and the client positive check sees a stable status.

import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminClient, signInAs } from './lib/admin.mjs';
import { log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');

const TAG = 'bilrls1';
const PASSWORD = 'PortalIso123!';
const FY = '2026-27';

// Fixed UUIDs → insert-if-absent idempotency (see header).
const ID = {
  firmA: 'a0000000-0000-4000-8000-00000b110001',
  firmB: 'b0000000-0000-4000-8000-00000b110001',
  clientA1: 'a0000000-0000-4000-8000-00000b11c0a1', // has portal user U_A1
  clientA2: 'a0000000-0000-4000-8000-00000b11c0a2', // sibling; portal user U_A2
  clientA3: 'a0000000-0000-4000-8000-00000b11c0a3', // dedicated to the settlement test (outstanding must read zero)
  clientB1: 'b0000000-0000-4000-8000-00000b11c0b1', // cross-firm; portal user U_B1
  feeFirm: 'a0000000-0000-4000-8000-00000b11fee1',
  feeClient: 'a0000000-0000-4000-8000-00000b11fee2',
  invA1Draft: 'a0000000-0000-4000-8000-00000b11d0a1', // stays draft forever (draft-invisibility check)
  invA1Issued: 'a0000000-0000-4000-8000-00000b11e0a1',
  invA2Issued: 'a0000000-0000-4000-8000-00000b11e0a2',
  invB1Issued: 'b0000000-0000-4000-8000-00000b11e0b1',
  itemA1Draft: 'a0000000-0000-4000-8000-00000b111aa1',
  itemA1Issued: 'a0000000-0000-4000-8000-00000b111aa2',
  itemA2Issued: 'a0000000-0000-4000-8000-00000b111aa3',
  itemB1Issued: 'b0000000-0000-4000-8000-00000b111ab1',
  receiptA1Fixed: 'a0000000-0000-4000-8000-00000b11ec01', // 500 on invA1Issued ⇒ stable partially_paid
};

const EMAIL = {
  pa: `${TAG}.pa@example.com`, // Firm A partner
  e0: `${TAG}.e0@example.com`, // Firm A employee, NO billing permission
  ev: `${TAG}.ev@example.com`, // Firm A employee, billing.view only
  em: `${TAG}.em@example.com`, // Firm A employee, billing.view + billing.manage
  uA1: `${TAG}.ua1@example.com`, // portal user, client A1
  uA2: `${TAG}.ua2@example.com`, // portal user, client A2 (sibling)
  pb: `${TAG}.pb@example.com`, // Firm B partner
  uB1: `${TAG}.ub1@example.com`, // portal user, Firm B / client B1
};

const results = [];

// ── seed helpers ────────────────────────────────────────────────────────────

async function ensureUser(admin, email, metadata) {
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (!created.error) return created.data.user.id;
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < perPage) break;
    page += 1;
  }
  throw new Error(`ensureUser: could not create or find ${email}: ${created.error.message}`);
}

async function up(admin, table, row, onConflict = 'id') {
  const { error } = await admin.from(table).upsert(row, { onConflict });
  if (error) throw new Error(`upsert ${table}(${row.id ?? onConflict}): ${error.message}`);
}

// Insert-if-absent — for rows an upsert must never UPDATE (issued invoices
// are immutable; their guard trigger would reject the upsert's UPDATE arm).
async function ensureRow(admin, table, row) {
  const { data, error: selErr } = await admin.from(table).select('id').eq('id', row.id).maybeSingle();
  if (selErr) throw new Error(`ensureRow select ${table}(${row.id}): ${selErr.message}`);
  if (data) return false;
  const { error } = await admin.from(table).insert(row);
  if (error) throw new Error(`ensureRow insert ${table}(${row.id}): ${error.message}`);
  return true;
}

async function seed(admin) {
  await up(admin, 'firms', { id: ID.firmA, name: `${TAG} Firm A` });
  await up(admin, 'firms', { id: ID.firmB, name: `${TAG} Firm B` });

  const paId = await ensureUser(admin, EMAIL.pa, { name: 'PA', role: 'partner', firm_id: ID.firmA });
  const e0Id = await ensureUser(admin, EMAIL.e0, { name: 'E0', role: 'employee', firm_id: ID.firmA });
  const evId = await ensureUser(admin, EMAIL.ev, { name: 'EV', role: 'employee', firm_id: ID.firmA });
  const emId = await ensureUser(admin, EMAIL.em, { name: 'EM', role: 'employee', firm_id: ID.firmA });
  const uA1Id = await ensureUser(admin, EMAIL.uA1, { name: 'UA1', role: 'client_user', firm_id: ID.firmA, client_id: ID.clientA1 });
  const uA2Id = await ensureUser(admin, EMAIL.uA2, { name: 'UA2', role: 'client_user', firm_id: ID.firmA, client_id: ID.clientA2 });
  const pbId = await ensureUser(admin, EMAIL.pb, { name: 'PB', role: 'partner', firm_id: ID.firmB });
  const uB1Id = await ensureUser(admin, EMAIL.uB1, { name: 'UB1', role: 'client_user', firm_id: ID.firmB, client_id: ID.clientB1 });

  await up(admin, 'profiles', { id: paId, firm_id: ID.firmA, name: 'PA', email: EMAIL.pa, role: 'partner' });
  await up(admin, 'profiles', { id: e0Id, firm_id: ID.firmA, name: 'E0', email: EMAIL.e0, role: 'employee' });
  await up(admin, 'profiles', { id: evId, firm_id: ID.firmA, name: 'EV', email: EMAIL.ev, role: 'employee' });
  await up(admin, 'profiles', { id: emId, firm_id: ID.firmA, name: 'EM', email: EMAIL.em, role: 'employee' });
  await up(admin, 'profiles', { id: pbId, firm_id: ID.firmB, name: 'PB', email: EMAIL.pb, role: 'partner' });

  await up(admin, 'clients', { id: ID.clientA1, firm_id: ID.firmA, name: `${TAG} Client A1`, business_type: 'pvt_ltd', created_by: paId });
  await up(admin, 'clients', { id: ID.clientA2, firm_id: ID.firmA, name: `${TAG} Client A2`, business_type: 'proprietorship', created_by: paId });
  await up(admin, 'clients', { id: ID.clientA3, firm_id: ID.firmA, name: `${TAG} Client A3 (settlement)`, business_type: 'pvt_ltd', created_by: paId });
  await up(admin, 'clients', { id: ID.clientB1, firm_id: ID.firmB, name: `${TAG} Client B1`, business_type: 'individual', created_by: pbId });

  // Portal profiles after clients (profiles.client_id FK).
  await up(admin, 'profiles', { id: uA1Id, firm_id: ID.firmA, name: 'UA1', email: EMAIL.uA1, role: 'client_user', client_id: ID.clientA1 });
  await up(admin, 'profiles', { id: uA2Id, firm_id: ID.firmA, name: 'UA2', email: EMAIL.uA2, role: 'client_user', client_id: ID.clientA2 });
  await up(admin, 'profiles', { id: uB1Id, firm_id: ID.firmB, name: 'UB1', email: EMAIL.uB1, role: 'client_user', client_id: ID.clientB1 });

  // Employee permission overrides: billing.* is employee-default FALSE, so E0
  // needs no row; EV gets view; EM gets view+manage (finding 4's pairing).
  const grant = (userId, key) =>
    up(admin, 'user_permissions', { user_id: userId, permission_key: key, granted: true, granted_by: paId }, 'user_id,permission_key');
  await grant(evId, 'billing.view');
  await grant(emId, 'billing.view');
  await grant(emId, 'billing.manage');

  // Rate card: one firm-wide row + one client override (staff-only reads).
  await up(admin, 'fee_masters', { id: ID.feeFirm, firm_id: ID.firmA, client_id: null, service_name: `${TAG} GST filing`, amount: 2000, periodicity: 'monthly' });
  await up(admin, 'fee_masters', { id: ID.feeClient, firm_id: ID.firmA, client_id: ID.clientA1, service_name: `${TAG} GST filing`, amount: 1500, periodicity: 'monthly' });

  // Fixed invoices: inserted as drafts (insert-if-absent), issued below by
  // partner sessions on first run only.
  const draft = (id, firmId, clientId, createdBy, notes) => ({
    id, firm_id: firmId, client_id: clientId, financial_year: FY,
    status: 'draft', created_by: createdBy,
    internal_notes: notes, tds_expected: 0,
  });
  await ensureRow(admin, 'firm_invoices', draft(ID.invA1Draft, ID.firmA, ID.clientA1, paId, `${TAG} SECRET draft note — must never reach a client`));
  await ensureRow(admin, 'firm_invoices', draft(ID.invA1Issued, ID.firmA, ID.clientA1, paId, `${TAG} SECRET internal note on issued invoice`));
  await ensureRow(admin, 'firm_invoices', draft(ID.invA2Issued, ID.firmA, ID.clientA2, paId, `${TAG} A2 internal note`));
  await ensureRow(admin, 'firm_invoices', draft(ID.invB1Issued, ID.firmB, ID.clientB1, pbId, `${TAG} B1 internal note`));

  const item = (id, firmId, invoiceId, rate) => ({
    id, firm_id: firmId, invoice_id: invoiceId, description: `${TAG} professional fees`,
    quantity: 1, rate, taxable_value: rate, gst_rate: 18,
  });
  await ensureRow(admin, 'firm_invoice_items', item(ID.itemA1Draft, ID.firmA, ID.invA1Draft, 3000));
  await ensureRow(admin, 'firm_invoice_items', item(ID.itemA1Issued, ID.firmA, ID.invA1Issued, 5000)); // total 5900
  await ensureRow(admin, 'firm_invoice_items', item(ID.itemA2Issued, ID.firmA, ID.invA2Issued, 4000));
  await ensureRow(admin, 'firm_invoice_items', item(ID.itemB1Issued, ID.firmB, ID.invB1Issued, 2500));

  return { paId, e0Id, evId, emId, uA1Id, uA2Id, pbId, uB1Id };
}

// Issue the fixed invoices through real staff JWTs (SECURITY INVOKER — the
// partner's own RLS governs). Skipped when a prior run already issued them.
async function issueFixedInvoices(admin, pa, pb) {
  const issueIfDraft = async (staff, invId, who) => {
    const { data, error } = await admin.from('firm_invoices').select('status').eq('id', invId).single();
    if (error) throw new Error(`status check ${invId}: ${error.message}`);
    if (data.status !== 'draft') return;
    const { error: rpcErr } = await staff.rpc('issue_firm_invoice', { p_invoice_id: invId });
    if (rpcErr) throw new Error(`seed issue ${invId} as ${who}: ${rpcErr.message}`);
  };
  await issueIfDraft(pa, ID.invA1Issued, 'PA');
  await issueIfDraft(pa, ID.invA2Issued, 'PA');
  await issueIfDraft(pb, ID.invB1Issued, 'PB');

  // Fixed partial receipt (500 of 5900) so invA1Issued is stably
  // partially_paid. Service role bypasses RLS but NOT the guard/settlement
  // triggers, which is exactly what we want here.
  const { data: paProfile } = await admin.from('profiles').select('id').eq('email', EMAIL.pa).single();
  await ensureRow(admin, 'receipts', {
    id: ID.receiptA1Fixed, firm_id: ID.firmA, client_id: ID.clientA1,
    invoice_id: ID.invA1Issued, amount: 500, tds_amount: 0,
    mode: 'bank_transfer', reference_no: `${TAG}-fixed`, created_by: paProfile.id,
  });
}

// ── probe helpers ───────────────────────────────────────────────────────────

// Create a fresh draft (+ one line item) as EM; returns the draft id.
async function mintDraft(em, ids, { clientId = ID.clientA1, rate = 10000, fy = FY } = {}) {
  const invId = randomUUID();
  const { error: invErr } = await em.from('firm_invoices').insert({
    id: invId, firm_id: ID.firmA, client_id: clientId, financial_year: fy,
    status: 'draft', created_by: ids.emId,
  });
  if (invErr) throw new Error(`mintDraft invoice: ${invErr.message}`);
  const { error: itemErr } = await em.from('firm_invoice_items').insert({
    id: randomUUID(), firm_id: ID.firmA, invoice_id: invId,
    description: `${TAG} fresh fees`, quantity: 1, rate, taxable_value: rate, gst_rate: 18,
  });
  if (itemErr) throw new Error(`mintDraft item: ${itemErr.message}`);
  return invId;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const admin = adminClient();
  const ids = await seed(admin);

  const { client: pa } = await signInAs(EMAIL.pa, PASSWORD);
  const { client: pb } = await signInAs(EMAIL.pb, PASSWORD);
  const { client: e0 } = await signInAs(EMAIL.e0, PASSWORD);
  const { client: ev } = await signInAs(EMAIL.ev, PASSWORD);
  const { client: em } = await signInAs(EMAIL.em, PASSWORD);
  const { client: uA1 } = await signInAs(EMAIL.uA1, PASSWORD);
  const { client: uB1 } = await signInAs(EMAIL.uB1, PASSWORD);

  await issueFixedInvoices(admin, pa, pb);

  // ==========================================================================
  // C — CLIENT (portal JWT, raw PostgREST). The DEFINER-view path is PRIMARY.
  // ==========================================================================

  // C1–C5: no direct table access anywhere in billing.
  for (const table of ['firm_invoices', 'firm_invoice_items', 'receipts', 'fee_masters', 'firm_invoice_counters']) {
    const { data, error } = await uA1.from(table).select('*');
    results.push(log(`C1  U_A1 direct SELECT ${table} → zero rows`, !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }
  // C1b: the staff receivables view (security_invoker) yields nothing either.
  {
    const { data, error } = await uA1.from('client_outstanding').select('*');
    results.push(log('C1b U_A1 SELECT client_outstanding (invoker view) → zero rows', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }

  // C6: client_invoices returns own non-draft invoices ONLY (positive + scoped).
  let clientRows = [];
  {
    const { data, error } = await uA1.from('client_invoices').select('*');
    clientRows = data || [];
    const ownIssuedVisible = clientRows.some((r) => r.id === ID.invA1Issued);
    const allOwnNonDraft = clientRows.every((r) => r.client_id === ID.clientA1 && r.status !== 'draft');
    results.push(log('C6  U_A1 client_invoices → own non-draft rows only, incl. the issued one (not a brick)',
      !error && ownIssuedVisible && allOwnNonDraft && clientRows.length > 0,
      error?.message || `rows: ${clientRows.length}, ownIssued=${ownIssuedVisible}, allOwnNonDraft=${allOwnNonDraft}`));
  }

  // C7: internal_notes / cancellation_reason must not exist on the view.
  {
    const keys = new Set(clientRows.flatMap((r) => Object.keys(r)));
    const leaked = keys.has('internal_notes') || keys.has('cancellation_reason');
    const { error: colErr } = await uA1.from('client_invoices').select('internal_notes');
    results.push(log('C7  client_invoices exposes neither internal_notes nor cancellation_reason',
      !leaked && !!colErr, `keysLeak=${leaked}; explicit select: ${colErr?.message || 'SUCCEEDED (leak!)'}`));
  }

  // C8: line items — own visible through the view; sibling's are not.
  {
    const own = await uA1.from('client_invoice_items').select('*').eq('invoice_id', ID.invA1Issued);
    const sibling = await uA1.from('client_invoice_items').select('*').eq('invoice_id', ID.invA2Issued);
    results.push(log('C8  client_invoice_items → own issued items visible, sibling items zero',
      (own.data || []).length > 0 && (sibling.data || []).length === 0,
      `own=${own.data?.length}, sibling=${sibling.data?.length}`));
  }

  // C9: sibling client's invoices — denied through the view.
  {
    const byId = await uA1.from('client_invoices').select('id').eq('id', ID.invA2Issued);
    const byClient = await uA1.from('client_invoices').select('id').eq('client_id', ID.clientA2);
    results.push(log('C9  U_A1 client_invoices for sibling (A2) → zero rows',
      (byId.data || []).length === 0 && (byClient.data || []).length === 0,
      `byId=${byId.data?.length}, byClient=${byClient.data?.length}`));
  }

  // C10: the draft for the client's OWN client_id is invisible.
  {
    const { data } = await uA1.from('client_invoices').select('id').eq('id', ID.invA1Draft);
    const inUnfiltered = clientRows.some((r) => r.id === ID.invA1Draft);
    results.push(log('C10 U_A1 own DRAFT invoice not visible through client_invoices',
      (data || []).length === 0 && !inUnfiltered, `byId=${data?.length}, inUnfiltered=${inUnfiltered}`));
  }

  // C11: cross-firm — Firm B's client sees nothing of Firm A, and vice versa.
  {
    const b = await uB1.from('client_invoices').select('*');
    const bAllOwn = (b.data || []).every((r) => r.firm_id === ID.firmB && r.client_id === ID.clientB1);
    const bSeesA = await uB1.from('client_invoices').select('id').eq('id', ID.invA1Issued);
    const aSeesB = await uA1.from('client_invoices').select('id').eq('id', ID.invB1Issued);
    results.push(log('C11 cross-firm: U_B1 sees only Firm B rows; neither client sees the other firm\'s invoice',
      bAllOwn && (b.data || []).length > 0 && (bSeesA.data || []).length === 0 && (aSeesB.data || []).length === 0,
      `B rows=${b.data?.length} allOwn=${bAllOwn}, B→A=${bSeesA.data?.length}, A→B=${aSeesB.data?.length}`));
  }

  // C12: writes through the views must be DENIED.
  //
  // ⚠ ARCHITECTURAL FINDING (see docs/verification/portal-isolation.md §7).
  // These views are DEFINER-rights (NOT security_invoker) and auto-updatable:
  // no INSTEAD OF trigger, no WITH CHECK OPTION. The migration REVOKEs write
  // privileges FROM anon, public — but NOT from the `authenticated` role, and
  // Supabase's default privileges grant `authenticated` full DML on new public
  // objects. So a portal client's UPDATE/DELETE flow through the view to
  // firm_invoices with the OWNER's rights, bypassing the deliberate absence of
  // any client write policy. This check is HONEST about that: UPDATE and DELETE
  // are expected DENIED but currently SUCCEED, so C12 FAILS. Do NOT "fix" it by
  // relaxing the assertion — the assertion is correct; the mechanism is wrong.
  //
  // Non-destructive-to-the-series probes only (each references a throwaway
  // attack invoice minted here — no effect on the gapless audit I8, which runs
  // earlier on the clean series; INSERT-with-created_by and the DELETE of an
  // issued invoice were additionally probed out-of-band, recorded in the doc).
  {
    // A fresh, receiptless issued invoice owned by client A1 so the
    // immutability guard's money-check can't mask a status write.
    const attackId = await mintDraft(em, ids, { clientId: ID.clientA1, rate: 5000 });
    await em.rpc('issue_firm_invoice', { p_invoice_id: attackId });

    // INSERT: currently blocked, but ONLY by created_by NOT NULL (created_by is
    // not a view column → defaults to NULL) — not by any access rule. Recorded
    // as its own line so the incidental nature is visible.
    const ins = await uA1.from('client_invoices').insert({ id: randomUUID(), firm_id: ID.firmA, client_id: ID.clientA1, status: 'issued', financial_year: FY });
    const insItem = await uA1.from('client_invoice_items').insert({ id: randomUUID(), invoice_id: ID.invA1Issued, description: 'x', quantity: 1, rate: 1, taxable_value: 1 });
    results.push(log('C12a U_A1 INSERT through the views → denied (incidental: created_by NOT NULL, not RLS)',
      !!ins.error && !!insItem.error,
      `ins=${ins.error?.message || 'OK (bug)'}; insItem=${insItem.error?.message || 'OK (bug)'}`));

    // UPDATE: the money-path breach. Mark own issued invoice paid with zero
    // money; then set amount_received arbitrarily. EXPECTED denied.
    const updPaid = await uA1.from('client_invoices').update({ status: 'paid' }).eq('id', attackId).select();
    const { data: afterPaid } = await admin.from('firm_invoices').select('status, amount_received').eq('id', attackId).single();
    const updPaidDenied = updPaid.error || (updPaid.data || []).length === 0;
    results.push(log('C12b U_A1 UPDATE own issued invoice status=paid through view → DENIED',
      updPaidDenied && afterPaid?.status !== 'paid',
      `viewErr=${updPaid.error?.message || 'none'}, rows=${updPaid.data?.length}, dbStatus=${afterPaid?.status} (FINDING: client self-marked PAID with 0 received)`));

    const updRecv = await uA1.from('client_invoices').update({ amount_received: 999999 }).eq('id', attackId).select();
    const { data: afterRecv } = await admin.from('firm_invoices').select('amount_received').eq('id', attackId).single();
    const updRecvDenied = updRecv.error || (updRecv.data || []).length === 0;
    results.push(log('C12c U_A1 UPDATE own invoice amount_received through view → DENIED',
      updRecvDenied && Number(afterRecv?.amount_received) !== 999999,
      `viewErr=${updRecv.error?.message || 'none'}, rows=${updRecv.data?.length}, dbAmountReceived=${afterRecv?.amount_received} (FINDING: client rewrote the receivables ledger)`));
  }

  // C13: issue_firm_invoice() as a client — denied, draft untouched.
  {
    const { error } = await uA1.rpc('issue_firm_invoice', { p_invoice_id: ID.invA1Draft });
    const { data: still } = await admin.from('firm_invoices').select('status, invoice_seq').eq('id', ID.invA1Draft).single();
    results.push(log('C13 U_A1 rpc issue_firm_invoice(own draft) → denied; draft unchanged',
      !!error && still?.status === 'draft' && still?.invoice_seq === null,
      `${error?.message || 'RPC SUCCEEDED (bug)'}; after: ${still?.status}/${still?.invoice_seq}`));
  }

  // ==========================================================================
  // S — STAFF permission matrix.
  // ==========================================================================

  // S1: partner reads everything billing.
  {
    const inv = await pa.from('firm_invoices').select('id').eq('firm_id', ID.firmA);
    const rec = await pa.from('receipts').select('id').eq('firm_id', ID.firmA);
    const fee = await pa.from('fee_masters').select('id').eq('firm_id', ID.firmA);
    results.push(log('S1  PA (partner) reads invoices / receipts / fee_masters',
      (inv.data || []).length > 0 && (rec.data || []).length > 0 && (fee.data || []).length > 0,
      `inv=${inv.data?.length}, rec=${rec.data?.length}, fee=${fee.data?.length}`));
  }

  // S2: employee WITHOUT billing.view reads nothing.
  {
    const counts = [];
    let allZero = true;
    for (const table of ['firm_invoices', 'firm_invoice_items', 'receipts', 'fee_masters', 'firm_invoice_counters']) {
      const { data } = await e0.from(table).select('*');
      counts.push(`${table}=${data?.length}`);
      if ((data || []).length !== 0) allZero = false;
    }
    results.push(log('S2  E0 (employee, no billing perm) reads nothing across all 5 billing tables', allZero, counts.join(', ')));
  }

  // S3: employee WITH billing.view reads.
  {
    const inv = await ev.from('firm_invoices').select('id').eq('firm_id', ID.firmA);
    const rec = await ev.from('receipts').select('id').eq('firm_id', ID.firmA);
    const fee = await ev.from('fee_masters').select('id').eq('firm_id', ID.firmA);
    const ctr = await ev.from('firm_invoice_counters').select('last_seq').eq('firm_id', ID.firmA);
    results.push(log('S3  EV (billing.view) reads invoices / receipts / fee_masters / counters',
      (inv.data || []).length > 0 && (rec.data || []).length > 0 && (fee.data || []).length > 0 && (ctr.data || []).length > 0,
      `inv=${inv.data?.length}, rec=${rec.data?.length}, fee=${fee.data?.length}, ctr=${ctr.data?.length}`));
  }

  // S4: billing.view alone cannot write.
  {
    const ins = await ev.from('firm_invoices').insert({ id: randomUUID(), firm_id: ID.firmA, client_id: ID.clientA1, financial_year: FY, status: 'draft', created_by: ids.evId });
    const upd = await ev.from('firm_invoices').update({ internal_notes: 'EV was here' }).eq('id', ID.invA1Draft).select();
    const rcp = await ev.from('receipts').insert({ id: randomUUID(), firm_id: ID.firmA, client_id: ID.clientA1, invoice_id: ID.invA1Issued, amount: 1, created_by: ids.evId });
    const updDenied = upd.error || (upd.data || []).length === 0;
    results.push(log('S4  EV (view only) cannot INSERT draft / UPDATE invoice / INSERT receipt',
      !!ins.error && updDenied && !!rcp.error,
      `ins=${ins.error?.message || 'OK (bug)'}; upd=${upd.error?.message || 'rows ' + upd.data?.length}; rcp=${rcp.error?.message || 'OK (bug)'}`));
  }

  // S5: billing.view + billing.manage can create a draft AND issue it — this
  // is finding 4's pairing rule proven end-to-end under an employee JWT
  // (issue_firm_invoice is SECURITY INVOKER: the SELECT needs view, the
  // counter/invoice writes need manage).
  {
    const invId = await mintDraft(em, ids, { rate: 7000 });
    const { data: issued, error } = await em.rpc('issue_firm_invoice', { p_invoice_id: invId });
    const row = Array.isArray(issued) ? issued[0] : issued;
    results.push(log('S5  EM (view+manage) creates a draft and ISSUES it (pairing rule)',
      !error && row?.status === 'issued' && !!row?.invoice_number && row?.invoice_seq > 0,
      error?.message || `number=${row?.invoice_number}, total=${row?.total_amount}`));
  }

  // ==========================================================================
  // I — INTEGRITY (money paths), driven as EM.
  // ==========================================================================

  // I1: concurrent issuance in one firm+FY → both succeed, distinct numbers.
  {
    const d1 = await mintDraft(em, ids);
    const d2 = await mintDraft(em, ids);
    const [r1, r2] = await Promise.all([
      em.rpc('issue_firm_invoice', { p_invoice_id: d1 }),
      em.rpc('issue_firm_invoice', { p_invoice_id: d2 }),
    ]);
    const row1 = Array.isArray(r1.data) ? r1.data[0] : r1.data;
    const row2 = Array.isArray(r2.data) ? r2.data[0] : r2.data;
    const ok = !r1.error && !r2.error && row1?.invoice_seq > 0 && row2?.invoice_seq > 0 && row1.invoice_seq !== row2.invoice_seq;
    results.push(log('I1  two CONCURRENT issues in one firm+FY → both succeed, distinct seqs',
      ok, r1.error?.message || r2.error?.message || `seqs: ${row1?.invoice_seq}, ${row2?.invoice_seq}`));
  }

  // I2: deleting a draft must not gap the series.
  {
    const doomed = await mintDraft(em, ids);
    const { error: delErr, count } = await em.from('firm_invoices').delete({ count: 'exact' }).eq('id', doomed);
    const { data: ctrBefore } = await em.from('firm_invoice_counters').select('last_seq').eq('firm_id', ID.firmA).eq('financial_year', FY).single();
    const next = await mintDraft(em, ids);
    const { data: issued, error } = await em.rpc('issue_firm_invoice', { p_invoice_id: next });
    const row = Array.isArray(issued) ? issued[0] : issued;
    const ok = !delErr && count === 1 && !error && row?.invoice_seq === (ctrBefore?.last_seq ?? 0) + 1;
    results.push(log('I2  delete a draft → next issued number is counter+1 (no gap consumed)',
      ok, delErr?.message || error?.message || `deleted=${count}, counterBefore=${ctrBefore?.last_seq}, nextSeq=${row?.invoice_seq}`));
  }

  // I3: issued invoice — frozen column UPDATE rejected by trigger.
  {
    const { error } = await em.from('firm_invoices').update({ total_amount: 1 }).eq('id', ID.invA1Issued);
    results.push(log('I3  UPDATE frozen column (total_amount) on issued invoice → rejected by trigger',
      !!error && /immutable/i.test(error?.message || ''), error?.message || 'UPDATE SUCCEEDED (bug)'));
  }

  // I4: line items of an issued invoice — INSERT / UPDATE / DELETE rejected.
  {
    const ins = await em.from('firm_invoice_items').insert({ id: randomUUID(), firm_id: ID.firmA, invoice_id: ID.invA1Issued, description: 'sneak', quantity: 1, rate: 1, taxable_value: 1 });
    const upd = await em.from('firm_invoice_items').update({ rate: 999999 }).eq('id', ID.itemA1Issued);
    const del = await em.from('firm_invoice_items').delete().eq('id', ID.itemA1Issued);
    results.push(log('I4  line-item INSERT/UPDATE/DELETE on an issued invoice → all rejected',
      !!ins.error && !!upd.error && !!del.error,
      `ins=${ins.error?.message || 'OK (bug)'}; upd=${upd.error?.message || 'OK (bug)'}; del=${del.error?.message || 'OK (bug)'}`));
  }

  // I5: TDS settlement — 90% cash + 10% TDS fully settles (u/s 194J), and the
  // outstanding ledger reads zero for that client. Item 10000 @ 18% → 11800.
  {
    const invId = await mintDraft(em, ids, { clientId: ID.clientA3, rate: 10000 });
    const { error: issueErr } = await em.rpc('issue_firm_invoice', { p_invoice_id: invId });
    const { error: rcpErr } = await em.from('receipts').insert({
      id: randomUUID(), firm_id: ID.firmA, client_id: ID.clientA3, invoice_id: invId,
      amount: 10620, tds_amount: 1180, mode: 'bank_transfer', reference_no: `${TAG}-tds`, created_by: ids.emId,
    });
    const { data: inv } = await em.from('firm_invoices').select('status, amount_received, tds_received, total_amount').eq('id', invId).single();
    const { data: out } = await em.from('client_outstanding').select('outstanding').eq('client_id', ID.clientA3);
    const outstandingZero = (out || []).length === 0 || (out || []).every((r) => Number(r.outstanding) === 0);
    const ok = !issueErr && !rcpErr && inv?.status === 'paid'
      && Number(inv?.amount_received) === 10620 && Number(inv?.tds_received) === 1180 && outstandingZero;
    results.push(log('I5  receipt 90% cash + 10% TDS → invoice PAID, client_outstanding zero',
      ok, issueErr?.message || rcpErr?.message || `status=${inv?.status}, recv=${inv?.amount_received}+${inv?.tds_received} of ${inv?.total_amount}, outstandingRows=${out?.length}`));
  }

  // I6: cancel with receipts applied → rejected.
  {
    const invId = await mintDraft(em, ids, { rate: 6000 });
    await em.rpc('issue_firm_invoice', { p_invoice_id: invId });
    const { error: rcpErr } = await em.from('receipts').insert({
      id: randomUUID(), firm_id: ID.firmA, client_id: ID.clientA1, invoice_id: invId,
      amount: 1000, created_by: ids.emId,
    });
    const { error } = await em.from('firm_invoices')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: 'attempted cancel with money applied' })
      .eq('id', invId);
    results.push(log('I6  cancel an invoice with receipts applied → rejected',
      !rcpErr && !!error && /receipts applied/i.test(error?.message || ''),
      rcpErr?.message || error?.message || 'CANCEL SUCCEEDED (bug)'));
  }

  // I7: receipt pointing at another client's invoice → guard_receipt rejects.
  {
    const { error } = await em.from('receipts').insert({
      id: randomUUID(), firm_id: ID.firmA, client_id: ID.clientA2,
      invoice_id: ID.invA1Issued, amount: 100, created_by: ids.emId,
    });
    results.push(log('I7  receipt whose client_id ≠ the invoice\'s client → rejected by guard_receipt',
      !!error && /must match/i.test(error?.message || ''), error?.message || 'INSERT SUCCEEDED (bug)'));
  }

  // I8: self-contained gapless series audit. Issues a known N invoices in a
  // FRESH, unique financial_year (so the audit is isolated from every other
  // run and from the C12 write-through finding, which — being a real client
  // exploit — can permanently gap firm A's live 2026-27 series) and asserts
  // the (firm, FY) series is EXACTLY 1..N with counter == N. Includes an
  // interleaved draft-delete to prove a mid-series draft deletion consumes no
  // number. FY is a valid ^\d{4}-\d{2}$ string outside any real range.
  {
    const auditFy = `2${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 90) + 10)}`;
    const N = 4;
    const seqsIssued = [];
    let issueErr = null;
    for (let k = 0; k < N; k += 1) {
      const d = await mintDraft(em, ids, { fy: auditFy, rate: 1000 + k });
      if (k === 2) {
        // Interleave a draft that is deleted before issuing — must not gap.
        const doomed = await mintDraft(em, ids, { fy: auditFy, rate: 5 });
        await em.from('firm_invoices').delete().eq('id', doomed);
      }
      const { data, error } = await em.rpc('issue_firm_invoice', { p_invoice_id: d });
      if (error) { issueErr = error; break; }
      const row = Array.isArray(data) ? data[0] : data;
      seqsIssued.push(row?.invoice_seq);
    }
    const { data: ctr } = await pa.from('firm_invoice_counters')
      .select('last_seq').eq('firm_id', ID.firmA).eq('financial_year', auditFy).single();
    const sorted = [...seqsIssued].sort((a, b) => a - b);
    const distinct = new Set(sorted).size === sorted.length;
    const gapless = sorted.length === N && sorted[0] === 1 && sorted[N - 1] === N;
    const counterMatches = ctr?.last_seq === N;
    results.push(log('I8  gapless series audit (fresh FY): N issues → seqs exactly 1..N, counter == N, draft-delete no gap',
      !issueErr && distinct && gapless && counterMatches,
      issueErr?.message || `fy=${auditFy}, seqs=[${sorted.join(',')}], counter=${ctr?.last_seq}`));
  }

  // ── summary ──
  console.log('\n--- 08-billing-rls summary ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed.`);

  try {
    writeFileSync(path.join(DATA_DIR, 'results-08-billing-rls.json'), JSON.stringify(results, null, 2));
  } catch {
    // .data/ may not exist in a fresh checkout — the console output is the record.
  }
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
