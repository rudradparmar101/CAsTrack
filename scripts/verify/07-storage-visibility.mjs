// Phase 14 — committed role-JWT RLS suite for STORAGE client-visibility.
//
// This is the re-verification harness for portal-isolation finding #7 and the
// mechanism migration 003 (003_storage_client_visibility.sql) introduced. It is
// self-seeding and idempotent so it can be re-run against the live project
// (fwmmdyebvzncpezdwnxm) at any time. Like every other script in this directory
// it is .mjs (there is no tsx/ts-node runner configured) and it drives the LIVE
// database: service-role for seeding, and anon-key `signInWithPassword` sessions
// for every assertion, so what is tested is the database's own RLS — never the
// app layer, never a hidden button.
//
// WHAT IT PROVES
//   Migration 003 rewrote the client storage SELECT policy so that a portal
//   user's reads of storage.objects are curated by public.can_access_document()
//   (honoring visible_to_client + approval_status) instead of gating on the
//   client_id path segment [2] alone. Critically, 003 *removed* the
//   foldername[2] = get_user_client_id() check, so sibling-client storage
//   isolation (check #6) now rests ENTIRELY on can_access_document(): #6 is a
//   PRIMARY check of a new mechanism here, not a re-confirmation of an old pass.
//
//   The new policy carries `get_user_role() = 'client_user'` and a CASE-guarded
//   ::uuid cast on path segment [3] into can_access_document().
//
// ── SEEDING CORRECTION (read before touching the seed) ──────────────────────
//   The document_versions INSERT trigger (handle_new_document_version,
//   schema.sql §9.5) FORCES documents.approval_status back to 'pending' on every
//   version row inserted. Therefore any document that must serve as an APPROVED
//   positive test case has to be set back to 'approved' *AFTER* its version row
//   is written — see approveDocsAfterVersioning() below. If you skip this, every
//   "approved" doc is actually pending, the visibility predicate never has to do
//   any real work, and the positive checks (client CAN still read their own
//   approved+visible doc) pass hollowly against a system where nothing is
//   approved. The prior throwaway run's positives were hollow for exactly this
//   reason. Do not "simplify" the approve-after-versioning step away.
// ────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminClient, signInAs } from './lib/admin.mjs';
import { log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');

const BUCKET = 'client-documents';
const TAG = 'strvis1';
const PASSWORD = 'PortalIso123!';

// Fixed UUIDs so the seed is upsert-idempotent (re-running never creates
// duplicate rows). Auth-user ids are assigned by GoTrue and captured at runtime.
const ID = {
  firmA: 'a0000000-0000-4000-8000-0000000f0001',
  firmB: 'b0000000-0000-4000-8000-0000000f0001',
  clientA1: 'a0000000-0000-4000-8000-0000000c00a1',
  clientA2: 'a0000000-0000-4000-8000-0000000c00a2',
  clientB1: 'b0000000-0000-4000-8000-0000000c00b1',
  taskA1Visible: 'a0000000-0000-4000-8000-0000000700aa',
  taskA1Internal: 'a0000000-0000-4000-8000-0000000700bb',
  taskA1Created: 'a0000000-0000-4000-8000-0000000700cc',
  taskA2Visible: 'a0000000-0000-4000-8000-0000000700dd',
  taskB1: 'b0000000-0000-4000-8000-0000000700ee',
  docA1Hidden: 'a0000000-0000-4000-8000-0000000d0001', // internal, visible_to_client=false, pending
  docA1Visible: 'a0000000-0000-4000-8000-0000000d0002', // approved + visible_to_client=true (positive case)
  docA2: 'a0000000-0000-4000-8000-0000000d0003', // sibling-client doc (approved+visible)
  docB1: 'b0000000-0000-4000-8000-0000000d0004', // cross-firm doc
  regA2: 'a0000000-0000-4000-8000-0000000ac002',
  commentA2: 'a0000000-0000-4000-8000-00000c0e0002',
};

const EMAIL = {
  pa: `${TAG}.pa@example.com`, // Firm A partner
  ea: `${TAG}.ea@example.com`, // Firm A employee, GST department
  uA1: `${TAG}.ua1@example.com`, // Firm A / Client A1 portal user
  pb: `${TAG}.pb@example.com`, // Firm B partner (owns Firm B seed; never signs in)
};

// Object paths: {firm}/{client}/{document_id}/{uuid}.{ext}
const OBJ = {
  a1Hidden: `${ID.firmA}/${ID.clientA1}/${ID.docA1Hidden}/${'11111111-1111-4111-8111-111111111111'}.txt`,
  a1Visible: `${ID.firmA}/${ID.clientA1}/${ID.docA1Visible}/${'22222222-2222-4222-8222-222222222222'}.txt`,
  a2: `${ID.firmA}/${ID.clientA2}/${ID.docA2}/${'33333333-3333-4333-8333-333333333333'}.txt`,
  b1: `${ID.firmB}/${ID.clientB1}/${ID.docB1}/${'44444444-4444-4444-8444-444444444444'}.txt`,
  // Edge-case objects a client can legitimately create (its INSERT policy only
  // validates segments [1]/[2]) — segment [3] is attacker-controlled.
  edgeNonUuid: `${ID.firmA}/${ID.clientA1}/not-a-uuid/edge.txt`,
  edgeGhostUuid: `${ID.firmA}/${ID.clientA1}/${'55555555-5555-4555-8555-555555555555'}/edge2.txt`, // well-formed uuid, no documents row
};

const results = [];
const buf = (s) => Buffer.from(s, 'utf-8');

// ── seed helpers ────────────────────────────────────────────────────────────

async function ensureUser(admin, email, metadata) {
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (!created.error) return created.data.user.id;
  // Already exists → find its id by paging listUsers.
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

async function ensureVersion(admin, doc) {
  // Insert the physical version row only if none exists — the INSERT fires the
  // approval-reset trigger, and UNIQUE(document_id, version_number) would reject
  // a re-run. (This is why approval must be re-applied afterwards; see header.)
  const { data } = await admin
    .from('document_versions')
    .select('id')
    .eq('document_id', doc.documentId)
    .maybeSingle();
  if (data) return;
  const { error } = await admin.from('document_versions').insert({
    firm_id: doc.firmId,
    document_id: doc.documentId,
    version_number: 1,
    file_name: 'seed.txt',
    file_path: doc.path,
    file_type: 'text/plain',
    file_size: 60,
    uploaded_by: doc.uploadedBy,
  });
  if (error) throw new Error(`version insert (${doc.documentId}): ${error.message}`);
}

async function putObject(admin, objPath, body) {
  const { error } = await admin.storage.from(BUCKET).upload(objPath, buf(body), {
    contentType: 'text/plain',
    upsert: true,
  });
  if (error) throw new Error(`upload ${objPath}: ${error.message}`);
}

async function seed(admin) {
  // Firms first (their INSERT trigger seeds the 6 departments).
  await up(admin, 'firms', { id: ID.firmA, name: `${TAG} Firm A` });
  await up(admin, 'firms', { id: ID.firmB, name: `${TAG} Firm B` });

  const gstDept = async (firmId) => {
    const { data, error } = await admin
      .from('departments')
      .select('id')
      .eq('firm_id', firmId)
      .eq('code', 'gst')
      .single();
    if (error) throw new Error(`gst dept lookup (${firmId}): ${error.message}`);
    return data.id;
  };
  const gstDeptA = await gstDept(ID.firmA);
  const gstDeptB = await gstDept(ID.firmB);

  // Auth users → ids. Staff profiles must exist before clients (clients.created_by
  // is a NOT NULL FK → profiles); the client_user profile must come AFTER clients
  // (profiles.client_id FK → clients — the circular binding schema.sql resolves
  // with a post-hoc ALTER).
  const paId = await ensureUser(admin, EMAIL.pa, { name: 'PA', role: 'partner', firm_id: ID.firmA });
  const eaId = await ensureUser(admin, EMAIL.ea, { name: 'EA', role: 'employee', firm_id: ID.firmA });
  const uA1Id = await ensureUser(admin, EMAIL.uA1, { name: 'UA1', role: 'client_user', firm_id: ID.firmA, client_id: ID.clientA1 });
  const pbId = await ensureUser(admin, EMAIL.pb, { name: 'PB', role: 'partner', firm_id: ID.firmB });

  await up(admin, 'profiles', { id: paId, firm_id: ID.firmA, name: 'PA', email: EMAIL.pa, role: 'partner' });
  await up(admin, 'profiles', { id: eaId, firm_id: ID.firmA, name: 'EA', email: EMAIL.ea, role: 'employee' });
  await up(admin, 'profiles', { id: pbId, firm_id: ID.firmB, name: 'PB', email: EMAIL.pb, role: 'partner' });

  // Clients (created_by → an existing staff profile).
  await up(admin, 'clients', { id: ID.clientA1, firm_id: ID.firmA, name: `${TAG} Client A1`, business_type: 'pvt_ltd', is_audit_applicable: true, created_by: paId });
  await up(admin, 'clients', { id: ID.clientA2, firm_id: ID.firmA, name: `${TAG} Client A2`, business_type: 'proprietorship', created_by: paId });
  await up(admin, 'clients', { id: ID.clientB1, firm_id: ID.firmB, name: `${TAG} Client B1`, business_type: 'individual', created_by: pbId });

  // Client_user profile last (client_id FK now satisfiable).
  await up(admin, 'profiles', { id: uA1Id, firm_id: ID.firmA, name: 'UA1', email: EMAIL.uA1, role: 'client_user', client_id: ID.clientA1 });

  // Employee E_A into Firm A's GST department. (Note: the staff storage SELECT
  // policy is firm-wide, so department membership does not narrow storage
  // reads — E_A is here for the employee-scope regression, and to show the
  // storage floor is per-firm, not per-department.)
  await up(admin, 'department_members', { department_id: gstDeptA, user_id: eaId }, 'department_id,user_id');

  // Tasks. stage is set directly: the stage machine only validates TG_OP=UPDATE
  // transitions, so a direct INSERT/upsert at any stage is accepted (and service
  // role has auth.uid()=NULL, exempt regardless).
  const task = (id, clientId, deptId, firmId, createdBy, stage, visible) => ({
    id, firm_id: firmId, client_id: clientId, department_id: deptId,
    title: `${TAG} ${id.slice(-4)}`, due_date: '2026-07-31', created_by: createdBy,
    stage, visible_to_client: visible, source: 'manual',
  });
  await up(admin, 'tasks', task(ID.taskA1Visible, ID.clientA1, gstDeptA, ID.firmA, paId, 'in_progress', true));
  await up(admin, 'tasks', task(ID.taskA1Internal, ID.clientA1, gstDeptA, ID.firmA, paId, 'in_progress', false));
  await up(admin, 'tasks', task(ID.taskA1Created, ID.clientA1, gstDeptA, ID.firmA, paId, 'created', true));
  await up(admin, 'tasks', task(ID.taskA2Visible, ID.clientA2, gstDeptA, ID.firmA, paId, 'in_progress', true));
  await up(admin, 'tasks', task(ID.taskB1, ID.clientB1, gstDeptB, ID.firmB, pbId, 'in_progress', true));

  // One comment on the A2 task (check #3 — U_A1 must not read it).
  await up(admin, 'task_comments', {
    id: ID.commentA2, firm_id: ID.firmA, task_id: ID.taskA2Visible,
    content: `${TAG} A2 comment`, visible_to_client: true, created_by: paId,
  });

  // A2 registration (check #13).
  await up(admin, 'client_registrations', {
    id: ID.regA2, firm_id: ID.firmA, client_id: ID.clientA2,
    type: 'gstin', registration_number: '27ABCDE1234F1Z5', state_code: '27', gst_scheme: 'regular',
  }, 'client_id,registration_number');

  // Documents (logical rows). Approval is (re)applied after versioning below.
  const doc = (id, clientId, firmId, uploadedBy, visible) => ({
    id, firm_id: firmId, client_id: clientId, name: `${TAG} ${id.slice(-4)}.txt`,
    uploaded_by: uploadedBy, visible_to_client: visible,
  });
  await up(admin, 'documents', doc(ID.docA1Hidden, ID.clientA1, ID.firmA, paId, false));
  await up(admin, 'documents', doc(ID.docA1Visible, ID.clientA1, ID.firmA, paId, true));
  await up(admin, 'documents', doc(ID.docA2, ID.clientA2, ID.firmA, paId, true));
  await up(admin, 'documents', doc(ID.docB1, ID.clientB1, ID.firmB, pbId, true));

  await ensureVersion(admin, { documentId: ID.docA1Hidden, firmId: ID.firmA, uploadedBy: paId, path: OBJ.a1Hidden });
  await ensureVersion(admin, { documentId: ID.docA1Visible, firmId: ID.firmA, uploadedBy: paId, path: OBJ.a1Visible });
  await ensureVersion(admin, { documentId: ID.docA2, firmId: ID.firmA, uploadedBy: paId, path: OBJ.a2 });
  await ensureVersion(admin, { documentId: ID.docB1, firmId: ID.firmB, uploadedBy: pbId, path: OBJ.b1 });

  await approveDocsAfterVersioning(admin);

  // Physical objects (service role bypasses storage RLS for seeding).
  await putObject(admin, OBJ.a1Hidden, 'content of A1 internal pending doc');
  await putObject(admin, OBJ.a1Visible, 'content of A1 approved visible doc');
  await putObject(admin, OBJ.a2, 'content of A2 doc');
  await putObject(admin, OBJ.b1, 'content of B1 doc');

  return { paId, eaId, uA1Id, pbId };
}

// SEEDING CORRECTION (see file header): the version-insert trigger resets
// approval_status to 'pending'. Re-assert 'approved' on the docs that must be
// positive/approved cases AFTER versions exist, or the visibility predicate is
// never exercised and every positive check passes hollowly.
async function approveDocsAfterVersioning(admin) {
  const { error } = await admin
    .from('documents')
    .update({ approval_status: 'approved' })
    .in('id', [ID.docA1Visible, ID.docA2, ID.docB1]);
  if (error) throw new Error(`approve-after-versioning: ${error.message}`);
  // docA1Hidden is deliberately left pending + visible_to_client=false.
}

// ── probe helpers (act as a signed-in user; RLS applies) ────────────────────

async function tryDownload(client, objPath) {
  const { data, error } = await client.storage.from(BUCKET).download(objPath);
  if (error || !data) return { ok: false, detail: error?.message || 'no data' };
  const text = await data.text();
  return { ok: true, detail: `${text.length} bytes` };
}

async function trySign(client, objPath) {
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(objPath, 60);
  if (error || !data?.signedUrl) return { ok: false, url: null, detail: error?.message || 'no url' };
  return { ok: true, url: data.signedUrl, detail: 'signed url issued' };
}

async function signedUrlServes(url) {
  if (!url) return false;
  try {
    const res = await fetch(url);
    return res.status === 200;
  } catch {
    return false;
  }
}

async function listNames(client, prefix) {
  const { data, error } = await client.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) return { names: [], detail: error.message };
  return { names: (data || []).map((e) => e.name), detail: '' };
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const admin = adminClient();
  const ids = await seed(admin);

  const { client: uA1 } = await signInAs(EMAIL.uA1, PASSWORD);
  const { client: pa } = await signInAs(EMAIL.pa, PASSWORD);
  const { client: ea } = await signInAs(EMAIL.ea, PASSWORD);

  // ==========================================================================
  // FULL 18-CHECK SUITE (as U_A1 unless noted; PA for 17–18). DENIED = boundary held.
  // ==========================================================================

  // 1
  {
    const { data } = await uA1.from('tasks').select('id').eq('id', ID.taskA2Visible);
    results.push(log('#1  U_A1 SELECT A2 task by id → DENIED', (data || []).length === 0, `rows: ${data?.length}`));
  }
  // 2
  {
    const { data } = await uA1.from('documents').select('id').eq('id', ID.docA2);
    results.push(log('#2  U_A1 SELECT A2 document by id → DENIED', (data || []).length === 0, `rows: ${data?.length}`));
  }
  // 3
  {
    const { data } = await uA1.from('task_comments').select('id').eq('task_id', ID.taskA2Visible);
    results.push(log('#3  U_A1 SELECT A2 comments → DENIED', (data || []).length === 0, `rows: ${data?.length}`));
  }
  // 4
  {
    const { data } = await uA1.from('tasks').select('id').in('id', [ID.taskA1Internal, ID.taskA1Created]);
    results.push(log('#4  U_A1 SELECT own internal / created-stage tasks → DENIED', (data || []).length === 0, `rows: ${data?.length}`));
  }
  // 5
  {
    const { data } = await uA1.from('documents').select('id').eq('id', ID.docA1Hidden);
    results.push(log('#5  U_A1 SELECT own internal pending document row → DENIED', (data || []).length === 0, `rows: ${data?.length}`));
  }
  // 6 — PRIMARY: sibling-client storage isolation now rests entirely on
  //     can_access_document() (migration 003 removed the foldername[2] check).
  {
    const dl = await tryDownload(uA1, OBJ.a2);
    const sg = await trySign(uA1, OBJ.a2);
    results.push(log('#6  U_A1 storage download+sign of SIBLING (A2) object → DENIED', !dl.ok && !sg.ok, `${dl.detail}; ${sg.detail}`));
  }
  // 7 — the finding under test.
  {
    const dl = await tryDownload(uA1, OBJ.a1Hidden);
    const sg = await trySign(uA1, OBJ.a1Hidden);
    const served = await signedUrlServes(sg.url);
    results.push(log('#7  U_A1 storage download+sign of OWN internal/pending object → DENIED', !dl.ok && !sg.ok && !served, `${dl.detail}; ${sg.detail}; served=${served}`));
  }
  // 8
  {
    const { error } = await uA1.from('notifications').insert({
      firm_id: ID.firmA, user_id: ids.uA1Id, type: 'comment_added',
      title: 'forged', message: 'rls suite',
    });
    results.push(log('#8  U_A1 INSERT notification → DENIED', !!error, error?.message || 'INSERT SUCCEEDED (bug)'));
  }
  // 9
  {
    const { error: e1 } = await uA1.from('profiles').update({ role: 'partner' }).eq('id', ids.uA1Id);
    const { error: e2 } = await uA1.from('profiles').update({ client_id: ID.clientA2 }).eq('id', ids.uA1Id);
    results.push(log('#9  U_A1 UPDATE own profile role / client_id → DENIED', !!e1 && !!e2, `${e1?.message || 'role OK (bug)'} / ${e2?.message || 'client OK (bug)'}`));
  }
  // 10
  {
    const { error: e1 } = await uA1.from('profiles').insert({ id: randomUUID(), firm_id: ID.firmA, name: 'x', email: 'x@x.com', role: 'employee' });
    const { error: e2 } = await uA1.from('firms').insert({ id: randomUUID(), name: 'rogue firm' });
    results.push(log('#10 U_A1 INSERT profiles / firms → DENIED', !!e1 && !!e2, `${e1?.message || 'profiles OK (bug)'} / ${e2?.message || 'firms OK (bug)'}`));
  }
  // 11
  {
    const { data, error } = await uA1.from('tasks').update({ priority: 'urgent' }).eq('id', ID.taskA1Visible).select();
    results.push(log('#11 U_A1 UPDATE own visible task stage → DENIED (0 rows)', !error && (data || []).length === 0, error?.message || `rows: ${data?.length}`));
  }
  // 12
  {
    const { error } = await uA1.from('task_stage_history').insert({
      firm_id: ID.firmA, task_id: ID.taskA1Visible, to_stage: 'completed',
    });
    results.push(log('#12 U_A1 INSERT task_stage_history → DENIED', !!error, error?.message || 'INSERT SUCCEEDED (bug)'));
  }
  // 13
  {
    const { data } = await uA1.from('client_registrations').select('id').eq('client_id', ID.clientA2);
    results.push(log('#13 U_A1 SELECT A2 registrations → DENIED', (data || []).length === 0, `rows: ${data?.length}`));
  }
  // 14 — by design: compliance_types is a platform-wide catalog (no firm_id).
  {
    const { data } = await uA1.from('compliance_types').select('id');
    results.push(log('#14 U_A1 SELECT compliance_types → allowed (global catalog, by design)', (data || []).length > 0, `rows: ${data?.length}`));
  }
  // 15
  {
    const { data } = await uA1.from('platform_admins').select('user_id');
    results.push(log('#15 U_A1 SELECT platform_admins → DENIED', (data || []).length === 0, `rows: ${data?.length}`));
  }
  // 16
  {
    const t = await uA1.from('tasks').select('id');
    const c = await uA1.from('clients').select('id');
    const d = await uA1.from('documents').select('id');
    const ownScoped = (t.data || []).every((r) => r.id === ID.taskA1Visible)
      && (c.data || []).every((r) => r.id === ID.clientA1)
      && (d.data || []).every((r) => r.id === ID.docA1Visible);
    results.push(log('#16 U_A1 unfiltered enumerate tasks/clients/documents → own+curated only', ownScoped, `tasks=${t.data?.length} clients=${c.data?.length} docs=${d.data?.length}`));
  }
  // 17 — PA cannot see Firm B rows.
  {
    const tb = await pa.from('tasks').select('id').eq('firm_id', ID.firmB);
    const cb = await pa.from('clients').select('id').eq('firm_id', ID.firmB);
    const db = await pa.from('documents').select('id').eq('firm_id', ID.firmB);
    const denied = (tb.data || []).length === 0 && (cb.data || []).length === 0 && (db.data || []).length === 0;
    results.push(log('#17 PA SELECT Firm B rows across tables → DENIED', denied, `tasks=${tb.data?.length} clients=${cb.data?.length} docs=${db.data?.length}`));
  }
  // 18 — PA cannot touch Firm B storage.
  {
    const dl = await tryDownload(pa, OBJ.b1);
    const sg = await trySign(pa, OBJ.b1);
    const ls = await listNames(pa, `${ID.firmB}/${ID.clientB1}`);
    results.push(log('#18 PA storage download+sign+list Firm B → DENIED', !dl.ok && !sg.ok && ls.names.length === 0, `${dl.detail}; ${sg.detail}; list=${ls.names.length}`));
  }

  // ==========================================================================
  // #7 ENUMERATION SUB-CHECKS — the fix must also stop list-based discovery.
  // ==========================================================================
  {
    const top = await listNames(uA1, `${ID.firmA}/${ID.clientA1}`);
    const hiddenFolderListed = top.names.includes(ID.docA1Hidden);
    const visibleFolderListed = top.names.includes(ID.docA1Visible);
    results.push(log('#7a U_A1 list(firmA/A1) hides the internal document_id folder', !hiddenFolderListed, `names: [${top.names.join(', ')}]`));
    // Positive counterpart: the approved+visible folder SHOULD be listable — a
    // policy that hides everything also "passes" the hide test (see regressions).
    results.push(log('#7b U_A1 list(firmA/A1) still shows the approved+visible folder', visibleFolderListed, `names: [${top.names.join(', ')}]`));
    const inner = await listNames(uA1, `${ID.firmA}/${ID.clientA1}/${ID.docA1Hidden}`);
    results.push(log('#7c U_A1 list(firmA/A1/<hiddenDocId>) reveals no object', inner.names.length === 0, `entries: ${inner.names.length}`));
  }

  // ==========================================================================
  // REGRESSIONS — the fix must not have turned the portal into a brick. A
  // policy that denies everything also passes the whole attack list; these are
  // what distinguish a fix from a brick.
  // ==========================================================================
  {
    // Partner reads ALL firm files, including the internal/pending one.
    const dlHidden = await tryDownload(pa, OBJ.a1Hidden);
    const dlVisible = await tryDownload(pa, OBJ.a1Visible);
    const dlA2 = await tryDownload(pa, OBJ.a2);
    const ls = await listNames(pa, `${ID.firmA}/${ID.clientA1}`);
    const listsInternal = ls.names.includes(ID.docA1Hidden);
    results.push(log('R1  PA reads ALL firm-A files (incl. internal) + lists internal folder', dlHidden.ok && dlVisible.ok && dlA2.ok && listsInternal, `hidden=${dlHidden.detail}, visible=${dlVisible.detail}, a2=${dlA2.detail}, listsInternal=${listsInternal}`));
  }
  {
    // Employee reads firm files per the firm-wide staff storage floor.
    const dl = await tryDownload(ea, OBJ.a1Visible);
    results.push(log('R2  E_A (employee) reads firm-A document file', dl.ok, dl.detail));
  }
  {
    // THE key regression: portal client can STILL read its own approved+visible
    // doc (seeded approved AFTER versioning — see header). If this fails, the
    // policy is over-denying / a brick.
    const dl = await tryDownload(uA1, OBJ.a1Visible);
    const sg = await trySign(uA1, OBJ.a1Visible);
    const served = await signedUrlServes(sg.url);
    results.push(log('R3  U_A1 CAN read its OWN approved+visible document (not a brick)', dl.ok && sg.ok && served, `${dl.detail}; ${sg.detail}; served=${served}`));
  }

  // ==========================================================================
  // EDGE CASES introduced by migration 003's segment-[3] ::uuid cast.
  // Uploaded AS THE CLIENT (its INSERT policy validates only [1]/[2], so [3] is
  // attacker-controlled). The SELECT policy's CASE guard must return false, not
  // raise, on these.
  // ==========================================================================
  {
    // Tolerate "already exists" on re-run (client has no storage UPDATE policy,
    // so upsert can't overwrite; a plain re-upload of an existing object 409s).
    const u1 = await uA1.storage.from(BUCKET).upload(OBJ.edgeNonUuid, buf('edge non-uuid'));
    const u2 = await uA1.storage.from(BUCKET).upload(OBJ.edgeGhostUuid, buf('edge ghost uuid'));
    const uploadedOk = (!u1.error || /exist|dupl/i.test(u1.error.message)) && (!u2.error || /exist|dupl/i.test(u2.error.message));
    results.push(log('E0  U_A1 CAN upload segment-[3] non-UUID / ghost-UUID objects (INSERT only checks [1]/[2])', uploadedOk, `${u1.error?.message || 'ok'} / ${u2.error?.message || 'ok'}`));

    const dlNon = await tryDownload(uA1, OBJ.edgeNonUuid);
    const dlNonList = await listNames(uA1, `${ID.firmA}/${ID.clientA1}/not-a-uuid`);
    results.push(log('E1  U_A1 read of segment-[3] NON-UUID object → DENIED, no error thrown', !dlNon.ok && !dlNonList.detail, `${dlNon.detail}; listErr=${dlNonList.detail || 'none'}`));

    const dlGhost = await tryDownload(uA1, OBJ.edgeGhostUuid);
    const dlGhostList = await listNames(uA1, `${ID.firmA}/${ID.clientA1}/${'55555555-5555-4555-8555-555555555555'}`);
    results.push(log('E2  U_A1 read of well-formed-UUID-with-no-documents-row object → DENIED', !dlGhost.ok && dlGhostList.names.length === 0, `${dlGhost.detail}; listEntries=${dlGhostList.names.length}`));
  }

  // ── summary ──
  console.log('\n--- 07-storage-visibility summary ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed.`);

  try {
    writeFileSync(path.join(DATA_DIR, 'results-07-storage-visibility.json'), JSON.stringify(results, null, 2));
  } catch {
    // .data/ may not exist in a fresh checkout — the console output is the record.
  }
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
