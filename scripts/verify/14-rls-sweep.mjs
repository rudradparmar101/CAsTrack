// Phase 14.1 — exhaustive probe-driven RLS verification sweep. Committed,
// self-seeding, re-runnable. Same house style as 07/08/10/12
// (service-role seeding, anon-key signInWithPassword sessions for every
// assertion — the app layer is bypassed entirely, the database's own RLS,
// triggers, and SECURITY DEFINER functions are what is tested).
//
// WHY THIS SCRIPT EXISTS
//   Two prior findings in this project (DSC register's is_firm_staff-vs-
//   clients.view scope, migration 008; user_permissions' self-view SELECT
//   policy, migration 009) both READ as correct policy text and were both
//   wrong in scope. Policy review does not catch scope errors — only
//   exercising the policy as a real signed-in role does. This script is
//   that exercise, applied to every table in the schema, not just the ones
//   already covered by an earlier phase's script.
//
// SCOPE
//   Every table in schema.sql (enumerated via Supabase MCP list_tables,
//   reads-only — 33 tables live, cross-checked against schema.sql's
//   CREATE TABLE statements). Every SECURITY DEFINER function that takes a
//   caller-influenced argument (the ones that only ever read auth.uid()'s
//   own context are not attack surface — noted, not probed exhaustively).
//   Storage bucket path-segment isolation. The three gaps project_context.md
//   §6 already flags by name. Cross-firm isolation for every tenant-scoped
//   table (previously asserted only for a subset of tables across the
//   07/08/10 scripts — never swept exhaustively before this).
//
// WHAT THIS SCRIPT DELIBERATELY DOES NOT RE-PROVE
//   Money-path integrity (gapless invoice numbering, concurrent issuing,
//   receipt/TDS settlement math) — already exhaustively covered by
//   08-billing-rls.mjs (29/29). DSC custody-movement mechanics — covered by
//   10-dsc-register.mjs (17/17). Permissions-editor grant/revoke/reset —
//   covered by 12-permissions-ui.mjs (25/25). This script's job is BREADTH
//   (every table, every role, cross-firm) not re-litigating depth already
//   proven elsewhere; where this script's seed touches the same tables, it
//   is proving NEW angles (cross-firm on tables those scripts never checked
//   cross-firm, or role combinations they didn't use — e.g. an
//   all-permissions-granted employee, to isolate role-only gates from
//   permission-only gates).
//
// SEEDING NOTES — fixed UUIDs (insert-if-absent, idempotent re-run). Two
// firms (A primary, B cross-firm target) with a full role roster each.
// Firm A additionally has a SECOND partner (PA2) specifically to test
// partner-on-partner boundaries on tables where the RLS predicate has no
// same-firm-partner exclusion (profiles DELETE has none — see finding P1).

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { adminClient, signInAs } from './lib/admin.mjs';
import { log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');
const BUCKET = 'client-documents';

const TAG = 'rlssweep1';
const PASSWORD = 'RlsSweep123!';

const ID = {
  firmA: 'e0000000-0000-4000-8000-000000140001',
  firmB: 'f0000000-0000-4000-8000-000000140001',
  clientA1: 'e0000000-0000-4000-8000-0000001400a1',
  clientA2: 'e0000000-0000-4000-8000-0000001400a2',
  clientA3: 'e0000000-0000-4000-8000-0000001400a3',
  clientB1: 'f0000000-0000-4000-8000-0000001400b1',
  taskGst: 'e0000000-0000-4000-8000-000000141001',
  taskIncomeTax: 'e0000000-0000-4000-8000-000000141002',
  taskA2Gst: 'e0000000-0000-4000-8000-000000141003',
  taskB: 'f0000000-0000-4000-8000-000000141001',
  docTaskLinked: 'e0000000-0000-4000-8000-000000142001',
  docTaskless: 'e0000000-0000-4000-8000-000000142002',
  docInternalPending: 'e0000000-0000-4000-8000-000000142003',
  docInternalOtherDept: 'e0000000-0000-4000-8000-000000142004',
  docB: 'f0000000-0000-4000-8000-000000142001',
  udinA: 'e0000000-0000-4000-8000-000000143001',
  dscA: 'e0000000-0000-4000-8000-000000144001',
  feeMasterA: 'e0000000-0000-4000-8000-000000145001',
  invoiceA: 'e0000000-0000-4000-8000-000000146001',
  receiptA: 'e0000000-0000-4000-8000-000000147001',
  templateA: 'e0000000-0000-4000-8000-000000148001',
  invitationA: 'e0000000-0000-4000-8000-000000149001',
  commentInternalA: 'e0000000-0000-4000-8000-00000014a001',
  commentClientA: 'e0000000-0000-4000-8000-00000014a002',
  notifPA: 'e0000000-0000-4000-8000-00000014b001',
  notifEV: 'e0000000-0000-4000-8000-00000014b002',
  registrationA: 'e0000000-0000-4000-8000-00000014c001',
};

const EMAIL = {
  pa: `${TAG}.pa@example.com`,     // Firm A partner #1
  pa2: `${TAG}.pa2@example.com`,   // Firm A partner #2 (partner-on-partner target)
  ev: `${TAG}.ev@example.com`,     // Firm A employee, pure role defaults, GST dept
  e0: `${TAG}.e0@example.com`,     // Firm A employee, EVERY permission key explicitly revoked
  ep: `${TAG}.ep@example.com`,     // Firm A employee, EVERY permission key explicitly granted
  edel: `${TAG}.edel@example.com`, // Firm A employee, throwaway DELETE target
  udel: `${TAG}.udel@example.com`, // Firm A client_user, throwaway DELETE target (F3 probe — separate from UA1/UA2, which stay alive for the rest of the sweep)
  ua1: `${TAG}.ua1@example.com`,   // Firm A / client A1 portal user
  ua2: `${TAG}.ua2@example.com`,   // Firm A / client A2 (sibling) portal user
  pb: `${TAG}.pb@example.com`,     // Firm B partner
  evb: `${TAG}.evb@example.com`,   // Firm B employee, defaults
  ub1: `${TAG}.ub1@example.com`,   // Firm B / client B1 portal user
  psa: `${TAG}.psa@example.com`,   // platform super admin — platform_admins row, NO profiles row (mirrors real bootstrap: super_admin membership is auth.users-keyed, not firm-tenant-scoped)
};

const ALL_PERMISSION_KEYS = [
  'clients.view', 'clients.manage', 'tasks.create', 'tasks.assign',
  'tasks.update_department', 'documents.upload', 'documents.approve',
  'billing.view', 'billing.manage', 'reports.view', 'team.view',
  'team.manage', 'templates.manage', 'settings.manage',
];

const results = [];
const R = (label, ok, detail = '') => results.push(log(label, ok, detail));

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

async function deptId(admin, firmId, code) {
  const { data, error } = await admin.from('departments').select('id').eq('firm_id', firmId).eq('code', code).single();
  if (error) throw new Error(`department lookup ${firmId}/${code}: ${error.message}`);
  return data.id;
}

function buf(text) {
  return new Blob([text], { type: 'text/plain' });
}

async function seed(admin) {
  // Firms first — the seed_default_departments trigger creates the 6
  // standard departments on INSERT.
  await up(admin, 'firms', { id: ID.firmA, name: `${TAG} Firm A` });
  await up(admin, 'firms', { id: ID.firmB, name: `${TAG} Firm B` });

  const gstA = await deptId(admin, ID.firmA, 'gst');
  const incomeTaxA = await deptId(admin, ID.firmA, 'income_tax');
  const gstB = await deptId(admin, ID.firmB, 'gst');

  const paId = await ensureUser(admin, EMAIL.pa, { name: 'PA', role: 'partner', firm_id: ID.firmA });
  const pa2Id = await ensureUser(admin, EMAIL.pa2, { name: 'PA2', role: 'partner', firm_id: ID.firmA });
  const evId = await ensureUser(admin, EMAIL.ev, { name: 'EV', role: 'employee', firm_id: ID.firmA });
  const e0Id = await ensureUser(admin, EMAIL.e0, { name: 'E0', role: 'employee', firm_id: ID.firmA });
  const epId = await ensureUser(admin, EMAIL.ep, { name: 'EP', role: 'employee', firm_id: ID.firmA });
  const edelId = await ensureUser(admin, EMAIL.edel, { name: 'EDEL', role: 'employee', firm_id: ID.firmA });
  const pbId = await ensureUser(admin, EMAIL.pb, { name: 'PB', role: 'partner', firm_id: ID.firmB });
  const evbId = await ensureUser(admin, EMAIL.evb, { name: 'EVB', role: 'employee', firm_id: ID.firmB });

  await up(admin, 'profiles', { id: paId, firm_id: ID.firmA, name: 'PA', email: EMAIL.pa, role: 'partner' });
  await up(admin, 'profiles', { id: pa2Id, firm_id: ID.firmA, name: 'PA2', email: EMAIL.pa2, role: 'partner' });
  await up(admin, 'profiles', { id: evId, firm_id: ID.firmA, name: 'EV', email: EMAIL.ev, role: 'employee' });
  await up(admin, 'profiles', { id: e0Id, firm_id: ID.firmA, name: 'E0', email: EMAIL.e0, role: 'employee' });
  await up(admin, 'profiles', { id: epId, firm_id: ID.firmA, name: 'EP', email: EMAIL.ep, role: 'employee' });
  await up(admin, 'profiles', { id: edelId, firm_id: ID.firmA, name: 'EDEL', email: EMAIL.edel, role: 'employee' });
  await up(admin, 'profiles', { id: pbId, firm_id: ID.firmB, name: 'PB', email: EMAIL.pb, role: 'partner' });
  await up(admin, 'profiles', { id: evbId, firm_id: ID.firmB, name: 'EVB', email: EMAIL.evb, role: 'employee' });

  await up(admin, 'clients', { id: ID.clientA1, firm_id: ID.firmA, name: `${TAG} Client A1`, business_type: 'pvt_ltd', created_by: paId });
  await up(admin, 'clients', { id: ID.clientA2, firm_id: ID.firmA, name: `${TAG} Client A2`, business_type: 'individual', created_by: paId });
  // A3: referenced by NO task at all (unlike A2, which taskA2Gst references
  // via the GST department EV/E0/EP all belong to — employee_has_task_for_
  // client() matches on DEPARTMENT, not just direct assignment, so A2 alone
  // cannot isolate "truly no task relationship" from "department has a task
  // for this client"). A3 is the genuine zero-relationship negative case.
  await up(admin, 'clients', { id: ID.clientA3, firm_id: ID.firmA, name: `${TAG} Client A3`, business_type: 'individual', created_by: paId });
  await up(admin, 'clients', { id: ID.clientB1, firm_id: ID.firmB, name: `${TAG} Client B1`, business_type: 'pvt_ltd', created_by: pbId });

  const ua1Id = await ensureUser(admin, EMAIL.ua1, { name: 'UA1', role: 'client_user', firm_id: ID.firmA, client_id: ID.clientA1 });
  const ua2Id = await ensureUser(admin, EMAIL.ua2, { name: 'UA2', role: 'client_user', firm_id: ID.firmA, client_id: ID.clientA2 });
  const ub1Id = await ensureUser(admin, EMAIL.ub1, { name: 'UB1', role: 'client_user', firm_id: ID.firmB, client_id: ID.clientB1 });
  const udelId = await ensureUser(admin, EMAIL.udel, { name: 'UDEL', role: 'client_user', firm_id: ID.firmA, client_id: ID.clientA1 });
  await up(admin, 'profiles', { id: ua1Id, firm_id: ID.firmA, name: 'UA1', email: EMAIL.ua1, role: 'client_user', client_id: ID.clientA1 });
  await up(admin, 'profiles', { id: ua2Id, firm_id: ID.firmA, name: 'UA2', email: EMAIL.ua2, role: 'client_user', client_id: ID.clientA2 });
  await up(admin, 'profiles', { id: ub1Id, firm_id: ID.firmB, name: 'UB1', email: EMAIL.ub1, role: 'client_user', client_id: ID.clientB1 });
  // UDEL is a throwaway DELETE target for the F3 probe (migration 013) — kept
  // separate from UA1/UA2, which stay alive and signed-in for the rest of
  // this run's checks.
  await up(admin, 'profiles', { id: udelId, firm_id: ID.firmA, name: 'UDEL', email: EMAIL.udel, role: 'client_user', client_id: ID.clientA1 });

  // Department membership: EV/E0/EP all in Firm A's GST dept only (never
  // income_tax) — this is what makes taskIncomeTax a genuine out-of-scope
  // negative case for all three.
  for (const uid of [evId, e0Id, epId]) {
    await up(admin, 'department_members', { department_id: gstA, user_id: uid }, 'department_id,user_id');
  }
  await up(admin, 'department_members', { department_id: gstB, user_id: evbId }, 'department_id,user_id');

  // E0: every permission key explicitly revoked. EP: every key explicitly
  // granted. This isolates "denied because permission" from "denied because
  // role" for every permission-gated table below.
  for (const key of ALL_PERMISSION_KEYS) {
    await up(admin, 'user_permissions', { user_id: e0Id, permission_key: key, granted: false, granted_by: paId }, 'user_id,permission_key');
    await up(admin, 'user_permissions', { user_id: epId, permission_key: key, granted: true, granted_by: paId }, 'user_id,permission_key');
  }
  // EV keeps pure role defaults — no override rows.
  await admin.from('user_permissions').delete().eq('user_id', evId);

  // ONE deliberate exception on E0: tasks.update_department = true (tasks.assign
  // stays false). This isolates the tasks.assign gap cleanly — E0 gets to
  // update department tasks via a DIFFERENT permission, and the question is
  // whether reassigning `assigned_to` is blocked by that policy needing
  // tasks.assign too (it isn't — see the FINDING-CHECK below).
  await up(admin, 'user_permissions', { user_id: e0Id, permission_key: 'tasks.update_department', granted: true, granted_by: paId }, 'user_id,permission_key');

  // A SECOND deliberate exception on E0, for the F4 INSERT-time probe
  // (migration 014's trigger is BEFORE UPDATE only — it says nothing about
  // assigning on INSERT): tasks.create = true, tasks.assign stays false.
  // Isolates "can tasks.create alone set assigned_to on a brand-new task"
  // from "can tasks.assign-less reassignment happen on an EXISTING task"
  // (already covered by the tasks.update_department exception above).
  await up(admin, 'user_permissions', { user_id: e0Id, permission_key: 'tasks.create', granted: true, granted_by: paId }, 'user_id,permission_key');

  // Tasks: taskGst (EV's dept, assigned to EV, client A1) — the in-scope
  // positive case. taskIncomeTax (different dept, unassigned, client A1) —
  // out of scope for EV/E0/EP. taskA2Gst (EV's dept, but client A2) — used
  // for employee_has_task_for_client() checks. taskB — Firm B's mirror.
  await up(admin, 'tasks', {
    id: ID.taskGst, firm_id: ID.firmA, client_id: ID.clientA1, department_id: gstA,
    title: `${TAG} GST task`, due_date: '2027-01-31', assigned_to: evId, visible_to_client: true,
    stage: 'in_progress', created_by: paId,
  });
  await up(admin, 'tasks', {
    id: ID.taskIncomeTax, firm_id: ID.firmA, client_id: ID.clientA1, department_id: incomeTaxA,
    title: `${TAG} Income-tax task (not EV's dept)`, due_date: '2027-01-31', assigned_to: null,
    visible_to_client: true, stage: 'in_progress', created_by: paId,
  });
  await up(admin, 'tasks', {
    id: ID.taskA2Gst, firm_id: ID.firmA, client_id: ID.clientA2, department_id: gstA,
    title: `${TAG} GST task for A2`, due_date: '2027-01-31', assigned_to: evId,
    visible_to_client: true, stage: 'in_progress', created_by: paId,
  });
  await up(admin, 'tasks', {
    id: ID.taskB, firm_id: ID.firmB, client_id: ID.clientB1, department_id: gstB,
    title: `${TAG} Firm B task`, due_date: '2027-01-31', assigned_to: evbId,
    visible_to_client: true, stage: 'in_progress', created_by: pbId,
  });

  // Documents: task-linked+approved+visible (docTaskLinked); task-LESS,
  // client A3 (GENUINELY zero task/department relationship — see the A3
  // comment above), visible+pending (docTaskless — the flagged Ph3
  // relaxation probe: the (task_id IS NULL AND clients.view) branch is what
  // grants EV access despite no task anywhere touching A3); internal/pending/
  // hidden on E0's OWN department's task (docInternalPending — client
  // isolation only, NOT a staff-denial case, since E0's department gives her
  // legitimate staff_can_access_task() access here); internal/pending/hidden
  // on a DIFFERENT department's task (docInternalOtherDept — E0 IS correctly
  // denied at the table layer here, which is what makes it the right doc for
  // the staff-storage-broad-access probe).
  await up(admin, 'documents', {
    id: ID.docTaskLinked, firm_id: ID.firmA, client_id: ID.clientA1, task_id: ID.taskGst,
    name: 'Linked doc', approval_status: 'approved', visible_to_client: true, uploaded_by: paId,
  });
  await up(admin, 'documents', {
    id: ID.docTaskless, firm_id: ID.firmA, client_id: ID.clientA3, task_id: null,
    name: 'Taskless doc for A3', approval_status: 'pending', visible_to_client: true, uploaded_by: paId,
  });
  await up(admin, 'documents', {
    id: ID.docInternalPending, firm_id: ID.firmA, client_id: ID.clientA1, task_id: ID.taskGst,
    name: 'Internal pending doc (EV/E0\'s own dept task)', approval_status: 'pending', visible_to_client: false, uploaded_by: paId,
  });
  await up(admin, 'documents', {
    id: ID.docInternalOtherDept, firm_id: ID.firmA, client_id: ID.clientA1, task_id: ID.taskIncomeTax,
    name: 'Internal pending doc (a DIFFERENT department\'s task)', approval_status: 'pending', visible_to_client: false, uploaded_by: paId,
  });
  await up(admin, 'documents', {
    id: ID.docB, firm_id: ID.firmB, client_id: ID.clientB1, task_id: ID.taskB,
    name: 'Firm B doc', approval_status: 'approved', visible_to_client: true, uploaded_by: pbId,
  });

  await putObjectIfAbsent(admin, `${ID.firmA}/${ID.clientA1}/${ID.docInternalPending}/11111111-1111-4111-8111-111111111111.txt`, 'internal pending contents');
  await putObjectIfAbsent(admin, `${ID.firmA}/${ID.clientA1}/${ID.docTaskLinked}/22222222-2222-4222-8222-222222222222.txt`, 'linked approved contents');
  await putObjectIfAbsent(admin, `${ID.firmA}/${ID.clientA1}/${ID.docInternalOtherDept}/33333333-3333-4333-8333-333333333333.txt`, 'internal other-department contents');

  // A comment thread on taskGst: one internal, one client-visible.
  await up(admin, 'task_comments', {
    id: ID.commentInternalA, firm_id: ID.firmA, task_id: ID.taskGst, content: 'internal note',
    visible_to_client: false, created_by: paId,
  });
  await up(admin, 'task_comments', {
    id: ID.commentClientA, firm_id: ID.firmA, task_id: ID.taskGst, content: 'client-visible note',
    visible_to_client: true, created_by: paId,
  });

  // A portal invitation row (for client_portal_invitations coverage — not
  // used to actually invite anyone this run).
  await up(admin, 'client_portal_invitations', {
    id: ID.invitationA, firm_id: ID.firmA, client_id: ID.clientA1, email: 'nobody@example.com',
    token: `${TAG}-token-${ID.invitationA}`, invited_by: paId,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  });

  await up(admin, 'client_registrations', {
    id: ID.registrationA, firm_id: ID.firmA, client_id: ID.clientA1,
    type: 'gstin', registration_number: '27ABCDE1234F1Z5', gst_scheme: 'regular',
  });

  await up(admin, 'task_templates', {
    id: ID.templateA, firm_id: ID.firmA, department_id: gstA, title: `${TAG} template`, created_by: paId,
  });

  await up(admin, 'udin_register', {
    id: ID.udinA, firm_id: ID.firmA, client_id: ID.clientA1, udin: 'ABC123456789012345',
    document_type: 'Tax Audit Report', signing_partner_id: paId, created_by: paId,
  });

  await up(admin, 'dsc_register', {
    id: ID.dscA, firm_id: ID.firmA, client_id: ID.clientA1, holder_name: `${TAG} Holder`,
    issuing_authority: 'eMudhra', dsc_class: 'Class 3', serial_number: `${TAG}-SERIAL`,
    expires_on: '2027-03-31', is_active: true, created_by: paId,
  });

  await up(admin, 'fee_masters', {
    id: ID.feeMasterA, firm_id: ID.firmA, client_id: null, service_name: `${TAG} GST filing`,
    amount: 5000, periodicity: 'monthly',
  });

  await up(admin, 'firm_invoices', {
    id: ID.invoiceA, firm_id: ID.firmA, client_id: ID.clientA1, status: 'draft',
    financial_year: '2026-27', created_by: paId,
  });

  // On-account receipt (invoice_id NULL — migration 006's addition, confirmed
  // LIVE on this project even though project_context.md/DECISIONS.md/
  // ROADMAP.md describe migration 006 as drafted-not-applied; see the
  // FINDINGS doc). Fires log_receipt_change() -> writes receipt_history.
  await up(admin, 'receipts', {
    id: ID.receiptA, firm_id: ID.firmA, client_id: ID.clientA1, invoice_id: null,
    amount: 1000, mode: 'upi', created_by: paId,
  });

  // Subscription rows for BOTH firms (none exist live for these throwaway
  // firms) — Firm B needs one too, not just Firm A, so the get_firm_plan()
  // cross-firm probe below returns REAL plan data for Firm B rather than an
  // all-NULL composite (which a zero-row match would otherwise produce and
  // make the "leak" look hollow).
  const { data: anyPlan } = await admin.from('plans').select('id').limit(1).single();
  if (anyPlan) {
    for (const firmId of [ID.firmA, ID.firmB]) {
      const { data: existingSub } = await admin.from('firm_subscriptions').select('id').eq('firm_id', firmId).maybeSingle();
      if (!existingSub) {
        await admin.from('firm_subscriptions').insert({
          firm_id: firmId, plan_id: anyPlan.id, status: 'active',
          current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        });
      }
    }
  }

  await up(admin, 'notifications', {
    id: ID.notifPA, firm_id: ID.firmA, user_id: paId, type: 'task_assigned',
    title: 'seed', message: 'seed notification for PA',
  });
  await up(admin, 'notifications', {
    id: ID.notifEV, firm_id: ID.firmA, user_id: evId, type: 'task_assigned',
    title: 'seed', message: 'seed notification for EV',
  });

  // Platform super admin: auth user + platform_admins row, deliberately NO
  // profiles row at all — platform_admins.user_id FKs to auth.users, not
  // profiles, and this mirrors the real bootstrap path (SQL editor / service
  // role insert, no tenant membership). get_user_firm_id() resolves to NULL
  // for this user (no profiles row to look up), which is exactly why
  // get_firm_plan()'s ownership check must be bypassed for is_super_admin()
  // rather than merely widened.
  const psaId = await ensureUser(admin, EMAIL.psa, { name: 'PSA' });
  await up(admin, 'platform_admins', { user_id: psaId, note: `${TAG} seed` }, 'user_id');

  return { paId, pa2Id, evId, e0Id, epId, edelId, udelId, pbId, evbId, ua1Id, ua2Id, ub1Id, psaId, gstA, incomeTaxA, gstB };
}

async function putObjectIfAbsent(admin, objPath, body) {
  const { data } = await admin.storage.from(BUCKET).list(path.dirname(objPath));
  const name = path.basename(objPath);
  if (data?.some((f) => f.name === name)) return;
  const { error } = await admin.storage.from(BUCKET).upload(objPath, buf(body), { contentType: 'text/plain', upsert: true });
  if (error) throw new Error(`upload ${objPath}: ${error.message}`);
}

// Generic cross-firm SELECT probe: `client` (signed in as some role in one
// firm) attempts to SELECT a specific row id in `table` that belongs to the
// OTHER firm. Expects 0 rows.
async function crossFirmZero(client, table, idColumn, idValue, label) {
  const { data, error } = await client.from(table).select('*').eq(idColumn, idValue);
  R(label, !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
}

async function main() {
  const admin = adminClient();
  const ids = await seed(admin);

  const { client: pa } = await signInAs(EMAIL.pa, PASSWORD);
  // PA2 only needs to exist as a DELETE target for the profiles finding-check
  // below (via PA's session) — no PostgREST call is ever made as PA2 herself.
  await signInAs(EMAIL.pa2, PASSWORD);
  const { client: ev } = await signInAs(EMAIL.ev, PASSWORD);
  const { client: e0 } = await signInAs(EMAIL.e0, PASSWORD);
  const { client: ep } = await signInAs(EMAIL.ep, PASSWORD);
  const { client: ua1 } = await signInAs(EMAIL.ua1, PASSWORD);
  const { client: ua2 } = await signInAs(EMAIL.ua2, PASSWORD);
  const { client: pb } = await signInAs(EMAIL.pb, PASSWORD);
  const { client: evb } = await signInAs(EMAIL.evb, PASSWORD);
  const { client: ub1 } = await signInAs(EMAIL.ub1, PASSWORD);
  const { client: psa } = await signInAs(EMAIL.psa, PASSWORD);

  // ==========================================================================
  // 1. PLATFORM-LEVEL CATALOG TABLES (no firm_id — global by design)
  // ==========================================================================

  {
    const { data, error } = await ev.from('permissions').select('key');
    R('permissions: any authenticated user reads the catalog (by design, no tenant data)', !error && (data || []).length > 0, error?.message);
  }
  {
    const { data, error } = await ev.from('permissions').insert({ key: `${TAG}.fake`, description: 'x', category: 'x' }).select().single();
    R('permissions: non-super-admin INSERT denied', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug)');
  }
  {
    const { data, error } = await ev.from('role_permissions').select('role');
    R('role_permissions: any authenticated user reads defaults (by design)', !error && (data || []).length > 0, error?.message);
  }
  {
    const { data, error } = await ev.from('role_permissions').update({ allowed: true }).eq('role', 'employee').eq('permission_key', 'billing.manage').select();
    R('role_permissions: non-super-admin UPDATE denied', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ev.from('compliance_types').select('code').limit(1);
    R('compliance_types: any authenticated user reads active types (by design)', !error && (data || []).length > 0, error?.message);
  }
  {
    const { data, error } = await ev.from('compliance_types').insert({ code: `${TAG}fake`, name: 'x', department_code: 'gst', periodicity: 'monthly' }).select().single();
    R('compliance_types: non-super-admin INSERT denied', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug)');
  }
  {
    const { data, error } = await ev.from('plans').select('code').limit(1);
    R('plans: any authenticated user reads active plans (by design)', !error && (data || []).length > 0, error?.message);
  }
  {
    const { data: anyPlan } = await ev.from('plans').select('id').limit(1).single();
    const { data, error } = await ev.from('plans').update({ is_active: false }).eq('id', anyPlan.id).select();
    R('plans: non-super-admin UPDATE denied', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ev.from('platform_admins').select('*');
    R('platform_admins: non-super-admin SELECT returns zero rows', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ev.from('platform_admins').insert({ user_id: ids.evId }).select().single();
    R('platform_admins: non-super-admin INSERT (self-promotion attempt) denied', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug)');
  }

  // ==========================================================================
  // 2. firms
  // ==========================================================================

  {
    const { data } = await pa.from('firms').select('id').eq('id', ID.firmA);
    R('firms: PA sees her own firm', (data || []).length === 1);
  }
  await crossFirmZero(pa, 'firms', 'id', ID.firmB, 'firms: PA gets ZERO rows for Firm B (cross-firm)');
  {
    const { data, error } = await pa.from('firms').update({ name: 'renamed by PA' }).eq('id', ID.firmB).select();
    R('firms: PA UPDATE on Firm B affects zero rows', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ev.from('firms').update({ name: 'renamed by EV' }).eq('id', ID.firmA).select();
    R('firms: EV (employee) UPDATE on own firm affects zero rows (partner-only)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ua1.from('firms').select('id, name').eq('id', ID.firmA);
    R('firms: client_user CAN read own firm name/branding (by design)', !error && (data || []).length === 1, error?.message);
  }

  // ==========================================================================
  // 3. departments / department_members
  // ==========================================================================

  await crossFirmZero(pa, 'departments', 'firm_id', ID.firmB, 'departments: PA gets ZERO rows for Firm B (cross-firm)');
  {
    const { data, error } = await ua1.from('departments').select('*').eq('firm_id', ID.firmA);
    R('departments: client_user gets ZERO rows (staff-only table)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ev.from('departments').insert({ firm_id: ID.firmA, code: `${TAG}dept`, name: 'x' }).select().single();
    R('departments: EV (no team.manage) INSERT denied', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug)');
  }
  {
    const { data, error } = await ep.from('departments').insert({ firm_id: ID.firmA, code: `${TAG}dept${randomUUID().slice(0, 8)}`, name: 'x' }).select().single();
    R('departments: EP (team.manage GRANTED) INSERT succeeds', !error && !!data, error?.message);
  }
  await crossFirmZero(pa, 'department_members', 'department_id', ids.gstB, 'department_members: PA gets ZERO rows for Firm B GST dept (cross-firm)');
  {
    const { data, error } = await ua1.from('department_members').select('*');
    R('department_members: client_user gets ZERO rows (staff-only table)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }

  // ==========================================================================
  // 4. profiles — including the partner-on-partner DELETE finding
  // ==========================================================================

  await crossFirmZero(pa, 'profiles', 'id', ids.pbId, 'profiles: PA gets ZERO rows for Firm B\'s partner (cross-firm)');
  {
    const { data, error } = await ua1.from('profiles').select('id, name').neq('id', ids.ua1Id);
    R('profiles: client_user cannot enumerate OTHER profiles in her own firm', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ev.from('profiles').select('id').eq('firm_id', ID.firmA);
    R('profiles: EV (staff) sees all firm-A profiles', !error && (data || []).length >= 6, error?.message || `rows: ${data?.length}`);
  }
  // F3 FIX PROBE (migration 013): "Partners can remove profiles in their
  // firm" now also excludes role = 'partner' from the DELETE target, on top
  // of the pre-existing self-deletion guard. Four cases prove the exclusion
  // is scoped exactly right — blocks the governance-sensitive target,
  // leaves both other legitimate targets untouched.
  {
    // 1. Partner-on-partner: PA (partner) attempts to delete PA2 (a
    // co-partner, same firm) — must now be REJECTED. This was the original
    // F3 finding — PA succeeded here before the fix.
    const { data, error } = await pa.from('profiles').delete().eq('id', ids.pa2Id).select();
    const ok = !error && (data || []).length === 0;
    R('F3 fix: PA (partner) is DENIED deleting PA2 (a CO-PARTNER, same firm) — target-role exclusion enforced',
      ok, ok ? `rows deleted: 0` : `rows deleted: ${data?.length ?? 0} — gap still open (${error?.message || 'no error, but a row was deleted'})`);
  }
  {
    // 2. Partner removing an employee — the one clearly legitimate case —
    // must still succeed, no regression.
    const { data, error } = await pa.from('profiles').delete().eq('id', ids.edelId).select();
    R('F3 fix: PA (partner) DELETE on EDEL (an employee, same firm) still SUCCEEDS (no regression)', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    // 3. Self-deletion — already blocked by the pre-existing id <> auth.uid()
    // guard, untouched by this migration; re-confirmed here.
    const { data, error } = await pa.from('profiles').delete().eq('id', ids.paId).select();
    R('F3 fix: PA still cannot delete HERSELF (id <> auth.uid() guard, unaffected by this migration)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    // 4. NEW — client_user target: the exclusion is negative (role <>
    // 'partner'), so a client_user profile is still a permitted DELETE
    // target. Establishing this empirically, not assuming it: PA deletes
    // UDEL (a throwaway client_user, kept separate from UA1/UA2 so the rest
    // of this run's client_user-dependent checks are unaffected). This is
    // recorded as INTENDED (see project_context.md/DECISIONS.md) — a
    // partner revoking a client's portal login is a legitimate firm-
    // administered cleanup action, structurally the lowest-risk of the
    // three targets this policy could ever reach (no elevated privilege to
    // lose, unlike a co-partner), and today the only path (even in
    // principle) to ever cut off a client's portal access, since no
    // dedicated "revoke portal access" UI exists yet.
    const { data, error } = await pa.from('profiles').delete().eq('id', ids.udelId).select();
    R('F3 fix: PA (partner) DELETE on UDEL (a client_user, same firm) still SUCCEEDS — negative exclusion permits this target, recorded as INTENDED',
      !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }

  // ==========================================================================
  // 5. user_permissions — cross-firm (NOT covered by 12-permissions-ui.mjs)
  // ==========================================================================

  await crossFirmZero(pa, 'user_permissions', 'user_id', ids.evbId, 'user_permissions: PA gets ZERO rows for Firm B\'s employee overrides (cross-firm)');
  {
    const { data, error } = await pa.from('user_permissions').insert({ user_id: ids.evbId, permission_key: 'clients.view', granted: true, granted_by: ids.paId }).select().single();
    R('user_permissions: PA (Firm A partner) CANNOT grant an override to Firm B\'s employee (cross-firm)', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug)');
  }

  // ==========================================================================
  // 6. firm_subscriptions / subscription_invoices
  // ==========================================================================

  {
    const { data, error } = await ep.from('firm_subscriptions').select('*').eq('firm_id', ID.firmA);
    R('firm_subscriptions: employee WITH billing.view sees the subscription', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await e0.from('firm_subscriptions').select('*').eq('firm_id', ID.firmA);
    R('firm_subscriptions: employee WITHOUT billing.view sees ZERO rows', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  await crossFirmZero(pa, 'firm_subscriptions', 'firm_id', ID.firmB, 'firm_subscriptions: PA gets ZERO rows for Firm B (cross-firm)');
  {
    const { data, error } = await ep.from('firm_subscriptions').update({ status: 'cancelled' }).eq('firm_id', ID.firmA).select();
    R('firm_subscriptions: non-super-admin UPDATE denied even with billing.view+manage granted', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }

  // ==========================================================================
  // 7. clients / client_addresses / client_authorized_persons / client_registrations
  // ==========================================================================

  {
    const { data, error } = await ev.from('clients').select('id').eq('id', ID.clientA1);
    R('clients: EV (clients.view default true) sees client A1', !error && (data || []).length === 1, error?.message);
  }
  {
    const { data, error } = await e0.from('clients').select('id').eq('id', ID.clientA1);
    R('clients: E0 (clients.view revoked, but has a task for A1) STILL sees client A1 via employee_has_task_for_client', !error && (data || []).length === 0 === false, error?.message);
  }
  {
    // A2 is deliberately NOT the negative case here: taskA2Gst is a GST-
    // department task, and E0 IS a member of the GST department, so
    // employee_has_task_for_client(A2) resolves TRUE via department
    // membership alone (no direct assignment needed) — confirmed below as
    // its own labeled behavior, not a bug.
    const { data, error } = await e0.from('clients').select('id').eq('id', ID.clientA2);
    R('clients: E0 (clients.view revoked) STILL sees A2 because her DEPARTMENT (not just her assignments) has a task for A2', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    // A3: genuinely zero relationship (no task, no department task) — the real negative case.
    const { data, error } = await e0.from('clients').select('id').eq('id', ID.clientA3);
    R('clients: E0 (clients.view revoked, ZERO tasks reference A3) sees ZERO rows for A3', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  await crossFirmZero(pa, 'clients', 'id', ID.clientB1, 'clients: PA gets ZERO rows for Firm B\'s client (cross-firm)');
  {
    const { data, error } = await ua1.from('clients').select('id').eq('id', ID.clientA2);
    R('clients: UA1 (client_user, own client A1) sees ZERO rows for sibling A2', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    // Client-side cross-firm isolation (not just staff-side, tested elsewhere):
    // UB1 (Firm B's portal client) attempting to read Firm A's client record.
    const { data, error } = await ub1.from('clients').select('id').eq('id', ID.clientA1);
    R('clients: UB1 (Firm B client_user) gets ZERO rows for Firm A\'s client (cross-firm, client-side)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ub1.from('tasks').select('id').eq('id', ID.taskGst);
    R('tasks: UB1 (Firm B client_user) gets ZERO rows for Firm A\'s task (cross-firm, client-side)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ev.from('clients').update({ notes: 'edited by EV' }).eq('id', ID.clientA1).select();
    R('clients: EV (no clients.manage) UPDATE denied', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ep.from('clients').update({ notes: 'edited by EP' }).eq('id', ID.clientA1).select();
    R('clients: EP (clients.manage GRANTED) UPDATE succeeds', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await pa.from('clients').delete().eq('id', ID.clientA1).select();
    R('clients: NO DELETE policy at all — even a partner\'s DELETE affects zero rows (by design, F6)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
    const { data: stillThere } = await admin.from('clients').select('id').eq('id', ID.clientA1).single();
    R('clients: sanity — client A1 still exists after the denied DELETE attempt', !!stillThere);
  }
  for (const [table, col] of [['client_addresses', 'client_id'], ['client_authorized_persons', 'client_id'], ['client_registrations', 'client_id']]) {
    const { data, error } = await ua2.from(table).select('*').eq(col, ID.clientA1);
    R(`${table}: UA2 (sibling client_user) sees ZERO rows for A1's ${table}`, !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
    await crossFirmZero(pa, table, col, ID.clientB1, `${table}: PA gets ZERO rows for Firm B (cross-firm, by client_id)`);
  }

  // ==========================================================================
  // 8. client_portal_invitations
  // ==========================================================================

  {
    const { data, error } = await ev.from('client_portal_invitations').select('*').eq('id', ID.invitationA);
    R('client_portal_invitations: EV (clients.manage default false) sees ZERO rows', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ep.from('client_portal_invitations').select('*').eq('id', ID.invitationA);
    R('client_portal_invitations: EP (clients.manage GRANTED) sees the invitation', !error && (data || []).length === 1, error?.message);
  }
  {
    const { data, error } = await ua1.from('client_portal_invitations').select('*');
    R('client_portal_invitations: client_user has NO path — ZERO rows', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await pb.from('client_portal_invitations').select('*').eq('id', ID.invitationA);
    R('client_portal_invitations: PB (Firm B partner) gets ZERO rows for Firm A\'s invitation (cross-firm)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }

  // ==========================================================================
  // 9. tasks — including the tasks.assign gap proof
  // ==========================================================================

  {
    const { data, error } = await ev.from('tasks').select('id').eq('id', ID.taskGst);
    R('tasks: EV sees her assigned task (own department)', !error && (data || []).length === 1, error?.message);
  }
  {
    const { data, error } = await ev.from('tasks').select('id').eq('id', ID.taskIncomeTax);
    R('tasks: EV gets ZERO rows for a task in a DIFFERENT department, unassigned', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  await crossFirmZero(pa, 'tasks', 'id', ID.taskB, 'tasks: PA gets ZERO rows for Firm B\'s task (cross-firm)');
  {
    const { data, error } = await ua2.from('tasks').select('id').eq('id', ID.taskGst);
    R('tasks: UA2 (sibling client) sees ZERO rows for A1\'s task', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  // F4 FIX PROBE (migration 014): a BEFORE UPDATE trigger now blocks
  // assigned_to changes unless the caller holds has_permission('tasks.assign')
  // (which already resolves true for partner/super_admin). Five cases —
  // the trigger fix itself, its two no-regression paths, an unrelated-column
  // update proving the trigger is scoped to assigned_to only, and a fifth,
  // newly-raised question about the INSERT-time path the trigger can't
  // cover at all.
  {
    // 1. E0 (tasks.assign explicitly REVOKED, only tasks.update_department
    // granted) attempts to reassign taskA2Gst (her department, not her
    // assignment) — must now be REJECTED. This was the original F4 finding.
    const { error } = await e0.from('tasks').update({ assigned_to: ids.epId }).eq('id', ID.taskA2Gst).select();
    R('F4 fix: E0 (tasks.assign revoked, tasks.update_department granted) is REJECTED reassigning taskA2Gst (department update alone no longer suffices)',
      !!error, error ? `denied: ${error.message}` : 'reassignment SUCCEEDED — gap still open');
  }
  {
    // 2. Partner bypass: PA can still reassign — has_permission('tasks.assign')
    // resolves true for partner internally, no separate branch needed.
    const { data, error } = await pa.from('tasks').update({ assigned_to: ids.epId }).eq('id', ID.taskA2Gst).select();
    R('F4 fix: PA (partner) SUCCEEDS reassigning taskA2Gst (bypass intact)',
      !error && (data || []).length === 1 && data[0].assigned_to === ids.epId, error?.message || `rows: ${JSON.stringify(data)}`);
    await admin.from('tasks').update({ assigned_to: ids.evId }).eq('id', ID.taskA2Gst); // restore for idempotent re-runs
  }
  {
    // 3. tasks.assign holder: EP (every permission granted, including
    // tasks.assign) reassigns — no regression for the legitimate path.
    const { data, error } = await ep.from('tasks').update({ assigned_to: ids.e0Id }).eq('id', ID.taskA2Gst).select();
    R('F4 fix: EP (tasks.assign granted) SUCCEEDS reassigning taskA2Gst (no regression)',
      !error && (data || []).length === 1 && data[0].assigned_to === ids.e0Id, error?.message || `rows: ${JSON.stringify(data)}`);
    await admin.from('tasks').update({ assigned_to: ids.evId }).eq('id', ID.taskA2Gst); // restore for idempotent re-runs
  }
  {
    // 4. Department update NOT touching assigned_to: E0 (no tasks.assign)
    // updates taskA2Gst's title via tasks.update_department alone — must
    // still succeed. Proves the trigger is scoped to assigned_to only and
    // hasn't over-restricted tasks.update_department's own intended reach.
    const { data, error } = await e0.from('tasks').update({ title: `${TAG} GST task for A2 (F4 probe)` }).eq('id', ID.taskA2Gst).select();
    R('F4 fix: E0 (no tasks.assign) SUCCEEDS updating taskA2Gst\'s title via tasks.update_department alone (trigger scoped to assigned_to only)',
      !error && (data || []).length === 1, error?.message || `rows: ${JSON.stringify(data)}`);
  }
  {
    // 5. NEW, raised by Jay: the trigger is BEFORE UPDATE only — it says
    // nothing about assignment via INSERT. E0 now also holds tasks.create
    // (granted for this probe alone, see the seed comment) but still lacks
    // tasks.assign. She creates a BRAND-NEW task in her own department
    // (gstA) with assigned_to already set to EV (a same-firm, same-
    // department peer) at INSERT time.
    const newTaskId = randomUUID();
    const { data, error } = await e0.from('tasks').insert({
      id: newTaskId, firm_id: ID.firmA, client_id: ID.clientA2, department_id: ids.gstA,
      title: `${TAG} F4 INSERT-assign probe`, due_date: '2027-01-31',
      assigned_to: ids.evId, created_by: ids.e0Id,
    }).select('id, assigned_to').single();
    const insertOk = !error && !!data && data.assigned_to === ids.evId;
    R('F4 INSERT-time check: E0 (tasks.create granted, tasks.assign still revoked) CAN create a new department task with assigned_to already set (assignment achieved via INSERT, not covered by the BEFORE UPDATE trigger) — established empirically, recorded as INTENDED (see project_context.md/DECISIONS.md): create-and-assign in one step is normal workflow, and the INSERT itself is still gated to E0\'s own department',
      insertOk, insertOk ? `INSERT succeeded, assigned_to: ${data.assigned_to}` : `INSERT denied: ${error?.message} (would mean tasks.create alone cannot set an initial assignee)`);
    if (data) await admin.from('tasks').delete().eq('id', newTaskId); // cleanup — this was a throwaway probe row, not part of the fixed seed set
  }
  {
    const { data, error } = await ev.from('tasks').delete().eq('id', ID.taskGst).select();
    R('tasks: EV (employee, not partner) DELETE denied (partner-only)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }

  // ==========================================================================
  // 10. task_stage_history — trigger-only writes
  // ==========================================================================

  {
    const { data, error } = await ev.from('task_stage_history').insert({ firm_id: ID.firmA, task_id: ID.taskGst, to_stage: 'completed' }).select().single();
    R('task_stage_history: direct INSERT denied for ANY role incl. staff (trigger-only)', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug)');
  }
  {
    const { data, error } = await pa.from('task_stage_history').insert({ firm_id: ID.firmA, task_id: ID.taskGst, to_stage: 'completed' }).select().single();
    R('task_stage_history: direct INSERT denied even for a partner (trigger-only, no policy at all)', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug)');
  }
  await crossFirmZero(pa, 'task_stage_history', 'task_id', ID.taskB, 'task_stage_history: PA gets ZERO rows for Firm B\'s task history (cross-firm)');

  // ==========================================================================
  // 11. task_comments
  // ==========================================================================

  {
    const { data, error } = await ua1.from('task_comments').select('id').eq('id', ID.commentInternalA);
    R('task_comments: client_user gets ZERO rows for an internal (visible_to_client=false) comment', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ua1.from('task_comments').select('id').eq('id', ID.commentClientA);
    R('task_comments: client_user sees the client-visible comment on her own visible task', !error && (data || []).length === 1, error?.message);
  }
  {
    const { data, error } = await ev.from('task_comments').update({ content: 'edited by EV' }).eq('id', ID.commentInternalA).select();
    R('task_comments: EV (not the author) UPDATE affects zero rows', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ua2.from('task_comments').insert({ firm_id: ID.firmA, task_id: ID.taskGst, content: 'A2 trying to comment on A1\'s task', created_by: ids.ua2Id }).select().single();
    R('task_comments: UA2 (sibling client) CANNOT comment on A1\'s task', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug)');
  }
  await crossFirmZero(pa, 'task_comments', 'task_id', ID.taskB, 'task_comments: PA gets ZERO rows for Firm B\'s comments (cross-firm)');

  // ==========================================================================
  // 12. documents — the Ph3 client task_id-IS-NULL relaxation, empirically
  // ==========================================================================

  {
    // The relaxation itself: UA2 can upload a task-LESS document under her
    // own client, with no task to anchor it to.
    const { data, error } = await ua2.from('documents').insert({
      firm_id: ID.firmA, client_id: ID.clientA2, task_id: null, name: 'proactive upload',
      uploaded_by: ids.ua2Id, approval_status: 'pending', visible_to_client: true,
    }).select().single();
    R('FINDING-CHECK documents (Ph3 relaxation): client_user CAN INSERT a task-LESS document for her own client', !error && !!data, error?.message);
  }
  {
    // What that relaxation ALSO permits on the READ side: EV (clients.view
    // DEFAULT true) can see A3's task-less document even though NOTHING —
    // no task, no department — connects EV to client A3 at all. This is
    // firm-wide reach via clients.view alone, not department-scoped.
    const { data, error } = await ev.from('documents').select('id').eq('id', ID.docTaskless);
    R('FINDING-CHECK documents: EV (clients.view=true, ZERO relationship to client A3) sees A3\'s task-less document anyway (firm-wide via clients.view, not department-scoped)',
      !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await e0.from('documents').select('id').eq('id', ID.docTaskless);
    R('documents: E0 (clients.view REVOKED, ZERO relationship to A3) sees ZERO rows for the same task-less document', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ua1.from('documents').select('id').eq('id', ID.docInternalPending);
    R('documents: UA1 gets ZERO rows for her own client\'s internal/pending document (table layer)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  await crossFirmZero(pa, 'documents', 'id', ID.docB, 'documents: PA gets ZERO rows for Firm B\'s document (cross-firm)');
  {
    const { data, error } = await ev.from('documents').update({ approval_status: 'approved' }).eq('id', ID.docTaskLinked).select();
    R('documents: EV (no documents.approve) UPDATE (approve) denied', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }

  // ==========================================================================
  // 13. STORAGE — the staff-broad-access probe (new angle vs. 07's
  // client-focused checks) + re-confirmation of client curation
  // ==========================================================================

  {
    // Table-layer sanity check: confirm E0 really is denied at the documents
    // table for docInternalOtherDept (a document on taskIncomeTax, a
    // department she is NOT a member of) — establishes that the storage
    // checks below are testing a genuine access boundary, not a doc she'd
    // see anyway.
    const { data, error } = await e0.from('documents').select('id').eq('id', ID.docInternalOtherDept);
    R('documents (sanity): E0 gets ZERO rows on the TABLE for docInternalOtherDept (staff_can_access_task denies — different department)',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }

  // F2 FIX PROBE (migration 012): the staff storage SELECT and INSERT
  // policies now both require can_access_document(document_id) on top of the
  // firm-folder match. Six cases prove the fix in both directions — read AND
  // write — plus the two legitimate flows it must not break.
  const otherDeptObjPath = `${ID.firmA}/${ID.clientA1}/${ID.docInternalOtherDept}/33333333-3333-4333-8333-333333333333.txt`;
  const otherDeptFolder = `${ID.firmA}/${ID.clientA1}/${ID.docInternalOtherDept}`;
  const linkedObjPath = `${ID.firmA}/${ID.clientA1}/${ID.docTaskLinked}/22222222-2222-4222-8222-222222222222.txt`;

  {
    // 1. Employee WITHOUT department access (E0, docInternalOtherDept is on
    // taskIncomeTax — not her department): download and list must now BOTH
    // be denied. This was the original F2 finding — E0 could do both before
    // the fix.
    const dl = await e0.storage.from(BUCKET).download(otherDeptObjPath);
    R('F2 fix: E0 (no department access to docInternalOtherDept) is DENIED downloading its raw bytes',
      !!dl.error && !dl.data, dl.error ? `denied: ${dl.error.message}` : 'download SUCCEEDED — gap still open');

    const ls = await e0.storage.from(BUCKET).list(otherDeptFolder);
    R('F2 fix: E0 (no department access) is DENIED listing docInternalOtherDept\'s folder (entries: 0, not an error — Storage list() returns empty rather than denying)',
      !ls.error && (ls.data || []).length === 0, ls.error?.message || `entries: ${ls.data?.length}`);
  }
  {
    // 2. Employee WITH access: EV is a member of gstA, docTaskLinked's task
    // (taskGst) is in gstA — must still succeed (no regression).
    const { data, error } = await ev.storage.from(BUCKET).download(linkedObjPath);
    R('F2 fix: EV (gstA member, docTaskLinked is on a gstA task) SUCCEEDS downloading it (no regression)',
      !error && !!data, error ? `unexpectedly denied: ${error.message}` : 'succeeded as expected');
  }
  {
    // 3. Partner: bypass intact — PA can still reach docInternalOtherDept
    // despite not being a member of any department (partners see everything
    // via can_access_document's own "partner -> true" branch).
    const { data, error } = await pa.storage.from(BUCKET).download(otherDeptObjPath);
    R('F2 fix: PA (partner) SUCCEEDS downloading docInternalOtherDept (partner bypass intact)',
      !error && !!data, error ? `unexpectedly denied: ${error.message}` : 'succeeded as expected');
  }
  {
    // 4. client_user: unchanged — UA1 (the owning client, but the doc is
    // internal/pending) is still correctly denied; this policy wasn't
    // touched by migration 012, only the staff policies were.
    const objPath = `${ID.firmA}/${ID.clientA1}/${ID.docInternalPending}/11111111-1111-4111-8111-111111111111.txt`;
    const { data, error } = await ua1.storage.from(BUCKET).download(objPath);
    R('F2 fix: UA1 (client_user, owning client but doc is internal/pending) is STILL correctly denied (client policy untouched, no regression)',
      !!error && !data, error ? `correctly denied: ${error.message}` : 'download SUCCEEDED (regression of migration 003)');
  }
  {
    // 5. Real staff upload + new-version upload, end to end: EP creates a
    // brand-new document (own department task), uploads v1's bytes, then
    // uploads v2's bytes into the same document's folder. Mirrors
    // uploadDocumentAction()/uploadDocumentVersionAction()'s own ordering —
    // documents row first, storage object second — the exact ordering this
    // migration's fix depends on.
    const newDocId = randomUUID();
    const { error: docInsertError } = await ep.from('documents').insert({
      id: newDocId, firm_id: ID.firmA, client_id: ID.clientA1, task_id: ID.taskGst,
      name: `${TAG} F2 probe doc`, approval_status: 'pending', visible_to_client: false,
      uploaded_by: (await ep.auth.getUser()).data.user.id,
    });
    const v1Path = `${ID.firmA}/${ID.clientA1}/${newDocId}/${randomUUID()}.txt`;
    const v1 = await ep.storage.from(BUCKET).upload(v1Path, buf('F2 probe v1 contents'));
    const v2Path = `${ID.firmA}/${ID.clientA1}/${newDocId}/${randomUUID()}.txt`;
    const v2 = await ep.storage.from(BUCKET).upload(v2Path, buf('F2 probe v2 contents'));
    R('F2 fix: EP\'s real upload (new document, v1) + a new-version upload (v2) into the same folder both SUCCEED end to end',
      !docInsertError && !v1.error && !v2.error,
      `docInsert: ${docInsertError?.message || 'ok'}, v1: ${v1.error?.message || 'ok'}, v2: ${v2.error?.message || 'ok'}`);
  }
  {
    // 6. NEW — the INSERT fix itself, proven directly: E0 (no department
    // access to docInternalOtherDept) attempts to write bytes into ITS
    // folder using a fresh filename. Before migration 012 this would have
    // succeeded (the INSERT policy never checked document_id at all); now
    // it must be denied by the same can_access_document() check just added
    // to the staff INSERT policy's WITH CHECK.
    const plantPath = `${otherDeptFolder}/${randomUUID()}.txt`;
    const { error } = await e0.storage.from(BUCKET).upload(plantPath, buf('planted by E0, should be denied'));
    R('F2 fix: E0 (no department access) is DENIED writing a new object into docInternalOtherDept\'s folder (INSERT-side fix)',
      !!error, error ? `denied: ${error.message}` : 'upload SUCCEEDED — write-side gap still open');
  }
  {
    const objPathB = `${ID.firmB}/${ID.clientB1}/${ID.docB}/`;
    const { data, error } = await pa.storage.from(BUCKET).list(objPathB);
    R('storage: PA (Firm A) gets ZERO entries listing Firm B\'s folder (cross-firm)', !error && (data || []).length === 0, error?.message || `entries: ${data?.length}`);
  }

  // ==========================================================================
  // 14. task_activities — immutable, staff-only read, participant-write
  // ==========================================================================

  {
    const { error } = await admin.from('task_activities').insert({
      firm_id: ID.firmA, task_id: ID.taskGst, actor_id: ids.paId, action_type: 'seed_note',
    });
    if (error) throw new Error(`seed task_activities: ${error.message}`);
  }
  {
    const { data, error } = await ua2.from('task_activities').select('*').eq('task_id', ID.taskGst);
    R('task_activities: UA2 (sibling client, no path at all — staff-only readable) sees ZERO rows', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ev.from('task_activities').update({ action_type: 'tampered' }).eq('task_id', ID.taskGst).select();
    R('task_activities: no UPDATE policy at all — even staff\'s UPDATE affects zero rows (immutable)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  await crossFirmZero(pa, 'task_activities', 'task_id', ID.taskB, 'task_activities: PA gets ZERO rows for Firm B\'s activity log (cross-firm)');

  // ==========================================================================
  // 15. notifications
  // ==========================================================================

  {
    const { data, error } = await ev.from('notifications').select('*').eq('id', ID.notifPA);
    R('notifications: EV gets ZERO rows for PA\'s own notification (own-rows-only)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ev.from('notifications').select('*').eq('id', ID.notifEV);
    R('notifications: EV sees her own notification', !error && (data || []).length === 1, error?.message);
  }
  {
    const { data, error } = await ev.from('notifications').insert({
      firm_id: ID.firmB, user_id: ids.evbId, type: 'task_assigned', title: 'forged', message: 'cross-firm forgery attempt',
    }).select().single();
    R('notifications: EV (Firm A staff) CANNOT INSERT a notification for a Firm B user (cross-firm forgery denied)', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug)');
  }
  {
    const { error } = await ua1.rpc('create_notification', { p_user_id: ids.evId, p_type: 'x', p_title: 'x', p_message: 'from client' });
    // create_notification has no explicit role check — it only validates
    // same-firm. A client_user in the SAME firm as the target is same-firm,
    // so this is expected to SUCCEED (client-originated events, e.g. a
    // document upload, legitimately need this path per schema.sql's comment).
    R('notifications: create_notification() from a client_user to a SAME-FIRM staff member succeeds (by design — client-originated events)', !error, error?.message || 'ok');
  }
  {
    const { error } = await ev.rpc('create_notification', { p_user_id: ids.evbId, p_type: 'x', p_title: 'x', p_message: 'cross-firm via RPC' });
    R('notifications: create_notification() REJECTS a cross-firm target (RAISE EXCEPTION)', !!error, error?.message || 'RPC SUCCEEDED cross-firm (bug)');
  }

  // ==========================================================================
  // 16. task_templates
  // ==========================================================================

  {
    const { data, error } = await e0.from('task_templates').select('id').eq('id', ID.templateA);
    R('task_templates: E0 (templates.manage revoked, but IS staff) can still SELECT — read policy is staff-wide, not permission-gated', !error && (data || []).length === 1, error?.message);
  }
  {
    const { data, error } = await e0.from('task_templates').update({ title: 'edited by E0' }).eq('id', ID.templateA).select();
    R('task_templates: E0 (templates.manage revoked) UPDATE denied', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await pb.from('task_templates').select('*').eq('id', ID.templateA);
    R('task_templates: PB (Firm B partner) gets ZERO rows for Firm A\'s template (cross-firm)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }

  // ==========================================================================
  // 17. udin_register
  // ==========================================================================

  {
    const { data, error } = await e0.from('udin_register').select('id').eq('id', ID.udinA);
    R('udin_register: E0 (reports.view revoked) sees ZERO rows', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ep.from('udin_register').select('id').eq('id', ID.udinA);
    R('udin_register: EP (reports.view GRANTED) sees the entry', !error && (data || []).length === 1, error?.message);
  }
  {
    const { data, error } = await ep.from('udin_register').insert({
      firm_id: ID.firmA, client_id: ID.clientA1, udin: 'ZZZ999999999999999', document_type: 'x',
      signing_partner_id: ids.epId, created_by: ids.epId,
    }).select().single();
    R('udin_register: EP (ALL permissions granted, but role=employee) INSERT still denied — partner-only at the RLS layer, not permission-gated', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug — role gate bypassed by permission grant)');
  }
  {
    const { data, error } = await pb.from('udin_register').select('*').eq('id', ID.udinA);
    R('udin_register: PB (Firm B partner) gets ZERO rows for Firm A\'s entry (cross-firm)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }

  // ==========================================================================
  // 18. dsc_register / dsc_custody_movements — cross-firm (new vs. script 10)
  // ==========================================================================

  {
    const { data, error } = await pb.from('dsc_register').select('*').eq('id', ID.dscA);
    R('dsc_register: PB (Firm B partner) gets ZERO rows for Firm A\'s DSC entry (cross-firm)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ep.from('dsc_register').insert({
      firm_id: ID.firmA, client_id: ID.clientA1, holder_name: 'EP attempt', issuing_authority: 'x',
      dsc_class: 'Class 3', serial_number: `${TAG}-EP-ATTEMPT`, expires_on: '2027-01-01', created_by: ids.epId,
    }).select().single();
    R('dsc_register: EP (ALL permissions granted, role=employee) INSERT still denied — partner-only', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug)');
  }

  // ==========================================================================
  // 19. fee_masters / firm_invoices / firm_invoice_items / firm_invoice_counters
  //     / receipts / receipt_history — cross-firm (new vs. script 08) +
  //     confirmation that migration 006 (receipt_history, on-account
  //     receipts) is LIVE despite docs describing it as unapplied
  // ==========================================================================

  {
    const { data, error } = await pb.from('fee_masters').select('*').eq('id', ID.feeMasterA);
    R('fee_masters: PB (Firm B) gets ZERO rows for Firm A\'s rate card (cross-firm)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await pb.from('firm_invoices').select('*').eq('id', ID.invoiceA);
    R('firm_invoices: PB (Firm B) gets ZERO rows for Firm A\'s invoice (cross-firm)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await pb.from('receipts').select('*').eq('id', ID.receiptA);
    R('receipts: PB (Firm B) gets ZERO rows for Firm A\'s receipt (cross-firm)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    // FINDING-CHECK: migration 006 (receipt_history + nullable
    // receipts.invoice_id for on-account receipts) is reported drafted/
    // NOT applied in project_context.md, docs/ROADMAP.md, and docs/
    // DECISIONS.md — but the seed above just inserted a receipt with
    // invoice_id=NULL, which only succeeds if that column is already
    // nullable live, and receipt_history is a live, RLS-enabled table
    // (confirmed via Supabase MCP list_tables: 8 pre-existing rows before
    // this run). Empirically confirm both here.
    const { data, error } = await admin.from('receipts').select('invoice_id').eq('id', ID.receiptA).single();
    R('FINDING-CHECK migration 006: receipts.invoice_id IS nullable on the LIVE project (on-account receipt seeded successfully)', !error && data && data.invoice_id === null, error?.message || JSON.stringify(data));
  }
  {
    const { data, error } = await ep.from('receipt_history').select('*').eq('receipt_id', ID.receiptA);
    R('FINDING-CHECK migration 006: receipt_history IS live and populated — the seeded receipt produced a history row, readable via billing.view', !error && (data || []).length >= 1, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ev.from('receipt_history').insert({
      firm_id: ID.firmA, receipt_id: ID.receiptA, operation: 'update', client_id: ID.clientA1, old_data: {}, new_data: {},
    }).select().single();
    R('receipt_history: direct INSERT denied for ANY role (trigger-only, no policy at all)', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug)');
  }
  {
    const { data, error } = await pb.from('receipt_history').select('*').eq('receipt_id', ID.receiptA);
    R('receipt_history: PB (Firm B) gets ZERO rows for Firm A\'s receipt history (cross-firm)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }

  // ==========================================================================
  // 20. SECURITY DEFINER FUNCTIONS — the ones that take a caller-influenced
  // argument and could plausibly cross a tenant/permission boundary if
  // miscoded. (Trivial no-arg helpers that only ever read the caller's own
  // auth.uid() context — get_user_firm_id/role/client_id/department_ids,
  // is_super_admin, is_firm_staff — are not attack surface and are not
  // separately probed here.)
  // ==========================================================================

  {
    // F1-RPC FIX PROBE (migration 011): get_firm_plan() is SECURITY DEFINER
    // (bypasses the billing.view-gated RLS on firm_subscriptions entirely)
    // and now carries a billing.view permission check plus a firm-ownership
    // check on p_firm_id, with is_super_admin()/service_role exempted from
    // the OWNERSHIP check only. Six cases prove the fix and its exemptions
    // both work — not just the headline cross-firm case.

    // 1. Cross-firm: EV (Firm A employee) supplying Firm B's UUID — must be
    // rejected. This was the original F1-RPC leak (real Firm B plan data
    // returned with no error).
    {
      const { error } = await ev.rpc('get_firm_plan', { p_firm_id: ID.firmB });
      R('F1-RPC fix: EV (Firm A employee) is REJECTED calling get_firm_plan() with Firm B\'s id (cross-firm)',
        !!error, error ? `denied: ${error.message}` : 'RPC call SUCCEEDED — cross-tenant plan leak still open');
    }

    // 2. Same-firm, WITH billing.view: EP (every permission granted) against
    // her own Firm A — must succeed (no regression).
    {
      const { data, error } = await ep.rpc('get_firm_plan', { p_firm_id: ID.firmA });
      R('F1-RPC fix: EP (Firm A, billing.view) SUCCEEDS calling get_firm_plan() against her own firm (no regression)',
        !error && !!data, error ? `unexpectedly denied: ${error.message}` : 'succeeded as expected');
    }

    // 3. Same-firm, WITHOUT billing.view: E0 (every permission revoked)
    // against her own Firm A — must be rejected. Proves the permission guard
    // fires on its own, independent of ownership (E0 owns the firm
    // relationship but still lacks billing.view). This is the exact original
    // bypass (E0 got her own firm's plan despite billing.view being revoked).
    {
      const { error } = await e0.rpc('get_firm_plan', { p_firm_id: ID.firmA });
      R('F1-RPC fix: E0 (Firm A, no billing.view) is REJECTED calling get_firm_plan() against her own firm (permission guard, independent of ownership)',
        !!error, error ? `denied: ${error.message}` : 'RPC call SUCCEEDED with no billing.view — permission guard not enforced');
    }

    // 4. client_user: UA1 supplying Firm B's UUID — must be rejected. The
    // original finding showed a client_user had no role restriction at all.
    {
      const { error } = await ua1.rpc('get_firm_plan', { p_firm_id: ID.firmB });
      R('F1-RPC fix: UA1 (client_user) is REJECTED calling get_firm_plan() cross-firm',
        !!error, error ? `denied: ${error.message}` : 'RPC call SUCCEEDED — client_user cross-firm leak still open');
    }

    // 5. super_admin, cross-firm: PSA (platform_admins row, deliberately NO
    // profiles row) supplying Firm B's id — must SUCCEED. This is the
    // regression risk the fix itself introduces: is_super_admin() must
    // actually bypass the ownership check, not just be written to. A super
    // admin has no profiles row (get_user_firm_id() resolves NULL for them),
    // so if this exemption were missing or broken, this call would be wrongly
    // rejected instead of wrongly accepted — the failure mode is silent
    // over-restriction, not a leak, but it's still a regression worth a
    // dedicated positive-path check.
    {
      const { data, error } = await psa.rpc('get_firm_plan', { p_firm_id: ID.firmB });
      R('F1-RPC fix: PSA (platform super admin, no profiles row) SUCCEEDS calling get_firm_plan() cross-firm (is_super_admin() ownership exemption intact)',
        !error && !!data, error ? `unexpectedly denied: ${error.message}` : 'succeeded as expected');
    }

    // 6. service_role: direct call as service_role — must succeed. Mirrors
    // migration 010's rationale: a service-role caller has no JWT/auth.uid()
    // to check meaningfully either way.
    {
      const { data, error } = await admin.rpc('get_firm_plan', { p_firm_id: ID.firmA });
      R('F1-RPC fix: service_role call to get_firm_plan() still SUCCEEDS (exemption intact)',
        !error && !!data, error ? `unexpectedly denied: ${error.message}` : 'succeeded as expected');
    }
  }
  {
    // has_permission() itself: callable directly, but only ever resolves
    // against auth.uid()'s own context — no argument lets a caller ask about
    // someone else's permissions. Confirm this holds (no p_user_id param).
    const { data, error } = await ua1.rpc('has_permission', { p_key: 'clients.view' });
    R('has_permission(): client_user calling directly resolves to false (own context only, no cross-user param exists)', !error && data === false, error?.message || `got: ${data}`);
  }
  {
    // record_dsc_movement() cross-firm: EVB (Firm B) attempts to move Firm A's DSC.
    const { error } = await evb.rpc('record_dsc_movement', { p_dsc_id: ID.dscA, p_new_custodian_id: ids.evbId, p_note: 'cross-firm attempt' });
    R('record_dsc_movement(): EVB (Firm B) attempting to move FIRM A\'s DSC is rejected (cross-firm)', !!error, error?.message || 'RPC SUCCEEDED cross-firm (bug)');
  }
  {
    // get_client_assigned_contact() cross-firm/cross-client: UA2 asking for A1's contact.
    const { data, error } = await ua2.rpc('get_client_assigned_contact', { p_client_id: ID.clientA1 });
    R('get_client_assigned_contact(): UA2 asking for A1\'s (sibling) contact gets an empty result, not an error-leak', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ua1.rpc('get_client_assigned_contact', { p_client_id: ID.clientA1 });
    R('get_client_assigned_contact(): UA1 asking for HER OWN client\'s contact succeeds', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    // lookup_firm_by_invite_code(): intentionally public/pre-auth callable;
    // confirm it does NOT leak anything beyond firm_id/name for a WRONG code.
    const { data, error } = await ev.rpc('lookup_firm_by_invite_code', { p_code: `${TAG}-nonexistent-code` });
    R('lookup_firm_by_invite_code(): a bogus code returns zero rows, not an error or partial data', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    // can_access_document() as a same-firm-but-out-of-scope employee: E0
    // (clients.view revoked, no task for the internal doc's client scope
    // beyond her own dept) should resolve false for the internal pending doc.
    const { data, error } = await e0.rpc('can_access_document', { p_document_id: ID.docInternalOtherDept });
    R('can_access_document(): E0 resolves false for docInternalOtherDept (matches table SELECT)', !error && data === false, error?.message || `got: ${data}`);
  }
  {
    const { data, error } = await evb.rpc('can_access_document', { p_document_id: ID.docTaskLinked });
    R('can_access_document(): EVB (Firm B) resolves false for FIRM A\'s document (cross-firm)', !error && data === false, error?.message || `got: ${data}`);
  }
  {
    // F0 FIX PROBE (migration 010): apply_receipts_to_invoice() is SECURITY
    // DEFINER, RETURNS VOID (not a trigger-only type — directly RPC-callable),
    // and now carries two independent guards inside its body — a billing.manage
    // permission check and a firm-ownership check on p_invoice_id — with an
    // explicit auth.role() = 'service_role' exemption for the internal
    // handle_receipt_change() trigger path. Four cases prove all of it, not
    // just the headline cross-firm case: the two guards fire independently,
    // the legitimate path still works, and the service_role bypass didn't
    // silently break the trigger it exists for.

    // 1. Cross-firm: EVB (Firm B, zero billing permission) against Firm A's
    // invoiceA — must be rejected. Fails BOTH guards; either alone would stop
    // it, but this is the original F0 scenario so it's the headline case.
    {
      const { error } = await evb.rpc('apply_receipts_to_invoice', { p_invoice_id: ID.invoiceA });
      R('F0 fix: EVB (Firm B, zero billing permission) is REJECTED calling apply_receipts_to_invoice() against Firm A\'s invoice',
        !!error, error ? `denied: ${error.message}` : 'RPC call SUCCEEDED — cross-tenant write primitive still open');
    }

    // 2. Same-firm, WITH billing.manage: EP (Firm A, every permission granted)
    // against Firm A's own invoiceA — must succeed (no regression on the
    // legitimate path).
    {
      const { error } = await ep.rpc('apply_receipts_to_invoice', { p_invoice_id: ID.invoiceA });
      R('F0 fix: EP (Firm A, billing.manage) SUCCEEDS calling apply_receipts_to_invoice() against Firm A\'s own invoice (no regression)',
        !error, error ? `unexpectedly denied: ${error.message}` : 'succeeded as expected');
    }

    // 3. Same-firm, WITHOUT billing.manage: E0 (Firm A, every permission
    // revoked) against Firm A's own invoiceA — must be rejected. Proves the
    // permission guard fires on its own, independent of the ownership check
    // (E0 owns the firm relationship but still lacks billing.manage).
    {
      const { error } = await e0.rpc('apply_receipts_to_invoice', { p_invoice_id: ID.invoiceA });
      R('F0 fix: E0 (Firm A, no billing.manage) is REJECTED calling apply_receipts_to_invoice() against Firm A\'s own invoice (permission guard, independent of ownership)',
        !!error, error ? `denied: ${error.message}` : 'RPC call SUCCEEDED with no billing.manage — permission guard not enforced');
    }

    // 4. service_role path: the on_receipt_change trigger calls this function
    // internally on every receipts write, including service-role-driven ones,
    // and has no JWT/auth.uid() to check — that's the whole reason for the
    // auth.role() = 'service_role' exemption. Call it directly as service_role
    // to prove the exemption didn't get lost and the trigger path still works.
    {
      const { error } = await admin.rpc('apply_receipts_to_invoice', { p_invoice_id: ID.invoiceA });
      R('F0 fix: service_role call to apply_receipts_to_invoice() still SUCCEEDS (exemption intact — this is what handle_receipt_change() relies on)',
        !error, error ? `unexpectedly denied: ${error.message}` : 'succeeded as expected');
    }
  }
  {
    // profile_in_my_firm(): PA (Firm A) probing PB's (Firm B partner) id —
    // must resolve false; it's scoped by get_user_firm_id(), not attacker-
    // suppliable.
    const { data, error } = await pa.rpc('profile_in_my_firm', { p_user_id: ids.pbId, p_role: 'partner' });
    R('profile_in_my_firm(): PA probing Firm B\'s partner id resolves false (own-firm-only)', !error && data === false, error?.message || `got: ${data}`);
  }

  // ==========================================================================
  // ── summary ──
  // ==========================================================================
  console.log('\n--- 14-rls-sweep summary ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed.`);

  try {
    writeFileSync(path.join(DATA_DIR, 'results-14-rls-sweep.json'), JSON.stringify(results, null, 2));
  } catch {
    // .data/ may not exist in a fresh checkout — the console output is the record.
  }
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
