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
import { createClient } from '@supabase/supabase-js';
import { adminClient, signInAs } from './lib/admin.mjs';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './lib/env.mjs';
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
  invoiceB: 'f0000000-0000-4000-8000-000000146001',
  invoiceFrozenProbe: 'e0000000-0000-4000-8000-000000146301',
  invoiceItemsProbeA: 'e0000000-0000-4000-8000-000000146401',
  invoiceSettlementProbe: 'e0000000-0000-4000-8000-000000146501',
  receiptSettlementProbe: 'e0000000-0000-4000-8000-000000146502',
  invoiceCancelProbe: 'e0000000-0000-4000-8000-000000146601',
  invoiceItemA: 'e0000000-0000-4000-8000-000000146102',
  invoiceItemB: 'f0000000-0000-4000-8000-000000146101',
  receiptA: 'e0000000-0000-4000-8000-000000147001',
  docVersionA: 'e0000000-0000-4000-8000-000000142101',
  docVersionB: 'f0000000-0000-4000-8000-000000142101',
  subInvoiceA: 'e0000000-0000-4000-8000-000000146201',
  subInvoiceB: 'f0000000-0000-4000-8000-000000146201',
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

  // Phase 14.1b: document_versions had ZERO seed coverage — every version row
  // in this schema is normally created by an upload flow, never directly, so
  // the sweep never had one to probe against. One per firm, matching each
  // firm's own doc, so can_access_document()'s cross-firm scoping (which
  // document_versions' own policies re-apply verbatim) has a real pair to test.
  await up(admin, 'document_versions', {
    id: ID.docVersionA, firm_id: ID.firmA, document_id: ID.docTaskLinked, version_number: 1,
    file_name: 'v1.txt', file_path: `${ID.firmA}/${ID.clientA1}/${ID.docTaskLinked}/22222222-2222-4222-8222-222222222222.txt`,
    file_size: 100, uploaded_by: paId,
  });
  await up(admin, 'document_versions', {
    id: ID.docVersionB, firm_id: ID.firmB, document_id: ID.docB, version_number: 1,
    file_name: 'v1.txt', file_path: `${ID.firmB}/${ID.clientB1}/${ID.docB}/v1.txt`,
    file_size: 100, uploaded_by: pbId,
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

  // NOTE (2026-07-23, Phase 14.1b): invoiceA was originally seeded as
  // 'draft'. An earlier, since-corrected version of the A4 guard_firm_invoice
  // probe (below) transitioned it through 'issued' via a raw UPDATE before a
  // dedicated invoiceFrozenProbe row was introduced for that purpose — and
  // discovered, empirically, that there is no way back: guard_firm_invoice's
  // frozen-column list (invoice_seq/invoice_number/invoice_date/total_amount/
  // issued_at) makes an issued invoice's numbering permanent by design, and
  // the table's own CHECK constraint requires invoice_seq IS NULL exactly
  // when status='draft' — so reverting status to 'draft' while those columns
  // stay non-null is rejected by the CHECK, and nulling them out is rejected
  // by the trigger. This is the immutability guarantee working as intended,
  // just triggered by a test artifact rather than a real issued invoice. The
  // seed below now matches invoiceA's actual, permanent, live state exactly
  // (fixed literals, not re-derived) so every future run's upsert is a true
  // no-op — no test in this suite required invoiceA to be 'draft' specifically.
  await up(admin, 'firm_invoices', {
    id: ID.invoiceA, firm_id: ID.firmA, client_id: ID.clientA1, status: 'issued',
    financial_year: '2026-27', created_by: paId, invoice_seq: 1,
    invoice_number: `${TAG}-001`, invoice_date: '2026-07-23', total_amount: 5000,
    issued_at: '2026-07-23T13:53:54.870Z',
  });

  // Phase 14.1b: a Firm B invoice, so firm_invoice_items/firm_invoice_counters/
  // document_versions all have a genuine cross-firm pair to probe, not just a
  // Firm A row nobody else can reach by construction.
  await up(admin, 'firm_invoices', {
    id: ID.invoiceB, firm_id: ID.firmB, client_id: ID.clientB1, status: 'draft',
    financial_year: '2026-27', created_by: pbId,
  });
  // invoiceA is permanently 'issued' (see the note above its own seed) —
  // guard_invoice_items_frozen fires on INSERT too, not just UPDATE, so a
  // line item can never be newly added against it. A dedicated, still-draft
  // invoice is needed for the firm_invoice_items probe instead.
  await up(admin, 'firm_invoices', {
    id: ID.invoiceItemsProbeA, firm_id: ID.firmA, client_id: ID.clientA1, status: 'draft',
    financial_year: '2026-27', created_by: paId,
  });
  await up(admin, 'firm_invoice_items', {
    id: ID.invoiceItemA, firm_id: ID.firmA, invoice_id: ID.invoiceItemsProbeA,
    description: `${TAG} item A`, quantity: 1, rate: 5000, taxable_value: 5000,
  });
  await up(admin, 'firm_invoice_items', {
    id: ID.invoiceItemB, firm_id: ID.firmB, invoice_id: ID.invoiceB,
    description: `${TAG} item B`, quantity: 1, rate: 7000, taxable_value: 7000,
  });
  // firm_invoice_counters: PK is (firm_id, financial_year), no id column.
  await up(admin, 'firm_invoice_counters', { firm_id: ID.firmA, financial_year: '2026-27', last_seq: 3 }, 'firm_id,financial_year');
  await up(admin, 'firm_invoice_counters', { firm_id: ID.firmB, financial_year: '2026-27', last_seq: 1 }, 'firm_id,financial_year');

  // A DEDICATED invoice for the A4 guard_firm_invoice probe, already seeded
  // in 'issued' state at INSERT time (never transitioned there via UPDATE,
  // which is exactly what guard_firm_invoice's frozen-column list would
  // block). Every field here is a FIXED literal, never a fresh timestamp —
  // guard_firm_invoice's frozen check uses IS DISTINCT FROM, so re-seeding
  // the SAME values on every run is a true no-op and never trips it. Kept
  // entirely separate from invoiceA/invoiceB so this probe's own status/
  // amount_received mutation (the finding itself) never contaminates any
  // other check that reads invoiceA.
  //
  // NOTE (2026-07-24, Phase 14.1b Part C): Part A's probe run (BEFORE
  // migration 018 was applied) legitimately flipped this row to
  // status='paid'/amount_received=5000 — that WAS the finding. Now that
  // 018's fix is live, status/amount_received/tds_received are frozen for
  // any direct UPDATE too (not just via guard_firm_invoice's pre-existing
  // frozen columns), so this row can never be reset back to 'issued' by
  // seed() either — same permanent-state lesson as invoiceA. The seed below
  // matches its actual, permanent, live state exactly, same as invoiceA's
  // own note above.
  await up(admin, 'firm_invoices', {
    id: ID.invoiceFrozenProbe, firm_id: ID.firmA, client_id: ID.clientA1, status: 'paid',
    financial_year: '2026-27', created_by: paId, invoice_seq: 99,
    invoice_number: `${TAG}-frozen-probe`, invoice_date: '2026-01-01', total_amount: 5000,
    issued_at: '2026-01-01T00:00:00Z', amount_received: 5000, tds_received: 0,
  });

  // Two more dedicated, already-'issued' invoices (Migration 018 Part C
  // probes) — same "seed already in the target state via INSERT, never
  // UPDATE-transition into it" pattern as invoiceFrozenProbe above.
  // invoiceSettlementProbe: total_amount matches a single 5000 receipt
  // exactly, so apply_receipts_to_invoice() legitimately settles it to
  // 'paid' — the case migration 018 must NOT break. INSERT-if-absent only,
  // same reasoning as invoiceCancelProbe below: once the settlement probe
  // legitimately moves it to 'paid', re-seeding status='issued' on a later
  // run would itself be a distinct, non-receipt-backed change — correctly
  // rejected by the very fix this migration adds.
  {
    const { data: existingSettlementProbe } = await admin.from('firm_invoices').select('id').eq('id', ID.invoiceSettlementProbe).maybeSingle();
    if (!existingSettlementProbe) {
      await admin.from('firm_invoices').insert({
        id: ID.invoiceSettlementProbe, firm_id: ID.firmA, client_id: ID.clientA1, status: 'issued',
        financial_year: '2026-27', created_by: paId, invoice_seq: 98,
        invoice_number: `${TAG}-settlement-probe`, invoice_date: '2026-01-01', total_amount: 5000,
        issued_at: '2026-01-01T00:00:00Z',
      });
    }
  }
  // invoiceCancelProbe: issued, zero money applied yet — the exact
  // precondition cancelInvoiceAction's own guard requires. INSERT-if-absent
  // only, never upsert: once the cancellation probe below actually cancels
  // it, guard_firm_invoice correctly makes that PERMANENT ("A cancelled
  // invoice cannot be modified" — cancelled is terminal, by design, same as
  // invoiceA's own accidental lesson earlier in this phase) — re-seeding
  // with status='issued' on a later run would then be rejected, not a no-op.
  {
    const { data: existingCancelProbe } = await admin.from('firm_invoices').select('id').eq('id', ID.invoiceCancelProbe).maybeSingle();
    if (!existingCancelProbe) {
      await admin.from('firm_invoices').insert({
        id: ID.invoiceCancelProbe, firm_id: ID.firmA, client_id: ID.clientA1, status: 'issued',
        financial_year: '2026-27', created_by: paId, invoice_seq: 97,
        invoice_number: `${TAG}-cancel-probe`, invoice_date: '2026-01-01', total_amount: 3000,
        issued_at: '2026-01-01T00:00:00Z',
      });
    }
  }

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
  const subIdByFirm = {};
  if (anyPlan) {
    for (const firmId of [ID.firmA, ID.firmB]) {
      const { data: existingSub } = await admin.from('firm_subscriptions').select('id').eq('firm_id', firmId).maybeSingle();
      if (existingSub) {
        subIdByFirm[firmId] = existingSub.id;
      } else {
        const { data: newSub } = await admin.from('firm_subscriptions').insert({
          firm_id: firmId, plan_id: anyPlan.id, status: 'active',
          current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        }).select('id').single();
        subIdByFirm[firmId] = newSub?.id;
      }
    }
  }

  // Phase 14.1b: subscription_invoices had ZERO seed coverage. One per firm —
  // this table is platform-billing (the firm's OWN subscription to the SaaS),
  // not tenant business data, so super_admin has a genuine ALL policy here
  // (unlike firm_invoices/firm_invoice_items, which are client billing and
  // super_admin has read-only access to); a real cross-firm + super-admin
  // pair is needed to probe that distinction, not just Firm A alone.
  if (subIdByFirm[ID.firmA] && subIdByFirm[ID.firmB]) {
    await up(admin, 'subscription_invoices', {
      id: ID.subInvoiceA, firm_id: ID.firmA, subscription_id: subIdByFirm[ID.firmA],
      amount_inr: 999, status: 'due',
      period_start: new Date(Date.now() - 5 * 86400000).toISOString(),
      period_end: new Date(Date.now() + 25 * 86400000).toISOString(),
    });
    await up(admin, 'subscription_invoices', {
      id: ID.subInvoiceB, firm_id: ID.firmB, subscription_id: subIdByFirm[ID.firmB],
      amount_inr: 999, status: 'due',
      period_start: new Date(Date.now() - 5 * 86400000).toISOString(),
      period_end: new Date(Date.now() + 25 * 86400000).toISOString(),
    });
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

  // MIGRATION 015 FIX PROBE: assigned_to now also requires firm membership,
  // checked unconditionally (data integrity, not permission) on both INSERT
  // and UPDATE, including service-role writes. Four cases.
  {
    // 1. Cross-firm assigned_to on INSERT: E0 creates a Firm A task with
    // assigned_to pointing at EVB (Firm B) — must be REJECTED. This was the
    // exact follow-up finding.
    const newTaskId = randomUUID();
    const { error } = await e0.from('tasks').insert({
      id: newTaskId, firm_id: ID.firmA, client_id: ID.clientA2, department_id: ids.gstA,
      title: `${TAG} migration 015 cross-firm INSERT probe`, due_date: '2027-01-31',
      assigned_to: ids.evbId, created_by: ids.e0Id,
    }).select('id').single();
    R('Migration 015 fix: E0 is REJECTED creating a Firm A task with assigned_to pointing at EVB (Firm B) — firm-membership check on INSERT',
      !!error, error ? `denied: ${error.message}` : 'INSERT SUCCEEDED — cross-firm assigned_to gap still open');
    await admin.from('tasks').delete().eq('id', newTaskId); // in case it wrongly succeeded
  }
  {
    // 2. Cross-firm assigned_to on UPDATE: EP (holds tasks.assign) attempts
    // to reassign taskA2Gst to EVB (Firm B) — must be REJECTED. Proves the
    // firm check fires independently of (and after) the permission check —
    // holding tasks.assign is necessary but not sufficient.
    const { error } = await ep.from('tasks').update({ assigned_to: ids.evbId }).eq('id', ID.taskA2Gst).select();
    R('Migration 015 fix: EP (holds tasks.assign) is REJECTED reassigning taskA2Gst to EVB (Firm B) — firm-membership check on UPDATE',
      !!error, error ? `denied: ${error.message}` : 'UPDATE SUCCEEDED — cross-firm assigned_to gap still open');
  }
  {
    // 3. Same-firm assignment still succeeds on both INSERT and UPDATE — no
    // regression. INSERT: EP creates a task assigned to EV (same firm).
    const newTaskId = randomUUID();
    const { data: insData, error: insError } = await ep.from('tasks').insert({
      id: newTaskId, firm_id: ID.firmA, client_id: ID.clientA2, department_id: ids.gstA,
      title: `${TAG} migration 015 same-firm INSERT probe`, due_date: '2027-01-31',
      assigned_to: ids.evId, created_by: ids.epId,
    }).select('id, assigned_to').single();
    // UPDATE: EP reassigns taskA2Gst back to EV (same firm).
    const { data: updData, error: updError } = await ep.from('tasks').update({ assigned_to: ids.evId }).eq('id', ID.taskA2Gst).select('id, assigned_to').single();
    R('Migration 015 fix: same-firm assignment still SUCCEEDS on both INSERT and UPDATE (no regression)',
      !insError && insData?.assigned_to === ids.evId && !updError && updData?.assigned_to === ids.evId,
      `insert: ${insError?.message || 'ok'}, update: ${updError?.message || 'ok'}`);
    if (insData) await admin.from('tasks').delete().eq('id', newTaskId);
  }
  {
    // 4. Service-role write with a cross-firm assigned_to is ALSO rejected —
    // the firm check is data integrity, not authorization, so it applies
    // unconditionally (unlike the tasks.assign permission gate, which
    // deliberately exempts service_role).
    const { error } = await admin.from('tasks').update({ assigned_to: ids.evbId }).eq('id', ID.taskA2Gst).select();
    R('Migration 015 fix: a service_role write with a cross-firm assigned_to is ALSO rejected (data-integrity check applies unconditionally)',
      !!error, error ? `denied: ${error.message}` : 'UPDATE SUCCEEDED — data-integrity check does not apply to service_role');
    await admin.from('tasks').update({ assigned_to: ids.evId }).eq('id', ID.taskA2Gst); // restore for idempotent re-runs
  }

  // MIGRATION 016 FIX PROBE: reviewer_id and department_id now get the same
  // unconditional firm-membership check assigned_to already has. Six cases.
  {
    // 1. Cross-firm reviewer_id on INSERT: E0 creates a Firm A task with
    // reviewer_id pointing at EVB (Firm B) — must be REJECTED.
    const newTaskId = randomUUID();
    const { error } = await e0.from('tasks').insert({
      id: newTaskId, firm_id: ID.firmA, client_id: ID.clientA2, department_id: ids.gstA,
      title: `${TAG} migration 016 cross-firm reviewer INSERT probe`, due_date: '2027-01-31',
      reviewer_id: ids.evbId, created_by: ids.e0Id,
    }).select('id').single();
    R('Migration 016 fix: E0 is REJECTED creating a Firm A task with reviewer_id pointing at EVB (Firm B) — firm-membership check on INSERT',
      !!error, error ? `denied: ${error.message}` : 'INSERT SUCCEEDED — cross-firm reviewer_id gap still open');
    await admin.from('tasks').delete().eq('id', newTaskId); // in case it wrongly succeeded
  }
  {
    // 2. Cross-firm reviewer_id on UPDATE: E0 (via tasks.update_department
    // alone — reviewer_id was never gated by tasks.assign, before or after
    // this migration) attempts to set taskA2Gst's reviewer_id to EVB — must
    // be REJECTED by the new firm check even though no permission ever
    // blocked reviewer_id changes.
    const { error } = await e0.from('tasks').update({ reviewer_id: ids.evbId }).eq('id', ID.taskA2Gst).select();
    R('Migration 016 fix: E0 is REJECTED setting taskA2Gst\'s reviewer_id to EVB (Firm B) via tasks.update_department alone — firm-membership check on UPDATE',
      !!error, error ? `denied: ${error.message}` : 'UPDATE SUCCEEDED — cross-firm reviewer_id gap still open');
  }
  {
    // 3. Cross-firm department_id on INSERT, PARTNER: PA creates a Firm A
    // task with department_id pointing at Firm B's GST department — must be
    // REJECTED. This was the original follow-up finding (partner branch
    // bypassed the department-membership check entirely).
    const newTaskId = randomUUID();
    const { error } = await pa.from('tasks').insert({
      id: newTaskId, firm_id: ID.firmA, client_id: ID.clientA2, department_id: ids.gstB,
      title: `${TAG} migration 016 cross-firm department INSERT probe (partner)`, due_date: '2027-01-31',
      created_by: ids.paId,
    }).select('id').single();
    R('Migration 016 fix: PA (partner) is REJECTED creating a Firm A task with department_id pointing at Firm B\'s GST department — firm-membership check on INSERT',
      !!error, error ? `denied: ${error.message}` : 'INSERT SUCCEEDED — cross-firm department_id gap still open');
    await admin.from('tasks').delete().eq('id', newTaskId); // in case it wrongly succeeded
  }
  {
    // 4. Cross-firm department_id on UPDATE, PARTNER: PA attempts to move
    // taskA2Gst into Firm B's GST department — must be REJECTED. "Partners
    // can update any firm task"'s implicit WITH CHECK never validated this.
    const { error } = await pa.from('tasks').update({ department_id: ids.gstB }).eq('id', ID.taskA2Gst).select();
    R('Migration 016 fix: PA (partner) is REJECTED moving taskA2Gst into Firm B\'s GST department — firm-membership check on UPDATE',
      !!error, error ? `denied: ${error.message}` : 'UPDATE SUCCEEDED — cross-firm department_id gap still open');
  }
  {
    // 5. Same-firm reviewer_id still succeeds on both INSERT and UPDATE — no
    // regression.
    const newTaskId = randomUUID();
    const { data: insData, error: insError } = await ep.from('tasks').insert({
      id: newTaskId, firm_id: ID.firmA, client_id: ID.clientA2, department_id: ids.gstA,
      title: `${TAG} migration 016 same-firm reviewer INSERT probe`, due_date: '2027-01-31',
      reviewer_id: ids.evId, created_by: ids.epId,
    }).select('id, reviewer_id').single();
    const { data: updData, error: updError } = await pa.from('tasks').update({ reviewer_id: ids.evId }).eq('id', ID.taskA2Gst).select('id, reviewer_id').single();
    R('Migration 016 fix: same-firm reviewer_id still SUCCEEDS on both INSERT and UPDATE (no regression)',
      !insError && insData?.reviewer_id === ids.evId && !updError && updData?.reviewer_id === ids.evId,
      `insert: ${insError?.message || 'ok'}, update: ${updError?.message || 'ok'}`);
    if (insData) await admin.from('tasks').delete().eq('id', newTaskId);
    await admin.from('tasks').update({ reviewer_id: null }).eq('id', ID.taskA2Gst); // restore for idempotent re-runs
  }
  {
    // 6. Same-firm department_id still succeeds on both INSERT and UPDATE —
    // no regression. UPDATE: PA moves taskA2Gst from gstA to incomeTaxA and
    // back (both Firm A departments), proving partners can still legitimately
    // move tasks between their own firm's departments.
    const newTaskId = randomUUID();
    const { data: insData, error: insError } = await pa.from('tasks').insert({
      id: newTaskId, firm_id: ID.firmA, client_id: ID.clientA2, department_id: ids.incomeTaxA,
      title: `${TAG} migration 016 same-firm department INSERT probe`, due_date: '2027-01-31',
      created_by: ids.paId,
    }).select('id, department_id').single();
    const { data: updData, error: updError } = await pa.from('tasks').update({ department_id: ids.incomeTaxA }).eq('id', ID.taskA2Gst).select('id, department_id').single();
    R('Migration 016 fix: same-firm department_id still SUCCEEDS on both INSERT and UPDATE (no regression)',
      !insError && insData?.department_id === ids.incomeTaxA && !updError && updData?.department_id === ids.incomeTaxA,
      `insert: ${insError?.message || 'ok'}, update: ${updError?.message || 'ok'}`);
    if (insData) await admin.from('tasks').delete().eq('id', newTaskId);
    await admin.from('tasks').update({ department_id: ids.gstA }).eq('id', ID.taskA2Gst); // restore for idempotent re-runs
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
  // 19b. PHASE 14.1b — the four tables with ZERO prior sweep coverage:
  // document_versions, firm_invoice_items, firm_invoice_counters,
  // subscription_invoices. Full role matrix (partner, employee-defaults,
  // employee-zero-permissions, employee-all-permissions, client_user,
  // cross-firm) × SELECT/INSERT/UPDATE/DELETE where each table's own policy
  // shape makes the case meaningful — none of these tables have a policy
  // shape genuinely different from firm_invoices/receipts (already
  // exhaustively covered in 08-billing-rls.mjs for the SAME-firm cases), so
  // the marginal value here is cross-firm isolation + the one shape that IS
  // different (subscription_invoices' super_admin ALL policy).
  // ==========================================================================

  // --- document_versions ---
  {
    const { data, error } = await ev.from('document_versions').select('*').eq('id', ID.docVersionA);
    R('document_versions: EV (gstA member, docTaskLinked is on a gstA task) SEES her own firm\'s version row', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await e0.from('document_versions').select('*').eq('id', ID.docVersionA);
    R('document_versions: E0 (no department access to docInternalOtherDept-style gap doesn\'t apply here — docTaskLinked IS her dept) still sees it via can_access_document()', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  await crossFirmZero(pb, 'document_versions', 'id', ID.docVersionA, 'document_versions: PB gets ZERO rows for Firm A\'s version (cross-firm)');
  await crossFirmZero(evb, 'document_versions', 'id', ID.docVersionA, 'document_versions: EVB gets ZERO rows for Firm A\'s version (cross-firm)');
  {
    const { data, error } = await ua1.from('document_versions').select('*').eq('id', ID.docVersionA);
    R('document_versions: UA1 (client_user, not the doc\'s owner-context — docTaskLinked belongs to clientA1 and IS visible/approved) sees it via can_access_document()\'s client branch', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ua2.from('document_versions').select('*').eq('id', ID.docVersionA);
    R('document_versions: UA2 (sibling client) gets ZERO rows for A1\'s version', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await ev.from('document_versions').delete().eq('id', ID.docVersionA).select();
    R('document_versions: EV (employee, not partner) DELETE denied (partner-only)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await pb.from('document_versions').insert({
      firm_id: ID.firmB, document_id: ID.docTaskLinked, version_number: 2, file_name: 'x.txt', file_path: 'x', file_size: 1, uploaded_by: ids.pbId,
    }).select().single();
    R('document_versions: PB (Firm B partner) is DENIED inserting a version against Firm A\'s document (firm_id mismatch + can_access_document() both fail)',
      !!error && !data, error?.message || 'INSERT SUCCEEDED (cross-firm version-insert bug)');
  }

  // --- firm_invoice_items ---
  {
    const { data, error } = await ep.from('firm_invoice_items').select('*').eq('id', ID.invoiceItemA);
    R('firm_invoice_items: EP (billing.view granted) sees Firm A\'s invoice line item', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await e0.from('firm_invoice_items').select('*').eq('id', ID.invoiceItemA);
    R('firm_invoice_items: E0 (billing.view revoked) gets ZERO rows for Firm A\'s invoice line item', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  await crossFirmZero(pa, 'firm_invoice_items', 'id', ID.invoiceItemB, 'firm_invoice_items: PA gets ZERO rows for Firm B\'s invoice line item (cross-firm)');
  {
    const { data, error } = await ua1.from('firm_invoice_items').select('*').eq('id', ID.invoiceItemA);
    R('firm_invoice_items: UA1 (client_user, no policy path at all) gets ZERO rows', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await pa.from('firm_invoice_items').update({ description: 'PA cross-firm item edit attempt' }).eq('id', ID.invoiceItemB).select();
    const { data: stillB } = await admin.from('firm_invoice_items').select('description').eq('id', ID.invoiceItemB).single();
    R('firm_invoice_items: PA (Firm A) is DENIED updating Firm B\'s invoice line item (cross-firm) — zero rows affected, description unchanged',
      !error && (data || []).length === 0 && stillB?.description === `${TAG} item B`,
      error?.message || `rows returned: ${data?.length}, description now: ${stillB?.description}`);
  }

  // --- firm_invoice_counters — probed hard: sequential-numbering integrity.
  // If a cross-firm user could read or advance another firm's counter, that
  // is BOTH a leak (reveals invoice volume) and an integrity risk (numbering
  // collisions/gaps). ---
  {
    const { data, error } = await ep.from('firm_invoice_counters').select('*').eq('firm_id', ID.firmA).eq('financial_year', '2026-27');
    R('firm_invoice_counters: EP (billing.view) sees Firm A\'s own counter row', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await e0.from('firm_invoice_counters').select('*').eq('firm_id', ID.firmA).eq('financial_year', '2026-27');
    R('firm_invoice_counters: E0 (billing.view revoked) gets ZERO rows for Firm A\'s own counter', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    // Cross-firm READ: PB (Firm B partner, real billing.manage via partner
    // bypass) probing Firm A's counter row directly by composite key.
    const { data, error } = await pb.from('firm_invoice_counters').select('*').eq('firm_id', ID.firmA).eq('financial_year', '2026-27');
    R('firm_invoice_counters: PB (Firm B partner) gets ZERO rows for Firm A\'s counter (cross-firm READ — would leak invoice volume)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    // Cross-firm WRITE, probed hard: PB attempts to directly ADVANCE Firm
    // A's counter (the exact integrity risk Jay flagged — a successful
    // cross-firm write here could desynchronize Firm A's next invoice
    // number from what issue_firm_invoice() expects, causing a collision or
    // a gap the very next time Firm A issues an invoice).
    const { data: before } = await admin.from('firm_invoice_counters').select('last_seq').eq('firm_id', ID.firmA).eq('financial_year', '2026-27').single();
    const { data, error } = await pb.from('firm_invoice_counters').update({ last_seq: 999 }).eq('firm_id', ID.firmA).eq('financial_year', '2026-27').select();
    const { data: after } = await admin.from('firm_invoice_counters').select('last_seq').eq('firm_id', ID.firmA).eq('financial_year', '2026-27').single();
    R('firm_invoice_counters: PB (Firm B) is DENIED advancing Firm A\'s counter (cross-firm WRITE — sequential-numbering integrity) — value unchanged',
      before?.last_seq === after?.last_seq && (!data || data.length === 0),
      `before: ${before?.last_seq}, after: ${after?.last_seq}, rows returned: ${data?.length}, error: ${error?.message || 'none (RLS silently filtered, 0 rows affected)'}`);
  }
  {
    // Cross-firm INSERT: PB attempts to create a counter row for Firm A in a
    // financial year Firm A hasn't seeded yet (probes the INSERT policy's
    // firm_id check independent of the UPDATE path above).
    const { error } = await pb.from('firm_invoice_counters').insert({ firm_id: ID.firmA, financial_year: '2099-00', last_seq: 1 });
    R('firm_invoice_counters: PB (Firm B) is DENIED inserting a NEW counter row for Firm A (cross-firm INSERT)',
      !!error, error ? `denied: ${error.message}` : 'INSERT SUCCEEDED — cross-firm counter forgery');
  }

  // --- subscription_invoices — the one table with a genuine super_admin ALL
  // (read+write) policy, since it's platform billing (a firm's OWN
  // subscription to the SaaS), not tenant business data. ---
  {
    const { data, error } = await pa.from('subscription_invoices').select('*').eq('id', ID.subInvoiceA);
    R('subscription_invoices: PA (billing.view via partner) sees Firm A\'s own subscription invoice', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  await crossFirmZero(pa, 'subscription_invoices', 'id', ID.subInvoiceB, 'subscription_invoices: PA gets ZERO rows for Firm B\'s subscription invoice (cross-firm)');
  {
    const { data, error } = await pa.from('subscription_invoices').update({ status: 'paid' }).eq('id', ID.subInvoiceA).select();
    R('subscription_invoices: PA (partner, NOT super_admin) is DENIED writing to her OWN firm\'s subscription invoice — platform-managed, not tenant-writable',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }

  // ==========================================================================
  // 19c. PHASE 14.1b — A2: super-admin POSITIVE paths. Every prior probe in
  // this suite proved super_admin correctly EXCLUDED from nothing it
  // shouldn't touch; none proved super_admin can actually DO what
  // platform_admins exists to grant. Per ROLES_AND_RLS.md's own stated
  // design ("Read access everywhere, write access to platform tables —
  // plans, subscriptions, permission catalog"), prove BOTH directions with
  // PSA (seeded platform super admin, no profiles row).
  // ==========================================================================

  {
    // Positive: read across BOTH firms' tenant data — this is the "read
    // access everywhere" half of the design.
    const { data: aRows, error: aErr } = await psa.from('clients').select('id').eq('firm_id', ID.firmA);
    const { data: bRows, error: bErr } = await psa.from('clients').select('id').eq('firm_id', ID.firmB);
    R('Super-admin positive path: PSA reads Firm A\'s clients (cross-firm read, by design)', !aErr && (aRows || []).length > 0, aErr?.message || `rows: ${aRows?.length}`);
    R('Super-admin positive path: PSA ALSO reads Firm B\'s clients (confirms "everywhere", not just Firm A)', !bErr && (bRows || []).length > 0, bErr?.message || `rows: ${bRows?.length}`);
  }
  {
    const { data, error } = await psa.from('firm_invoices').select('id').eq('firm_id', ID.firmA);
    R('Super-admin positive path: PSA reads Firm A\'s firm_invoices (tenant billing data, read-only per design)', !error && (data || []).length > 0, error?.message || `rows: ${data?.length}`);
  }
  {
    // Positive: legitimate platform WRITES — plans, platform_admins, firms.
    const { data: plan, error: planErr } = await psa.from('plans').insert({
      code: `${TAG}-plan`, name: 'RLS sweep throwaway plan', price_monthly_inr: 1, price_yearly_inr: 1,
      max_users: 1, max_clients: 1, storage_gb: 1,
    }).select().single();
    R('Super-admin positive path: PSA CAN create a plan (platform table, intended write access)', !planErr && !!plan, planErr?.message);
    if (plan) await admin.from('plans').delete().eq('id', plan.id);
  }
  {
    const { data, error } = await psa.from('firms').update({ name: `${TAG} Firm A (super-admin rename probe)` }).eq('id', ID.firmA).select();
    R('Super-admin positive path: PSA CAN update a firm\'s own row (platform-level housekeeping, intended write access)', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
    await admin.from('firms').update({ name: `${TAG} Firm A` }).eq('id', ID.firmA); // restore
  }
  {
    // Negative: the "CANNOT write tenant data where they shouldn't" half.
    // No INSERT/UPDATE/DELETE policy anywhere grants super_admin write
    // access to clients/tasks/documents/firm_invoices/receipts — confirmed
    // by policy enumeration; proven here directly.
    const { data, error } = await psa.from('clients').update({ name: 'PSA tenant-write probe' }).eq('id', ID.clientA1).select();
    R('Super-admin NEGATIVE path: PSA is DENIED writing to clients (tenant business data — super_admin has read-only access here, by design)',
      !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await psa.from('tasks').update({ title: 'PSA tenant-write probe' }).eq('id', ID.taskGst).select();
    R('Super-admin NEGATIVE path: PSA is DENIED writing to tasks', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await psa.from('firm_invoices').update({ status: 'issued' }).eq('id', ID.invoiceA).select();
    R('Super-admin NEGATIVE path: PSA is DENIED writing to firm_invoices (tenant billing data, not platform billing)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await psa.from('receipts').insert({ firm_id: ID.firmA, client_id: ID.clientA1, amount: 1, mode: 'cash', created_by: null }).select();
    R('Super-admin NEGATIVE path: PSA is DENIED inserting a receipt (tenant billing data)', !!error && !data, error?.message || 'INSERT SUCCEEDED (bug)');
  }

  // ==========================================================================
  // 19d. PHASE 14.1b — A3: doc<->task client-consistency. project_context.md
  // §6 item 6: no DB constraint ensures documents.client_id matches
  // tasks.client_id when a document is linked via task_id — the app layer
  // (attachDocumentToTaskAction) checks this, RLS/schema does not. Prove
  // what a raw PostgREST UPDATE by a permitted user (documents.approve, the
  // permission that governs the task_id column per the "Document approvers
  // can update documents" policy) can actually do, bypassing the app check.
  // ==========================================================================

  {
    // 1. Cross-client link REJECTED on UPDATE (the original finding — now
    // fixed by migration 018's guard_document_task_client trigger).
    const { data: before } = await admin.from('documents').select('client_id, task_id').eq('id', ID.docTaskless).single();
    const { data, error } = await ep.from('documents').update({ task_id: ID.taskGst }).eq('id', ID.docTaskless).select('client_id, task_id').single();
    R('Migration 018 fix (A3): EP is REJECTED linking docTaskless (client A3) to taskGst (client A1) via UPDATE — cross-client mismatch now blocked',
      !!error && !data, error ? `denied: ${error.message}` : `UPDATE SUCCEEDED — client_id: ${data?.client_id}, task_id: ${data?.task_id} (mismatch not blocked)`);
    // sanity: confirm the doc's task_id is genuinely unchanged (the UPDATE didn't partially apply)
    const { data: after } = await admin.from('documents').select('client_id, task_id').eq('id', ID.docTaskless).single();
    R('Migration 018 fix (A3), sanity: docTaskless\'s task_id is UNCHANGED after the rejected UPDATE', after?.task_id === before?.task_id, `before: ${before?.task_id}, after: ${after?.task_id}`);
  }
  {
    // 2. Cross-client link REJECTED on INSERT too (a brand-new document
    // created already carrying a mismatched task_id/client_id pair).
    const newDocId = randomUUID();
    const { data, error } = await ep.from('documents').insert({
      id: newDocId, firm_id: ID.firmA, client_id: ID.clientA3, task_id: ID.taskGst,
      name: 'A3 doc wrongly linked to A1\'s task at INSERT time', approval_status: 'pending', visible_to_client: false, uploaded_by: ids.epId,
    }).select().single();
    R('Migration 018 fix (A3): EP is REJECTED creating a NEW document with client_id=A3 but task_id pointing at an A1 task — cross-client mismatch blocked on INSERT too',
      !!error && !data, error ? `denied: ${error.message}` : 'INSERT SUCCEEDED — cross-client mismatch not blocked on INSERT');
    if (data) await admin.from('documents').delete().eq('id', newDocId); // in case it wrongly succeeded
  }
  {
    // 3. Same-client link still SUCCEEDS on both UPDATE and INSERT — no
    // regression to the normal attach-document-to-task / upload flows.
    // docInternalPending (client A1) <-> taskIncomeTax (ALSO client A1) is a
    // genuine same-client pairing. Uses PA (partner), not EP: EP is only a
    // gstA department member, and taskIncomeTax is a DIFFERENT department —
    // she'd be denied by the pre-existing staff_can_access_task() department
    // scoping regardless of this migration, which would test the wrong
    // thing. PA bypasses department scoping entirely (partner), isolating
    // this check to the one thing migration 018 could have broken.
    const { data: goodData, error: goodError } = await pa.from('documents').update({ task_id: ID.taskIncomeTax }).eq('id', ID.docInternalPending).select('client_id, task_id').single();
    R('Migration 018 fix (A3): PA relinking docInternalPending (client A1) to taskIncomeTax (ALSO client A1) still SUCCEEDS — same-client link, no regression',
      !goodError && goodData?.task_id === ID.taskIncomeTax, goodError?.message || `task_id: ${goodData?.task_id}`);
    await admin.from('documents').update({ task_id: ID.taskGst }).eq('id', ID.docInternalPending); // restore original link for idempotent re-runs
    const newDocId = randomUUID();
    const { data: insData, error: insError } = await ep.from('documents').insert({
      id: newDocId, firm_id: ID.firmA, client_id: ID.clientA1, task_id: ID.taskGst,
      name: 'same-client INSERT-time link, no regression', approval_status: 'pending', visible_to_client: false, uploaded_by: ids.epId,
    }).select('id').single();
    R('Migration 018 fix (A3): EP creating a NEW document with matching client_id/task_id still SUCCEEDS on INSERT — no regression',
      !insError && !!insData, insError?.message);
    if (insData) await admin.from('documents').delete().eq('id', newDocId);
  }

  // ==========================================================================
  // 19e. PHASE 14.1b — A4: guard_firm_invoice frozen-column gap, FIXED by
  // migration 018. status/amount_received/tds_received may now change ONLY
  // via apply_receipts_to_invoice()'s own transaction-local flag, or via the
  // pre-existing legitimate direct 'cancelled' transition.
  // ==========================================================================

  {
    // 1. The original finding, re-proven as now REJECTED: EP attempts to
    // directly fake a DIFFERENT payment amount on invoiceFrozenProbe (which
    // already carries status=paid/amount_received=5000 from Part A's
    // pre-fix probe run — using a genuinely different target value here
    // forces a real IS DISTINCT FROM change, so this isn't a same-value
    // no-op that would pass trivially either way).
    const { error } = await ep.from('firm_invoices').update({ status: 'partially_paid', amount_received: 1234, tds_received: 56 }).eq('id', ID.invoiceFrozenProbe).select();
    R('Migration 018 fix (A4): EP is REJECTED directly changing invoiceFrozenProbe\'s status/amount_received/tds_received to new values — the original bypass is closed',
      !!error, error ? `denied: ${error.message}` : 'UPDATE SUCCEEDED — money-path integrity gap still open');
    const { data: unchanged } = await admin.from('firm_invoices').select('status, amount_received, tds_received').eq('id', ID.invoiceFrozenProbe).single();
    R('Migration 018 fix (A4), sanity: invoiceFrozenProbe\'s settlement columns are UNCHANGED after the rejected UPDATE', unchanged?.status === 'paid' && Number(unchanged?.amount_received) === 5000, JSON.stringify(unchanged));
  }
  {
    // 2. The legitimate path still works: EP calls apply_receipts_to_invoice()
    // for a FRESH invoice with a REAL receipt recorded first, so the
    // settlement recomputation reflects genuine money received.
    const { error: recErr } = await admin.from('receipts').upsert({
      id: ID.receiptSettlementProbe, firm_id: ID.firmA, client_id: ID.clientA1,
      invoice_id: ID.invoiceSettlementProbe, amount: 5000, mode: 'upi', created_by: ids.paId,
    }, { onConflict: 'id' });
    const { error } = await ep.rpc('apply_receipts_to_invoice', { p_invoice_id: ID.invoiceSettlementProbe });
    const { data: settled } = await admin.from('firm_invoices').select('status, amount_received').eq('id', ID.invoiceSettlementProbe).single();
    R('Migration 018 fix (A4): EP\'s legitimate apply_receipts_to_invoice() call (backed by a real receipt) still SUCCEEDS and correctly settles the invoice',
      !recErr && !error && settled?.status === 'paid' && Number(settled?.amount_received) === 5000,
      `receipt insert: ${recErr?.message || 'ok'}, rpc: ${error?.message || 'ok'}, resulting status: ${settled?.status}, amount_received: ${settled?.amount_received}`);
  }
  {
    // 3. set_config SCOPE — the exemption flag must NOT leak beyond its own
    // transaction. Immediately after the legitimate RPC call above (which
    // ran, set the flag, and committed within its own transaction), a
    // SEPARATE direct UPDATE attempt on the SAME invoice, same connection
    // pool, must still be REJECTED — proving the is_local=true flag did not
    // persist into this new statement/transaction. This is the fix's own
    // failure mode: Supabase pools connections, so a leaked (non-local) flag
    // would hand the exemption to whatever runs next on that connection.
    const { error } = await ep.from('firm_invoices').update({ amount_received: 9999 }).eq('id', ID.invoiceSettlementProbe).select();
    R('Migration 018 fix (A4), set_config scope: immediately AFTER a legitimate apply_receipts_to_invoice() call, a direct UPDATE to amount_received is STILL REJECTED — the transaction-local flag did not leak into this new request',
      !!error, error ? `denied: ${error.message}` : 'UPDATE SUCCEEDED — the settlement flag leaked past its own transaction (pooled-connection risk realized)');
  }
  {
    // 4. Cancellation — the real, pre-existing direct-UPDATE path — still
    // works end to end. This mirrors cancelInvoiceAction's own update
    // payload EXACTLY (status/cancellation_reason/cancelled_at only, read
    // directly from src/app/(dashboard)/billing/actions.ts rather than
    // assumed), against a fresh issued invoice with zero money applied yet
    // (the action's own precondition). Cancellation is terminal (guard_firm_
    // invoice rejects any further UPDATE once cancelled), so on a re-run
    // where a PRIOR run already cancelled this invoice, re-attempting the
    // same cancel would itself be correctly rejected ("already cancelled")
    // — that's a business-rule rejection, not evidence of a broken fix, so
    // this check tolerates "already cancelled from a previous run" as an
    // equally valid pass.
    const { data: current } = await admin.from('firm_invoices').select('status').eq('id', ID.invoiceCancelProbe).single();
    if (current?.status === 'cancelled') {
      R('Migration 018 fix (A4), cancellation: invoiceCancelProbe is already cancelled from a previous run — the legitimate direct path already succeeded once, terminal state confirmed', true, 'status: cancelled (from prior run)');
    } else {
      const { data, error } = await ep.from('firm_invoices').update({
        status: 'cancelled', cancellation_reason: 'RLS sweep cancellation probe', cancelled_at: new Date().toISOString(),
      }).eq('id', ID.invoiceCancelProbe).eq('firm_id', ID.firmA).select();
      R('Migration 018 fix (A4), cancellation: EP\'s cancelInvoiceAction-equivalent UPDATE (status=cancelled + reason + timestamp, matching the real action\'s exact payload) still SUCCEEDS — the legitimate direct path is unaffected',
        !error && (data || []).length === 1 && data[0].status === 'cancelled', error?.message || `rows: ${data?.length}`);
    }
  }

  // ==========================================================================
  // 19f. PHASE 14.1b — A5: lookup_client_invitation() was incidentally
  // probed during Phase 14.2's unauthenticated-path regression work (a real
  // anon client, real token, real bogus token) — re-confirmed here as a
  // permanent, committed check rather than leaving it as a one-off ad hoc
  // script, closing the last named gap in the original 14.1b list.
  // ==========================================================================

  {
    const anonForInvite = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await anonForInvite.rpc('lookup_client_invitation', { p_token: `${TAG}-token-${ID.invitationA}` });
    R('lookup_client_invitation(): anon (no session) resolves a REAL token to its one matching row, no leak', !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    const anonForInvite = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await anonForInvite.rpc('lookup_client_invitation', { p_token: 'totally-bogus-token' });
    R('lookup_client_invitation(): anon (no session) gets ZERO rows for a bogus token, not an error or partial leak', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`);
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
  // 21. MIGRATION 017 — default-privileges hardening (Phase 14.2 systemic
  // audit). anon now has ZERO table-level grants in public (previously full
  // DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE on every table,
  // inherited from Supabase's own project-level default ACL, not anything
  // this project's migrations added). Confirms genuinely — a pure anon
  // client with NO signed-in session, not one of the seeded test users.
  // ==========================================================================

  const pureAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  {
    // Before migration 017: anon had the base table grant, so RLS alone
    // denied it silently (0 rows, no error). After: anon has NO grant at
    // all, so PostgREST rejects the query before RLS even runs — a
    // "permission denied" error, not an empty result. This is the STRONGER
    // of the two denials, and the expected outcome now.
    const { data, error } = await pureAnon.from('clients').select('*').limit(5);
    R('Migration 017 fix: anon (no session) is DENIED reading clients at the GRANT layer (permission denied, not just an empty RLS-filtered result)',
      !!error && !data, error?.message || `rows: ${data?.length} (expected a grant-denied error, got data instead)`);
  }
  {
    const { data, error } = await pureAnon.from('firm_invoices').select('*').limit(5);
    R('Migration 017 fix: anon (no session) is DENIED reading firm_invoices at the GRANT layer',
      !!error && !data, error?.message || `rows: ${data?.length} (expected a grant-denied error, got data instead)`);
  }
  {
    const { data, error } = await pureAnon.from('client_outstanding').select('*').limit(5);
    R('Migration 017 fix: anon (no session) is DENIED reading client_outstanding at the GRANT layer (the originally-flagged view — no anon grant left at all)',
      !!error && !data, error?.message || `rows: ${data?.length} (expected a grant-denied error, got data instead)`);
  }
  {
    const { data, error } = await pureAnon.from('clients').insert({ firm_id: ID.firmA, name: 'anon write probe', business_type: 'individual' }).select();
    R('Migration 017 fix: anon (no session) is DENIED writing to clients (INSERT) — no grant, not just RLS',
      !!error && !data, error ? `denied: ${error.message}` : 'INSERT SUCCEEDED — anon grant regression');
  }
  {
    // The two pre-auth RPCs anon legitimately needs (invite-code lookup,
    // client-invitation lookup) must still work — they're SECURITY DEFINER,
    // so they run as the function owner regardless of anon's own table
    // grants, but this is the empirical proof, not an assumption.
    const { data: firm } = await admin.from('firms').select('invite_code').eq('id', ID.firmA).single();
    const { data, error } = await pureAnon.rpc('lookup_firm_by_invite_code', { p_code: firm.invite_code });
    R('Migration 017 fix: anon (no session) can STILL call lookup_firm_by_invite_code() with a real code (SECURITY DEFINER unaffected by table grant revokes)',
      !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    const { data, error } = await pureAnon.rpc('lookup_client_invitation', { p_token: `${TAG}-token-${ID.invitationA}` });
    R('Migration 017 fix: anon (no session) can STILL call lookup_client_invitation() with a real token (SECURITY DEFINER unaffected by table grant revokes)',
      !error && (data || []).length === 1, error?.message || `rows: ${data?.length}`);
  }
  {
    // Real sign-in (the actual login path) must be entirely unaffected --
    // it's a pure Supabase Auth (auth.users) operation, a separate schema
    // from the public-schema grants this migration touched.
    const signInClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await signInClient.auth.signInWithPassword({ email: EMAIL.pa, password: PASSWORD });
    R('Migration 017 fix: real anon-key sign-in (signInWithPassword) for an existing user still SUCCEEDS (auth schema untouched by public-schema grant revokes)',
      !error && !!data?.user, error ? `${error.message} (status ${error.status}, code ${error.code})` : (data?.user ? 'ok' : 'no user returned'));
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
