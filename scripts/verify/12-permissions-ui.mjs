// Phase 13.3 — committed role-JWT RLS suite for the per-employee permissions
// editor, run BEFORE any UI code exists (Step 0 gate for this phase). Same
// house style as 10-dsc-register.mjs: self-seeding, re-runnable against the
// live project, service-role for seeding/force-seeding rows the app itself
// could never create, anon-key signInWithPassword sessions for every
// assertion — the database's own RLS is what is tested, never the app layer.
//
// WHY THIS SCRIPT EXISTS
//   Step 0 of Phase 13.3 required confirming — against the LIVE database, not
//   just schema.sql — that user_permissions writes are already
//   partner-restricted and cannot be used for privilege escalation (self-edit
//   or partner-on-partner edit) before any editor UI gets built on top of it.
//   The Supabase MCP server is not available in this environment, so this
//   script is the substitute: an empirical PostgREST probe proves MORE than
//   reading policy text would, since it exercises the deployed policies
//   directly rather than trusting a local file that has drifted from prod
//   before (see project_context.md's ROADMAP.md/migration-006 note).
//
// WHAT IT PROVES
//   escalation is blocked   — EV (employee) cannot INSERT an override for
//     for every actor           herself or for E2 (another employee) via raw
//                                PostgREST. PA1 (partner) cannot INSERT/
//                                UPDATE/DELETE an override for HERSELF, and
//                                cannot INSERT/UPDATE/DELETE one for PA2
//                                (another partner) — even though seeded rows
//                                exist for both to attack. profile_in_my_firm
//                                (user_id, 'employee') is the guard: it can
//                                never match a partner's own row or another
//                                partner's row, only a same-firm employee's.
//   client isolation         — U (client_user) gets zero rows back on SELECT
//                                even though a row is force-seeded for her by
//                                service-role (proving RLS hides it, not just
//                                "no data exists"), and every write path
//                                (INSERT/UPDATE/DELETE) is rejected too.
//   partner CAN grant/revoke/  — PA1 legitimately INSERTs, UPDATEs, and
//     clear an employee's        DELETEs overrides for EV (a same-firm
//     override                   employee) — the one path that must work.
//   override resolution is     — has_permission() is called via RPC as EV,
//     correct, not just a         before/after each override change, on TWO
//     row existing                keys with opposite employee defaults:
//                                 templates.manage (default false) to prove
//                                 GRANT flips it true, and clients.view
//                                 (default true) to prove REVOKE flips it
//                                 false and DELETE (reset-to-default, a
//                                 distinct action from revoke) flips it back
//                                 to true — the exact grant/revoke/
//                                 reset-to-default distinction the UI must
//                                 surface.
//
// SEEDING NOTES — fixed UUIDs (insert-if-absent) so the run is idempotent.
// PA1's-own-row and PA2's-row overrides are force-seeded by service-role
// (bypasses RLS) specifically because the app itself could never create
// them — that's exactly what's under test. EV/E2's overrides on the two
// probe keys are deleted at the start of each run so before/after
// has_permission() assertions aren't polluted by a previous run.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { adminClient, signInAs } from './lib/admin.mjs';
import { log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');

const TAG = 'permui1';
const PASSWORD = 'PermUiTest123!';

const ID = {
  firm: 'a0000000-0000-4000-8000-000013300001',
  client: 'a0000000-0000-4000-8000-000013300c01',
};

const EMAIL = {
  pa1: `${TAG}.pa1@example.com`, // partner — attacker on self + on pa2
  pa2: `${TAG}.pa2@example.com`, // partner — victim of pa1's attack
  ev: `${TAG}.ev@example.com`,   // employee — legitimate grant/revoke target; also self-grant attacker
  e2: `${TAG}.e2@example.com`,   // employee — victim of ev's "grant to someone else" attack
  u: `${TAG}.u@example.com`,     // client_user — isolation check
};

const GRANT_KEY = 'templates.manage'; // employee default: false
const REVOKE_KEY = 'clients.view';    // employee default: true

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

  const pa1Id = await ensureUser(admin, EMAIL.pa1, { name: 'PA1', role: 'partner', firm_id: ID.firm });
  const pa2Id = await ensureUser(admin, EMAIL.pa2, { name: 'PA2', role: 'partner', firm_id: ID.firm });
  const evId = await ensureUser(admin, EMAIL.ev, { name: 'EV', role: 'employee', firm_id: ID.firm });
  const e2Id = await ensureUser(admin, EMAIL.e2, { name: 'E2', role: 'employee', firm_id: ID.firm });
  const uId = await ensureUser(admin, EMAIL.u, { name: 'U', role: 'client_user', firm_id: ID.firm, client_id: ID.client });

  await up(admin, 'profiles', { id: pa1Id, firm_id: ID.firm, name: 'PA1', email: EMAIL.pa1, role: 'partner' });
  await up(admin, 'profiles', { id: pa2Id, firm_id: ID.firm, name: 'PA2', email: EMAIL.pa2, role: 'partner' });
  await up(admin, 'profiles', { id: evId, firm_id: ID.firm, name: 'EV', email: EMAIL.ev, role: 'employee' });
  await up(admin, 'profiles', { id: e2Id, firm_id: ID.firm, name: 'E2', email: EMAIL.e2, role: 'employee' });

  await up(admin, 'clients', { id: ID.client, firm_id: ID.firm, name: `${TAG} Client`, business_type: 'pvt_ltd', created_by: pa1Id });
  await up(admin, 'profiles', { id: uId, firm_id: ID.firm, name: 'U', email: EMAIL.u, role: 'client_user', client_id: ID.client });

  // Reset EV/E2's rows on the two probe keys so before/after has_permission()
  // checks below start from a clean, known state on every re-run.
  await admin.from('user_permissions').delete().in('user_id', [evId, e2Id]).in('permission_key', [GRANT_KEY, REVOKE_KEY]);

  // Force-seed rows the app itself could NEVER create (that's what's under
  // attack below): a partner's own override, another partner's override, and
  // a client_user's override. service-role bypasses RLS entirely for seeding.
  await up(admin, 'user_permissions', { user_id: pa1Id, permission_key: GRANT_KEY, granted: true, granted_by: pa1Id }, 'user_id,permission_key');
  await up(admin, 'user_permissions', { user_id: pa2Id, permission_key: GRANT_KEY, granted: true, granted_by: pa1Id }, 'user_id,permission_key');
  await up(admin, 'user_permissions', { user_id: uId, permission_key: GRANT_KEY, granted: true, granted_by: pa1Id }, 'user_id,permission_key');

  return { pa1Id, pa2Id, evId, e2Id, uId };
}

