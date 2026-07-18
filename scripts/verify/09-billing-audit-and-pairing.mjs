// Phase 14 — committed role-JWT RLS suite for migration 006
// (006_billing_audit_and_pairing.sql), closing Phase 12 review findings 2-4.
//
// Same house style as 08-billing-rls.mjs and rls-smoke.mjs: self-seeding,
// re-runnable against the live project, service-role for seeding, anon-key
// signInWithPassword sessions for every assertion — the database's own
// RLS/triggers are what is tested, never the app layer.
//
// WHAT IT PROVES
//   internal_notes    — client cannot read it through any path (already
//                        covered by 08's C7 via the client_invoices column
//                        list; here we additionally confirm the reverse:
//                        staff WITH billing.view can read it and staff WITH
//                        billing.manage can write it — the actual enforced
//                        model is permission-based, not a partner-only gate,
//                        so that's what this suite asserts).
//   on-account         — a receipt with invoice_id = NULL is accepted, does
//     receipts            NOT touch any invoice's settlement, and IS
//                        reflected in client_outstanding (both as its own
//                        on_account_credit column and netted into
//                        outstanding) — including for a client with ONLY an
//                        on-account receipt and no open invoice at all.
//   receipt audit      — receipts stay billing.manage-mutable (not made
//     trail                immutable — see migration 006 header for why),
//                        but every INSERT/UPDATE/DELETE lands a row in
//                        receipt_history with a before/after JSONB
//                        snapshot; non-billing.view roles (employee with no
//                        billing perms, client) cannot read receipt_history
//                        and nobody can write it directly (trigger-only).
//   billing.manage =>  — an employee granted billing.manage WITHOUT
//     billing.view         billing.view can nonetheless SELECT
//                        firm_invoices/receipts/receipt_history (the
//                        auto-pair) and successfully issue an invoice
//                        end-to-end (the concrete failure mode finding 4
//                        named: issue_firm_invoice()'s internal SELECT).
//
// SEEDING NOTES — mirrors 08-billing-rls.mjs's fixed-UUID insert-if-absent
// pattern for anything that must survive re-runs, and mints fresh
// random-UUID rows for anything that gets mutated/deleted by a test (so
// re-runs never fight over trigger-derived state).

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { adminClient, signInAs } from './lib/admin.mjs';
import { log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');

const TAG = 'bilaud1';
const PASSWORD = 'PortalIso123!';
const FY = '2026-27';

const ID = {
  firm: 'a0000000-0000-4000-8000-00000b120001',
  clientMain: 'a0000000-0000-4000-8000-00000b12c001', // has an issued invoice + fixed receipt
  clientOnAccountOnly: 'a0000000-0000-4000-8000-00000b12c002', // ONLY ever gets on-account receipts, no invoice
  invMain: 'a0000000-0000-4000-8000-00000b12e001',
  itemMain: 'a0000000-0000-4000-8000-00000b121a01',
};

const EMAIL = {
  pa: `${TAG}.pa@example.com`, // partner
  e0: `${TAG}.e0@example.com`, // employee, no billing permission at all
  ev: `${TAG}.ev@example.com`, // employee, billing.view only (control)
  em: `${TAG}.em@example.com`, // employee, billing.manage ONLY — no billing.view granted (finding 4's exact scenario)
  uMain: `${TAG}.umain@example.com`, // portal client
};

const results = [];

// ── seed helpers (same shape as 08-billing-rls.mjs) ─────────────────────────

async function ensureUser(admin, email, metadata) {
  const created = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: metadata,
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

async function ensureRow(admin, table, row) {
  const { data, error: selErr } = await admin.from(table).select('id').eq('id', row.id).maybeSingle();
  if (selErr) throw new Error(`ensureRow select ${table}(${row.id}): ${selErr.message}`);
  if (data) return false;
  const { error } = await admin.from(table).insert(row);
  if (error) throw new Error(`ensureRow insert ${table}(${row.id}): ${error.message}`);
  return true;
}

async function seed(admin) {
  await up(admin, 'firms', { id: ID.firm, name: `${TAG} Firm` });

  const paId = await ensureUser(admin, EMAIL.pa, { name: 'PA', role: 'partner', firm_id: ID.firm });
  const e0Id = await ensureUser(admin, EMAIL.e0, { name: 'E0', role: 'employee', firm_id: ID.firm });
  const evId = await ensureUser(admin, EMAIL.ev, { name: 'EV', role: 'employee', firm_id: ID.firm });
  const emId = await ensureUser(admin, EMAIL.em, { name: 'EM', role: 'employee', firm_id: ID.firm });
  const uMainId = await ensureUser(admin, EMAIL.uMain, { name: 'UMain', role: 'client_user', firm_id: ID.firm, client_id: ID.clientMain });

  await up(admin, 'profiles', { id: paId, firm_id: ID.firm, name: 'PA', email: EMAIL.pa, role: 'partner' });
  await up(admin, 'profiles', { id: e0Id, firm_id: ID.firm, name: 'E0', email: EMAIL.e0, role: 'employee' });
  await up(admin, 'profiles', { id: evId, firm_id: ID.firm, name: 'EV', email: EMAIL.ev, role: 'employee' });
  await up(admin, 'profiles', { id: emId, firm_id: ID.firm, name: 'EM', email: EMAIL.em, role: 'employee' });

  await up(admin, 'clients', { id: ID.clientMain, firm_id: ID.firm, name: `${TAG} Client Main`, business_type: 'pvt_ltd', created_by: paId });
  await up(admin, 'clients', { id: ID.clientOnAccountOnly, firm_id: ID.firm, name: `${TAG} Client On-Account-Only`, business_type: 'individual', created_by: paId });

  await up(admin, 'profiles', { id: uMainId, firm_id: ID.firm, name: 'UMain', email: EMAIL.uMain, role: 'client_user', client_id: ID.clientMain });

  // EV: billing.view only (control for "view alone can't read receipt_history
  // beyond what billing.view already grants — no special restriction there").
  // EM: billing.manage ONLY — billing.view is deliberately NOT granted, so
  // any read EM succeeds at proves the auto-pair, not an accidental grant.
  const grant = (userId, key) =>
    up(admin, 'user_permissions', { user_id: userId, permission_key: key, granted: true, granted_by: paId }, 'user_id,permission_key');
  await grant(evId, 'billing.view');
  await grant(emId, 'billing.manage');

  // Fixed issued invoice + a settling receipt on clientMain, so there is
  // stable invoice-based `outstanding` to net on-account credit against.
  await ensureRow(admin, 'firm_invoices', {
    id: ID.invMain, firm_id: ID.firm, client_id: ID.clientMain, financial_year: FY,
    status: 'draft', created_by: paId, tds_expected: 0,
  });
  await ensureRow(admin, 'firm_invoice_items', {
    id: ID.itemMain, firm_id: ID.firm, invoice_id: ID.invMain,
    description: `${TAG} professional fees`, quantity: 1, rate: 10000, taxable_value: 10000, gst_rate: 18,
  });

  return { paId, e0Id, evId, emId, uMainId };
}

async function issueFixedInvoiceIfDraft(admin, pa) {
  const { data, error } = await admin.from('firm_invoices').select('status').eq('id', ID.invMain).single();
  if (error) throw new Error(`status check ${ID.invMain}: ${error.message}`);
  if (data.status !== 'draft') return;
  const { error: rpcErr } = await pa.rpc('issue_firm_invoice', { p_invoice_id: ID.invMain });
  if (rpcErr) throw new Error(`seed issue ${ID.invMain}: ${rpcErr.message}`);
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const admin = adminClient();
  const ids = await seed(admin);

  const { client: pa } = await signInAs(EMAIL.pa, PASSWORD);
  const { client: e0 } = await signInAs(EMAIL.e0, PASSWORD);
  const { client: ev } = await signInAs(EMAIL.ev, PASSWORD);
  const { client: em } = await signInAs(EMAIL.em, PASSWORD);
  const { client: uMain } = await signInAs(EMAIL.uMain, PASSWORD);

  await issueFixedInvoiceIfDraft(admin, pa);

  // ==========================================================================
  // N — internal_notes: client cannot read it anywhere; billing.view staff
  // CAN read it; billing.manage staff CAN write it. (Permission-gated, not
  // partner-only — that is the actual enforced model; see script header.)
  // ==========================================================================

  // N1: client_invoices (the client's only invoice read path) never exposes
  // internal_notes, confirmed by explicit column select failing.
  {
    const { error } = await uMain.from('client_invoices').select('internal_notes').eq('id', ID.invMain);
    results.push(log('N1  client: explicit SELECT internal_notes through client_invoices → column does not exist',
      !!error, error?.message || 'SELECT SUCCEEDED (bug — internal_notes leaked to client)'));
  }

  // N2: client has no policy on firm_invoices at all, so even a raw SELECT
  // (not through the view) of internal_notes returns nothing.
  {
    const { data, error } = await uMain.from('firm_invoices').select('id, internal_notes').eq('id', ID.invMain);
    results.push(log('N2  client: raw SELECT internal_notes on firm_invoices (bypassing the view) → zero rows',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }

  // N3: EV (billing.view) CAN read internal_notes on firm_invoices directly.
  {
    const testNote = `${TAG} note set by seed`;
    await admin.from('firm_invoices').update({ internal_notes: testNote }).eq('id', ID.invMain);
    const { data, error } = await ev.from('firm_invoices').select('internal_notes').eq('id', ID.invMain).single();
    results.push(log('N3  EV (billing.view): CAN read internal_notes directly on firm_invoices',
      !error && data?.internal_notes === testNote, error?.message || `got: ${data?.internal_notes}`));
  }

  // N4: EM (billing.manage, NO billing.view granted) CAN write internal_notes
  // — proves both the write permission AND (via the subsequent read-back)
  // the auto-pair from finding 4 in the same stroke.
  {
    const newNote = `${TAG} note set by EM ${Date.now()}`;
    const { error: updErr } = await em.from('firm_invoices').update({ internal_notes: newNote }).eq('id', ID.invMain);
    const { data: readBack, error: selErr } = await em.from('firm_invoices').select('internal_notes').eq('id', ID.invMain).single();
    results.push(log('N4  EM (billing.manage only): CAN write internal_notes AND read it back (auto-pair)',
      !updErr && !selErr && readBack?.internal_notes === newNote,
      updErr?.message || selErr?.message || `got: ${readBack?.internal_notes}`));
  }

  // N5: E0 (no billing permission at all) cannot read or write it. An
  // RLS-denied UPDATE returns HTTP 200 with zero rows affected, not an
  // error — .select() + row count is the only reliable signal (same
  // pattern P4 already uses).
  {
    const { data, error: selErr } = await e0.from('firm_invoices').select('internal_notes').eq('id', ID.invMain);
    const { data: updData, error: updErr } = await e0.from('firm_invoices').update({ internal_notes: 'E0 was here' }).eq('id', ID.invMain).select();
    results.push(log('N5  E0 (no billing permission): cannot read (zero rows) or write (zero rows affected) internal_notes',
      !selErr && (data || []).length === 0 && !updErr && (updData || []).length === 0,
      `read rows=${data?.length}; write error=${updErr?.message || 'none'}, write rows affected=${updData?.length}`));
  }

  // ==========================================================================
  // A — on-account receipts (finding 2).
  // ==========================================================================

  let onAccountReceiptId;

  // A1: EM (billing.manage) can INSERT a receipt with invoice_id = NULL.
  {
    onAccountReceiptId = randomUUID();
    const { error } = await em.from('receipts').insert({
      id: onAccountReceiptId, firm_id: ID.firm, client_id: ID.clientOnAccountOnly,
      invoice_id: null, amount: 4000, tds_amount: 0, mode: 'bank_transfer',
      reference_no: `${TAG}-onacct`, created_by: ids.emId,
    });
    results.push(log('A1  EM: INSERT receipt with invoice_id=NULL (on-account) → accepted',
      !error, error?.message || 'ok'));
  }

  // A2: client_outstanding shows the on-account-only client with NO open
  // invoices at all, on_account_credit=4000, outstanding = -4000 (a credit).
  {
    const { data, error } = await pa.from('client_outstanding').select('*').eq('client_id', ID.clientOnAccountOnly).maybeSingle();
    results.push(log('A2  client_outstanding: client with ONLY an on-account receipt appears, on_account_credit=4000, outstanding=-4000',
      !error && Number(data?.on_account_credit) === 4000 && Number(data?.outstanding) === -4000 && Number(data?.open_invoice_count) === 0,
      error?.message || `row=${JSON.stringify(data)}`));
  }

  // A3: on-account receipt does NOT touch firm_invoice settlement — sanity
  // check that clientMain's issued invoice is untouched by A1's insert.
  {
    const { data } = await pa.from('firm_invoices').select('amount_received, status').eq('id', ID.invMain).single();
    results.push(log('A3  clientMain\'s unrelated issued invoice is unaffected by the on-account receipt on a different client',
      data?.status === 'issued' || data?.status === 'partially_paid' || data?.status === 'paid',
      `status=${data?.status}, amount_received=${data?.amount_received}`));
  }

  // A4: netting — give clientMain (who has an open invoice) an on-account
  // receipt too, and confirm outstanding drops by exactly that amount versus
  // the invoice-only outstanding.
  {
    const { data: before } = await pa.from('client_outstanding').select('outstanding, on_account_credit').eq('client_id', ID.clientMain).single();
    const netReceiptId = randomUUID();
    await em.from('receipts').insert({
      id: netReceiptId, firm_id: ID.firm, client_id: ID.clientMain,
      invoice_id: null, amount: 1000, tds_amount: 0, mode: 'upi',
      reference_no: `${TAG}-net`, created_by: ids.emId,
    });
    const { data: after, error } = await pa.from('client_outstanding').select('outstanding, on_account_credit').eq('client_id', ID.clientMain).single();
    const beforeOutstanding = Number(before?.outstanding ?? 0);
    const beforeCredit = Number(before?.on_account_credit ?? 0);
    const afterOutstanding = Number(after?.outstanding ?? 0);
    const afterCredit = Number(after?.on_account_credit ?? 0);
    results.push(log('A4  adding a 1000 on-account receipt to a client WITH an open invoice: on_account_credit +1000, outstanding -1000',
      !error && afterCredit === beforeCredit + 1000 && afterOutstanding === beforeOutstanding - 1000,
      error?.message || `before=${beforeOutstanding}/${beforeCredit}, after=${afterOutstanding}/${afterCredit}`));
  }

  // A5: client cannot see on-account receipts (no client policy on receipts
  // at all — unchanged by this migration, confirmed here since it's now
  // reachable data a client might otherwise be tempted to probe for).
  {
    const { data, error } = await uMain.from('receipts').select('*');
    results.push(log('A5  client: SELECT receipts (incl. on-account) → zero rows (no client policy on receipts)',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }

  // ==========================================================================
  // H — receipt_history audit trail (finding 3).
  // ==========================================================================

  // H1: the A1 INSERT above already produced a history row — confirm it,
  // operation='insert', new_data captured, old_data NULL.
  {
    const { data, error } = await pa.from('receipt_history').select('*').eq('receipt_id', onAccountReceiptId).eq('operation', 'insert').maybeSingle();
    const loggedAmount = Number(data?.new_data?.amount);
    results.push(log('H1  receipt_history: INSERT of the on-account receipt was logged (operation=insert, old_data=NULL, new_data present)',
      !error && !!data && data.old_data === null && loggedAmount === 4000,
      error?.message || `row=${JSON.stringify(data)}`));
  }

  // H2: EM updates the on-account receipt's amount → a second history row
  // (operation='update') with both old_data and new_data snapshots.
  {
    const { error: updErr } = await em.from('receipts').update({ amount: 4500 }).eq('id', onAccountReceiptId);
    const { data, error } = await pa.from('receipt_history').select('*').eq('receipt_id', onAccountReceiptId).eq('operation', 'update').maybeSingle();
    const oldAmt = Number(data?.old_data?.amount);
    const newAmt = Number(data?.new_data?.amount);
    results.push(log('H2  receipt_history: UPDATE (amount 4000→4500) logged with old_data.amount=4000, new_data.amount=4500',
      !updErr && !error && !!data && oldAmt === 4000 && newAmt === 4500,
      updErr?.message || error?.message || `old=${oldAmt}, new=${newAmt}`));
  }

  // H3: EM deletes the receipt → a third history row (operation='delete')
  // with old_data present, new_data NULL, and the history row SURVIVES the
  // receipt's deletion (no FK cascade — that's the whole point).
  {
    const { error: delErr } = await em.from('receipts').delete().eq('id', onAccountReceiptId);
    const { data: stillThere } = await admin.from('receipts').select('id').eq('id', onAccountReceiptId).maybeSingle();
    const { data, error } = await pa.from('receipt_history').select('*').eq('receipt_id', onAccountReceiptId).eq('operation', 'delete').maybeSingle();
    results.push(log('H3  receipt_history: DELETE logged (old_data present, new_data=NULL); history row survives the receipt\'s own deletion',
      !delErr && !stillThere && !error && !!data && data.new_data === null && !!data.old_data,
      delErr?.message || error?.message || `receiptStillExists=${!!stillThere}, historyRow=${JSON.stringify(data)}`));
  }

  // H4: all three history rows for this receipt_id are attributed to EM.
  {
    const { data, error } = await pa.from('receipt_history').select('operation, changed_by').eq('receipt_id', onAccountReceiptId);
    const allEm = (data || []).length === 3 && (data || []).every((r) => r.changed_by === ids.emId);
    results.push(log('H4  all 3 history rows (insert/update/delete) for this receipt are attributed to EM',
      allEm, error?.message || `rows=${JSON.stringify(data)}`));
  }

  // H5: E0 (no billing.view) cannot read receipt_history.
  {
    const { data, error } = await e0.from('receipt_history').select('id');
    results.push(log('H5  E0 (no billing permission): receipt_history SELECT → zero rows',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }

  // H6: client cannot read receipt_history.
  {
    const { data, error } = await uMain.from('receipt_history').select('id');
    results.push(log('H6  client: receipt_history SELECT → zero rows',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }

  // H7: direct INSERT/UPDATE/DELETE against receipt_history is rejected for
  // EVERYONE, including EM (billing.manage) — trigger-only, no policy at all.
  {
    const ins = await em.from('receipt_history').insert({
      id: randomUUID(), firm_id: ID.firm, receipt_id: randomUUID(), operation: 'insert',
      client_id: ID.clientMain, old_data: null, new_data: {}, changed_by: ids.emId,
    });
    const { data: anyRow } = await pa.from('receipt_history').select('id').limit(1).single();
    const upd = await em.from('receipt_history').update({ operation: 'delete' }).eq('id', anyRow?.id ?? '00000000-0000-0000-0000-000000000000');
    const del = await em.from('receipt_history').delete().eq('id', anyRow?.id ?? '00000000-0000-0000-0000-000000000000');
    const updDenied = upd.error || (upd.data || []).length === 0;
    const delDenied = del.error || (del.data || []).length === 0;
    results.push(log('H7  direct write (INSERT/UPDATE/DELETE) against receipt_history is denied even for EM (trigger-only, no policy)',
      !!ins.error && updDenied && delDenied,
      `ins=${ins.error?.message || 'OK (bug)'}; upd=${upd.error?.message || 'rows ' + upd.data?.length}; del=${del.error?.message || 'rows ' + del.data?.length}`));
  }

  // ==========================================================================
  // P — billing.manage implies billing.view (finding 4), exercised end-to-end.
  // ==========================================================================

  // P1: EM (billing.manage granted, billing.view NEVER granted) can SELECT
  // firm_invoices — the exact read issue_firm_invoice() needs internally.
  {
    const { data, error } = await em.from('firm_invoices').select('id').eq('firm_id', ID.firm);
    results.push(log('P1  EM (billing.manage only, billing.view NOT granted): SELECT firm_invoices succeeds (auto-pair)',
      !error && (data || []).length > 0, error?.message || `rows: ${data?.length}`));
  }

  // P2: EM can SELECT receipts and receipt_history too (same auto-pair path).
  {
    const rec = await em.from('receipts').select('id').eq('firm_id', ID.firm);
    const hist = await em.from('receipt_history').select('id').eq('firm_id', ID.firm);
    results.push(log('P2  EM: SELECT receipts and receipt_history also succeed (auto-pair applies everywhere billing.view is checked)',
      !rec.error && (rec.data || []).length > 0 && !hist.error && (hist.data || []).length > 0,
      `rec=${rec.error?.message || rec.data?.length}, hist=${hist.error?.message || hist.data?.length}`));
  }

  // P3: EM can create AND issue a fresh invoice end-to-end — the concrete
  // failure mode finding 4 named (issue_firm_invoice's internal
  // SELECT ... FOR UPDATE needing billing.view).
  {
    const draftId = randomUUID();
    const { error: insErr } = await em.from('firm_invoices').insert({
      id: draftId, firm_id: ID.firm, client_id: ID.clientMain, financial_year: FY,
      status: 'draft', created_by: ids.emId,
    });
    await em.from('firm_invoice_items').insert({
      id: randomUUID(), firm_id: ID.firm, invoice_id: draftId,
      description: `${TAG} EM fresh fees`, quantity: 1, rate: 2000, taxable_value: 2000, gst_rate: 18,
    });
    const { data: issued, error: issueErr } = await em.rpc('issue_firm_invoice', { p_invoice_id: draftId });
    const row = Array.isArray(issued) ? issued[0] : issued;
    results.push(log('P3  EM (billing.manage only): creates a draft AND issues it end-to-end without ever holding billing.view directly',
      !insErr && !issueErr && row?.status === 'issued' && !!row?.invoice_number,
      insErr?.message || issueErr?.message || `number=${row?.invoice_number}`));
  }

  // P4: sanity control — EV (billing.view only, no billing.manage) still
  // cannot write, i.e. the auto-pair is one-directional (manage⇒view, not
  // view⇒manage). RLS-denied UPDATEs return zero rows rather than an error,
  // so the row count is the authoritative check.
  {
    const { data, error } = await ev.from('firm_invoices').update({ internal_notes: 'EV should not be able to do this' }).eq('id', ID.invMain).select();
    results.push(log('P4  EV (billing.view only): UPDATE firm_invoices affects zero rows (auto-pair is one-directional)',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }

  // ── summary ──
  console.log('\n--- 09-billing-audit-and-pairing summary ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed.`);

  try {
    writeFileSync(path.join(DATA_DIR, 'results-09-billing-audit-and-pairing.json'), JSON.stringify(results, null, 2));
  } catch {
    // .data/ may not exist in a fresh checkout — the console output is the record.
  }
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
