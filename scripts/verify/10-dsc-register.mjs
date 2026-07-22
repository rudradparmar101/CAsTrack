// Phase 13.2 — committed role-JWT RLS suite for migration 008
// (008_dsc_register.sql). Same house style as rls-smoke.mjs / 08-billing-rls.mjs /
// 09-billing-audit-and-pairing.mjs: self-seeding, re-runnable against the live
// project, service-role for seeding, anon-key signInWithPassword sessions for
// every assertion — the database's own RLS/triggers/RPC are what is tested,
// never the app layer.
//
// ⚠ DO NOT RUN until migration 008 has been applied in Supabase Studio and
// Jay has confirmed it. Drafted ahead of time so it's ready the moment it is.
//
// WHAT IT PROVES
//   reads + movements    — gated on the SAME clients.view permission
//     are one rule          (has_permission('clients.view'), partner bypass
//                            automatic): EV (employee, clients.view granted
//                            by the employee default) can read dsc_register
//                            AND dsc_custody_movements AND successfully call
//                            record_dsc_movement(); E0 (employee, clients.view
//                            explicitly revoked via a user_permissions
//                            override — the same real, tested configuration
//                            as rls-smoke.mjs's E2) gets ZERO rows on both
//                            tables AND is rejected calling
//                            record_dsc_movement() directly via raw
//                            PostgREST, proving the RPC's internal check is
//                            load-bearing, not decorative (SECURITY DEFINER
//                            bypasses RLS entirely).
//   full-record writes   — partner-only at the RLS layer: EV (staff, has
//     are partner-only        clients.view) can read/move but CANNOT INSERT
//                            a new DSC record or UPDATE one directly (only
//                            PA, the partner, can).
//   client isolation      — a client_user gets zero rows on both tables and
//                            is rejected calling record_dsc_movement(), the
//                            same negative-check shape as udin_register's
//                            (migration 007) verification.
//   movement log is        — a legitimate custody change via
//     accurate + append-      record_dsc_movement() produces exactly one
//     only                    dsc_custody_movements row with the correct
//                            from/to custodian and the note threaded through
//                            via the transaction-local set_config() call; a
//                            cron-style service-role UPDATE that touches ONLY
//                            last_expiry_alert_tier/
//                            last_expiry_alert_sent_for_expiry (never
//                            current_custodian_id) writes NO row at all —
//                            proving the trigger's WHEN clause + IS DISTINCT
//                            FROM guard actually holds, not just in theory.
//
// SEEDING NOTES — fixed UUIDs (insert-if-absent) for anything that must
// survive re-runs; the DSC row's current_custodian_id is reset to NULL at
// the start of each run so the "exactly one movement row" assertion doesn't
// accumulate across repeated executions.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { adminClient, signInAs } from './lib/admin.mjs';
import { log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');

const TAG = 'dscreg1';
const PASSWORD = 'DscTest123!';

const ID = {
  firm: 'a0000000-0000-4000-8000-00000d130001',
  client: 'a0000000-0000-4000-8000-00000d13c001',
  dsc: 'a0000000-0000-4000-8000-00000d13d001',
};

const EMAIL = {
  pa: `${TAG}.pa@example.com`,   // partner
  ev: `${TAG}.ev@example.com`,   // employee, clients.view GRANTED (default) — read + movements OK, full-record write NOT OK
  e0: `${TAG}.e0@example.com`,   // employee, clients.view REVOKED via override — zero rows, RPC rejected
  u: `${TAG}.u@example.com`,     // client_user — zero rows, RPC rejected
};

const results = [];

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

async function seed(admin) {
  await up(admin, 'firms', { id: ID.firm, name: `${TAG} Firm` });

  const paId = await ensureUser(admin, EMAIL.pa, { name: 'PA', role: 'partner', firm_id: ID.firm });
  const evId = await ensureUser(admin, EMAIL.ev, { name: 'EV', role: 'employee', firm_id: ID.firm });
  const e0Id = await ensureUser(admin, EMAIL.e0, { name: 'E0', role: 'employee', firm_id: ID.firm });
  const uId = await ensureUser(admin, EMAIL.u, { name: 'U', role: 'client_user', firm_id: ID.firm, client_id: ID.client });

  await up(admin, 'profiles', { id: paId, firm_id: ID.firm, name: 'PA', email: EMAIL.pa, role: 'partner' });
  await up(admin, 'profiles', { id: evId, firm_id: ID.firm, name: 'EV', email: EMAIL.ev, role: 'employee' });
  await up(admin, 'profiles', { id: e0Id, firm_id: ID.firm, name: 'E0', email: EMAIL.e0, role: 'employee' });

  await up(admin, 'clients', { id: ID.client, firm_id: ID.firm, name: `${TAG} Client`, business_type: 'pvt_ltd', created_by: paId });

  await up(admin, 'profiles', { id: uId, firm_id: ID.firm, name: 'U', email: EMAIL.u, role: 'client_user', client_id: ID.client });

  // E0: clients.view explicitly revoked — the same real, tested
  // configuration as rls-smoke.mjs's E2 (an override beating the employee
  // default of true).
  await up(
    admin,
    'user_permissions',
    { user_id: e0Id, permission_key: 'clients.view', granted: false, granted_by: paId },
    'user_id,permission_key'
  );

  // Seed (or reset) the DSC row itself. current_custodian_id reset to NULL
  // on every run so the "exactly one movement row" assertion below doesn't
  // accumulate across re-runs.
  await up(admin, 'dsc_register', {
    id: ID.dsc,
    firm_id: ID.firm,
    client_id: ID.client,
    holder_name: `${TAG} Holder`,
    holder_designation: 'Director',
    issuing_authority: 'eMudhra',
    dsc_class: 'Class 3',
    serial_number: `${TAG}-SERIAL-001`,
    expires_on: '2027-03-31',
    current_custodian_id: null,
    is_active: true,
    created_by: paId,
  });
  // Clear any movement history from a previous run of this script so the
  // "exactly one new row" check below is unambiguous.
  await admin.from('dsc_custody_movements').delete().eq('dsc_id', ID.dsc);

  return { paId, evId, e0Id, uId };
}

async function main() {
  const admin = adminClient();
  const ids = await seed(admin);

  const { client: pa } = await signInAs(EMAIL.pa, PASSWORD);
  const { client: ev } = await signInAs(EMAIL.ev, PASSWORD);
  const { client: e0 } = await signInAs(EMAIL.e0, PASSWORD);
  const { client: u } = await signInAs(EMAIL.u, PASSWORD);

  // ==========================================================================
  // R — reads: clients.view holders (partner + EV) see the row; E0 and the
  // client_user get zero rows on BOTH tables.
  // ==========================================================================

  {
    const { data, error } = await ev.from('dsc_register').select('id, client_id, holder_name').eq('id', ID.dsc);
    results.push(log('R1  EV (clients.view granted): CAN SELECT the DSC register row',
      !error && data?.length === 1 && data[0].holder_name === `${TAG} Holder`, error?.message || `rows: ${data?.length}`));
  }

  {
    const { data, error } = await e0.from('dsc_register').select('id, client_id, holder_name').eq('id', ID.dsc);
    results.push(log('R2  E0 (clients.view REVOKED): SELECT on dsc_register is EMPTY',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }

  {
    const { data, error } = await u.from('dsc_register').select('id').eq('id', ID.dsc);
    results.push(log('R3  client_user: SELECT on dsc_register is EMPTY',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }

  {
    const { data, error } = await e0.from('dsc_custody_movements').select('id').eq('dsc_id', ID.dsc);
    results.push(log('R4  E0 (clients.view REVOKED): SELECT on dsc_custody_movements is EMPTY',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }

  {
    const { data, error } = await u.from('dsc_custody_movements').select('id').eq('dsc_id', ID.dsc);
    results.push(log('R5  client_user: SELECT on dsc_custody_movements is EMPTY',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }

  // ==========================================================================
  // W — full-record writes: PARTNER-ONLY. EV (staff, clients.view) can read
  // but cannot create or edit a DSC record.
  // ==========================================================================

  {
    const { error } = await ev.from('dsc_register').insert({
      id: randomUUID(), firm_id: ID.firm, client_id: ID.client,
      holder_name: 'EV should not be able to create this', issuing_authority: 'eMudhra',
      dsc_class: 'Class 3', serial_number: `${TAG}-EV-ATTEMPT`, expires_on: '2027-01-01',
      created_by: ids.evId,
    });
    results.push(log('W1  EV: INSERT a new DSC record is REJECTED (partner-only)',
      !!error, error?.message || 'no error — INSERT SUCCEEDED (bug)'));
  }

  {
    const { data, error } = await ev
      .from('dsc_register')
      .update({ holder_name: 'EV should not be able to edit this' })
      .eq('id', ID.dsc)
      .select();
    results.push(log('W2  EV: direct UPDATE (edit holder_name) on dsc_register affects zero rows (partner-only)',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }

  {
    const { data, error } = await pa
      .from('dsc_register')
      .update({ holder_designation: 'Managing Director' })
      .eq('id', ID.dsc)
      .select();
    results.push(log('W3  PA (partner): CAN edit a DSC record directly',
      !error && data?.length === 1 && data[0].holder_designation === 'Managing Director', error?.message || `rows: ${data?.length}`));
  }

  // ==========================================================================
  // M — record_dsc_movement(): the ONLY path a non-partner staff member can
  // use to change custody. Gated on the SAME clients.view check as reads.
  // ==========================================================================

  {
    const { error } = await e0.rpc('record_dsc_movement', {
      p_dsc_id: ID.dsc, p_new_custodian_id: ids.e0Id, p_note: 'E0 should not be able to do this',
    });
    results.push(log('M1  E0 (clients.view REVOKED): record_dsc_movement() is REJECTED',
      !!error, error?.message || 'no error — RPC SUCCEEDED (bug)'));
  }

  {
    const { error } = await u.rpc('record_dsc_movement', {
      p_dsc_id: ID.dsc, p_new_custodian_id: ids.evId, p_note: 'client_user should not be able to do this',
    });
    results.push(log('M2  client_user: record_dsc_movement() is REJECTED',
      !!error, error?.message || 'no error — RPC SUCCEEDED (bug)'));
  }

  {
    // A client_user id is not staff — the RPC's own eligibility check must
    // reject it as a custodian even for a caller who otherwise passes the
    // clients.view gate (PA, partner).
    const { error } = await pa.rpc('record_dsc_movement', {
      p_dsc_id: ID.dsc, p_new_custodian_id: ids.uId, p_note: 'client cannot be a custodian',
    });
    results.push(log('M3  PA: record_dsc_movement() to a client_user custodian is REJECTED (custodian must be staff)',
      !!error, error?.message || 'no error — RPC SUCCEEDED (bug)'));
  }

  let movementNote;
  {
    // The legitimate path: EV (clients.view) checks the token out to herself.
    movementNote = `${TAG} check-out by EV ${Date.now()}`;
    const { error } = await ev.rpc('record_dsc_movement', {
      p_dsc_id: ID.dsc, p_new_custodian_id: ids.evId, p_note: movementNote,
    });
    results.push(log('M4  EV (clients.view granted): record_dsc_movement() check-out to self SUCCEEDS',
      !error, error?.message || 'ok'));
  }

  {
    const { data, error } = await admin
      .from('dsc_custody_movements')
      .select('movement_type, from_custodian_id, to_custodian_id, note, recorded_by')
      .eq('dsc_id', ID.dsc);
    const row = (data || [])[0];
    const correct =
      !error &&
      (data || []).length === 1 &&
      row?.movement_type === 'check_out' &&
      row?.from_custodian_id === null &&
      row?.to_custodian_id === ids.evId &&
      row?.note === movementNote;
    results.push(log('M5  Exactly ONE movement row exists after M4, with correct type/from/to/note',
      correct, error?.message || JSON.stringify(row)));
  }

  {
    // EV reads her own DSC's movement history (clients.view holders can
    // read dsc_custody_movements).
    const { data, error } = await ev.from('dsc_custody_movements').select('id, movement_type').eq('dsc_id', ID.dsc);
    results.push(log('M6  EV: CAN read the movement history she just created',
      !error && (data || []).length === 1 && data[0].movement_type === 'check_out', error?.message || `rows: ${data?.length}`));
  }

  // ==========================================================================
  // C — cron-style update to ONLY the alert-idempotency columns must write
  // NO row to dsc_custody_movements (the WHEN clause + IS DISTINCT FROM
  // guard on the trigger).
  // ==========================================================================

  {
    const { count: before } = await admin
      .from('dsc_custody_movements')
      .select('id', { count: 'exact', head: true })
      .eq('dsc_id', ID.dsc);

    const { error: updErr } = await admin
      .from('dsc_register')
      .update({ last_expiry_alert_tier: '30', last_expiry_alert_sent_for_expiry: '2027-03-31' })
      .eq('id', ID.dsc);

    const { count: after } = await admin
      .from('dsc_custody_movements')
      .select('id', { count: 'exact', head: true })
      .eq('dsc_id', ID.dsc);

    results.push(log('C1  Service-role update of ONLY last_expiry_alert_tier/last_expiry_alert_sent_for_expiry writes NO new movement row',
      !updErr && before === after, updErr?.message || `before=${before}, after=${after}`));
  }

  {
    // Sanity: the alert columns really did get written (i.e. C1's "no new
    // row" isn't just because the UPDATE itself silently failed).
    const { data, error } = await admin.from('dsc_register').select('last_expiry_alert_tier, last_expiry_alert_sent_for_expiry').eq('id', ID.dsc).single();
    results.push(log('C2  Sanity: the alert-column UPDATE in C1 actually landed',
      !error && data?.last_expiry_alert_tier === '30' && data?.last_expiry_alert_sent_for_expiry === '2027-03-31',
      error?.message || JSON.stringify(data)));
  }

  {
    // Check-in (custodian -> NULL) is also a real movement and must be
    // logged, distinct from the alert-column no-op above.
    const { error } = await ev.rpc('record_dsc_movement', {
      p_dsc_id: ID.dsc, p_new_custodian_id: null, p_note: 'returned to office safe',
    });
    const { count } = await admin
      .from('dsc_custody_movements')
      .select('id', { count: 'exact', head: true })
      .eq('dsc_id', ID.dsc);
    results.push(log('M7  check-in (custodian -> NULL) via record_dsc_movement() succeeds AND is logged (now 2 movement rows total)',
      !error && count === 2, error?.message || `count=${count}`));
  }

  // ── summary ──
  console.log('\n--- 10-dsc-register summary ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed.`);

  try {
    writeFileSync(path.join(DATA_DIR, 'results-10-dsc-register.json'), JSON.stringify(results, null, 2));
  } catch {
    // .data/ may not exist in a fresh checkout — the console output is the record.
  }
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