async function main() {
  const admin = adminClient();
  const ids = await seed(admin);

  const { client: pa1 } = await signInAs(EMAIL.pa1, PASSWORD);
  // PA2 only needs to exist as an attack target (via PA1's session below) —
  // signing in confirms the account is real and password-valid, but no
  // PostgREST call is ever made as PA2 herself.
  await signInAs(EMAIL.pa2, PASSWORD);
  const { client: ev } = await signInAs(EMAIL.ev, PASSWORD);
  const { client: u } = await signInAs(EMAIL.u, PASSWORD);

  // ==========================================================================
  // I — employee cannot escalate: not self, not anyone else, no writes at all.
  // ==========================================================================

  {
    const { data, error } = await ev
      .from('user_permissions')
      .insert({ user_id: ids.evId, permission_key: GRANT_KEY, granted: true, granted_by: ids.evId })
      .select('user_id')
      .single();
    results.push(log('I1  EV: INSERT a self-grant is REJECTED', !!error && !data,
      error?.message || 'no error — INSERT SUCCEEDED (bug: employee self-escalated)'));
  }

  {
    const { data, error } = await ev
      .from('user_permissions')
      .insert({ user_id: ids.e2Id, permission_key: GRANT_KEY, granted: true, granted_by: ids.evId })
      .select('user_id')
      .single();
    results.push(log('I2  EV: INSERT a grant for E2 (another employee) is REJECTED', !!error && !data,
      error?.message || 'no error — INSERT SUCCEEDED (bug: employee granted a peer)'));
  }

  {
    const { data, error } = await ev
      .from('user_permissions')
      .update({ granted: false })
      .eq('user_id', ids.pa1Id)
      .eq('permission_key', GRANT_KEY)
      .select();
    results.push(log('I3  EV: UPDATE on PA1\'s existing override affects zero rows', !error && (data || []).length === 0,
      error?.message || `rows: ${data?.length}`));
  }

  {
    const { data, error } = await ev
      .from('user_permissions')
      .delete()
      .eq('user_id', ids.pa1Id)
      .eq('permission_key', GRANT_KEY)
      .select();
    results.push(log('I4  EV: DELETE on PA1\'s existing override affects zero rows', !error && (data || []).length === 0,
      error?.message || `rows: ${data?.length}`));
  }

  // ==========================================================================
  // II — client_user: zero rows, zero write path, even though a row exists.
  // ==========================================================================

  {
    const { data, error } = await u.from('user_permissions').select('*').eq('user_id', ids.uId);
    results.push(log('II1 U: SELECT on user_permissions is EMPTY (row exists but is hidden)', !error && (data || []).length === 0,
      error?.message || `rows: ${data?.length}`));
  }

  {
    const { data, error } = await u
      .from('user_permissions')
      .insert({ user_id: ids.uId, permission_key: REVOKE_KEY, granted: true, granted_by: ids.uId })
      .select('user_id')
      .single();
    results.push(log('II2 U: INSERT for self is REJECTED', !!error && !data,
      error?.message || 'no error — INSERT SUCCEEDED (bug)'));
  }

  {
    const { data, error } = await u
      .from('user_permissions')
      .update({ granted: false })
      .eq('user_id', ids.uId)
      .eq('permission_key', GRANT_KEY)
      .select();
    results.push(log('II3 U: UPDATE on own existing override affects zero rows', !error && (data || []).length === 0,
      error?.message || `rows: ${data?.length}`));
  }

  {
    const { data, error } = await u
      .from('user_permissions')
      .delete()
      .eq('user_id', ids.uId)
      .eq('permission_key', GRANT_KEY)
      .select();
    results.push(log('II4 U: DELETE on own existing override affects zero rows', !error && (data || []).length === 0,
      error?.message || `rows: ${data?.length}`));
  }

  // ==========================================================================
  // III — partner guardrails: PA1 cannot touch her own row or PA2's row, via
  // any of INSERT/UPDATE/DELETE — profile_in_my_firm(user_id,'employee') can
  // never match a partner, full stop.
  // ==========================================================================

  {
    const { data, error } = await pa1
      .from('user_permissions')
      .insert({ user_id: ids.pa1Id, permission_key: REVOKE_KEY, granted: false, granted_by: ids.pa1Id })
      .select('user_id')
      .single();
    results.push(log('III1 PA1: INSERT an override for HERSELF is REJECTED', !!error && !data,
      error?.message || 'no error — INSERT SUCCEEDED (bug: partner self-edit)'));
  }

  {
    const { data, error } = await pa1
      .from('user_permissions')
      .update({ granted: false })
      .eq('user_id', ids.pa1Id)
      .eq('permission_key', GRANT_KEY)
      .select();
    results.push(log('III2 PA1: UPDATE her own existing override affects zero rows', !error && (data || []).length === 0,
      error?.message || `rows: ${data?.length}`));
  }

  {
    const { data, error } = await pa1
      .from('user_permissions')
      .delete()
      .eq('user_id', ids.pa1Id)
      .eq('permission_key', GRANT_KEY)
      .select();
    results.push(log('III3 PA1: DELETE her own existing override affects zero rows', !error && (data || []).length === 0,
      error?.message || `rows: ${data?.length}`));
  }

  {
    const { data, error } = await pa1
      .from('user_permissions')
      .insert({ user_id: ids.pa2Id, permission_key: REVOKE_KEY, granted: false, granted_by: ids.pa1Id })
      .select('user_id')
      .single();
    results.push(log('III4 PA1: INSERT an override for PA2 (another partner) is REJECTED', !!error && !data,
      error?.message || 'no error — INSERT SUCCEEDED (bug: partner-on-partner edit)'));
  }

  {
    const { data, error } = await pa1
      .from('user_permissions')
      .update({ granted: false })
      .eq('user_id', ids.pa2Id)
      .eq('permission_key', GRANT_KEY)
      .select();
    results.push(log('III5 PA1: UPDATE PA2\'s existing override affects zero rows', !error && (data || []).length === 0,
      error?.message || `rows: ${data?.length}`));
  }

  {
    const { data, error } = await pa1
      .from('user_permissions')
      .delete()
      .eq('user_id', ids.pa2Id)
      .eq('permission_key', GRANT_KEY)
      .select();
    results.push(log('III6 PA1: DELETE PA2\'s existing override affects zero rows', !error && (data || []).length === 0,
      error?.message || `rows: ${data?.length}`));
  }

  {
    // Confirm PA1's and PA2's seeded rows actually survived every attack above
    // untouched — proves III2/III3/III5/III6 were real no-ops, not silently
    // succeeding-and-then-something-else-restoring-it.
    const { data, error } = await admin
      .from('user_permissions')
      .select('user_id, granted')
      .in('user_id', [ids.pa1Id, ids.pa2Id])
      .eq('permission_key', GRANT_KEY);
    const intact = !error && (data || []).length === 2 && (data || []).every((r) => r.granted === true);
    results.push(log('III7 Sanity: PA1\'s and PA2\'s seeded overrides are untouched by all of the above', intact,
      error?.message || JSON.stringify(data)));
  }

  // ==========================================================================
  // IV — the one path that must work: PA1 grants/revokes/clears overrides for
  // EV (a same-firm employee), and has_permission() actually reflects it.
  // ==========================================================================

  {
    const { data, error } = await ev.rpc('has_permission', { p_key: GRANT_KEY });
    results.push(log(`IV1  Baseline: EV has_permission('${GRANT_KEY}') is false (employee default)`, !error && data === false,
      error?.message || `got: ${data}`));
  }

  {
    const { data, error } = await pa1
      .from('user_permissions')
      .insert({ user_id: ids.evId, permission_key: GRANT_KEY, granted: true, granted_by: ids.pa1Id })
      .select('user_id')
      .single();
    results.push(log('IV2  PA1: INSERT a grant for EV SUCCEEDS', !error && data?.user_id === ids.evId,
      error?.message || `rows: ${JSON.stringify(data)}`));
  }

  {
    const { data, error } = await ev.rpc('has_permission', { p_key: GRANT_KEY });
    results.push(log(`IV3  After grant: EV has_permission('${GRANT_KEY}') is now true`, !error && data === true,
      error?.message || `got: ${data}`));
  }

  {
    // REVOKE (override = false, distinct from removing the row): default for
    // this key is true, so this is the "explicitly turned off" case.
    const { data: baseline } = await ev.rpc('has_permission', { p_key: REVOKE_KEY });
    results.push(log(`IV4  Baseline: EV has_permission('${REVOKE_KEY}') is true (employee default)`, baseline === true,
      `got: ${baseline}`));
  }

  {
    const { data, error } = await pa1
      .from('user_permissions')
      .insert({ user_id: ids.evId, permission_key: REVOKE_KEY, granted: false, granted_by: ids.pa1Id })
      .select('user_id')
      .single();
    results.push(log('IV5  PA1: INSERT a revoke for EV SUCCEEDS', !error && data?.user_id === ids.evId,
      error?.message || `rows: ${JSON.stringify(data)}`));
  }

  {
    const { data, error } = await ev.rpc('has_permission', { p_key: REVOKE_KEY });
    results.push(log(`IV6  After revoke: EV has_permission('${REVOKE_KEY}') is now false`, !error && data === false,
      error?.message || `got: ${data}`));
  }

  {
    // Reset-to-default: DELETE the override row entirely (NOT the same action
    // as setting granted=false again — this returns the key to whatever
    // role_permissions says, which for REVOKE_KEY is true).
    const { error } = await pa1
      .from('user_permissions')
      .delete()
      .eq('user_id', ids.evId)
      .eq('permission_key', REVOKE_KEY);
    results.push(log('IV7  PA1: DELETE (reset-to-default) EV\'s override SUCCEEDS', !error,
      error?.message || 'ok'));
  }

  {
    const { data, error } = await ev.rpc('has_permission', { p_key: REVOKE_KEY });
    results.push(log(`IV8  After reset-to-default: EV has_permission('${REVOKE_KEY}') is true again (back to role default)`,
      !error && data === true, error?.message || `got: ${data}`));
  }

  {
    // Also update-in-place (not delete+insert) to prove the UPDATE policy
    // itself works for the legitimate partner->employee direction, not just
    // INSERT/DELETE.
    const { data, error } = await pa1
      .from('user_permissions')
      .update({ granted: false })
      .eq('user_id', ids.evId)
      .eq('permission_key', GRANT_KEY)
      .select('user_id, granted')
      .single();
    results.push(log('IV9  PA1: UPDATE (flip granted true->false) on EV\'s override SUCCEEDS', !error && data?.granted === false,
      error?.message || `rows: ${JSON.stringify(data)}`));
  }

  {
    const { data, error } = await ev.rpc('has_permission', { p_key: GRANT_KEY });
    results.push(log(`IV10 After UPDATE: EV has_permission('${GRANT_KEY}') is false again`, !error && data === false,
      error?.message || `got: ${data}`));
  }

  // ── summary ──
  console.log('\n--- 12-permissions-ui summary ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed.`);

  try {
    writeFileSync(path.join(DATA_DIR, 'results-12-permissions-ui.json'), JSON.stringify(results, null, 2));
  } catch {
    // .data/ may not exist in a fresh checkout — the console output is the record.
  }
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
