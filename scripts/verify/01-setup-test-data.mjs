// Phase 7 — Step 1: fresh, deterministic test data.
// Creates P1 (partner), E1 (employee, added to GST dept), E2 (employee, no
// dept, clients.view revoked), two clients with addresses/persons, a spread
// of tasks, and a client-A portal invite. Writes scripts/verify/.data/context.json
// and per-actor storageState files for later scripts to restore sessions from.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from './lib/env.mjs';
import { adminClient, createConfirmedUser } from './lib/admin.mjs';
import { newActorSession, createClient as createClientUi, createTask, log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');
mkdirSync(DATA_DIR, { recursive: true });
const CONTEXT_PATH = path.join(DATA_DIR, 'context.json');
const statePath = (who) => path.join(DATA_DIR, `state-${who}.json`);

const TAG = Date.now().toString(36);
const PASSWORD = 'Ph7Test123!';
const results = [];

function email(role) {
  // Supabase's signup validator rejects non-public TLDs like .local/.test;
  // example.com is the standard RFC 2606 reserved domain for this.
  return `ph7.${role}.${TAG}@example.com`;
}

async function main() {
  const admin = adminClient();
  const browser = await chromium.launch();

  const data = {
    tag: TAG,
    password: PASSWORD,
    p1: { email: email('p1'), name: 'Priya Partner' },
    e1: { email: email('e1'), name: 'Esha Employee' },
    e2: { email: email('e2'), name: 'Eshaan Employee' },
    clientAUser: { email: email('clienta'), name: 'Client Alpha Contact' },
    statePaths: { p1: statePath('p1'), e1: statePath('e1'), e2: statePath('e2') },
  };

  // ---- P1: partner account ----
  // DEVIATION from the literal "real signup form" instruction, documented in
  // docs/verification/phase-7-runtime.md: supabase.auth.signUp() triggers
  // Supabase's built-in confirmation mailer on every call, and its rate limit
  // was hit on the very first attempt of this run (confirms project_context.md
  // §6 item 9 is real, not theoretical). We create the auth user directly via
  // the admin API with the SAME user_metadata shape signupCreateFirmAction
  // would set, so the real /onboarding page's provisionFromMetadata() (the
  // part that actually matters — firm + profile creation) still runs for
  // real via a real browser login, each actor in its own isolated browser
  // context (own cookies) so sessions never cross-contaminate.
  await createConfirmedUser(admin, {
    email: data.p1.email,
    password: PASSWORD,
    metadata: { name: data.p1.name, firmName: `Phase7 QA Firm ${TAG}`, signup_mode: 'create_firm' },
  });
  const p1 = await newActorSession(browser, {
    baseURL: SITE_URL,
    email: data.p1.email,
    password: PASSWORD,
    statePath: data.statePaths.p1,
  });
  results.push(log('P1 admin-created -> real login -> onboarding provisioning -> /dashboard', p1.page.url().includes('/dashboard'), p1.page.url()));

  const { data: p1Profile } = await admin
    .from('profiles')
    .select('id, firm_id')
    .eq('email', data.p1.email)
    .single();
  data.p1.id = p1Profile.id;
  data.firmId = p1Profile.firm_id;

  const { data: firm } = await admin.from('firms').select('invite_code, name').eq('id', data.firmId).single();
  data.firmName = firm.name;
  data.inviteCode = firm.invite_code;
  results.push(log('Firm provisioned with invite code', !!firm.invite_code, firm.invite_code));

  const { data: departments } = await admin
    .from('departments')
    .select('id, code, name')
    .eq('firm_id', data.firmId);
  results.push(log('6 default departments seeded', departments.length === 6, `${departments.length} found`));
  data.departments = departments;
  const gst = departments.find((d) => d.code === 'gst');
  const incomeTax = departments.find((d) => d.code === 'income_tax');
  data.gstDeptId = gst.id;
  data.incomeTaxDeptId = incomeTax.id;

  // ---- E1: employee account ----
  await createConfirmedUser(admin, {
    email: data.e1.email,
    password: PASSWORD,
    metadata: { name: data.e1.name, inviteCode: data.inviteCode, signup_mode: 'join_firm' },
  });
  const e1 = await newActorSession(browser, {
    baseURL: SITE_URL,
    email: data.e1.email,
    password: PASSWORD,
    statePath: data.statePaths.e1,
  });
  results.push(log('E1 admin-created -> real login -> onboarding provisioning -> /dashboard', e1.page.url().includes('/dashboard'), e1.page.url()));

  const { data: e1Profile } = await admin.from('profiles').select('id').eq('email', data.e1.email).single();
  data.e1.id = e1Profile.id;

  // ---- E2: employee account ----
  await createConfirmedUser(admin, {
    email: data.e2.email,
    password: PASSWORD,
    metadata: { name: data.e2.name, inviteCode: data.inviteCode, signup_mode: 'join_firm' },
  });
  const e2 = await newActorSession(browser, {
    baseURL: SITE_URL,
    email: data.e2.email,
    password: PASSWORD,
    statePath: data.statePaths.e2,
  });
  results.push(log('E2 admin-created -> real login -> onboarding provisioning -> /dashboard', e2.page.url().includes('/dashboard'), e2.page.url()));

  const { data: e2Profile } = await admin.from('profiles').select('id').eq('email', data.e2.email).single();
  data.e2.id = e2Profile.id;

  // ---- P1 adds E1 to the GST department via the real Team UI ----
  const p1Page = p1.page;
  await p1Page.goto('/team', { waitUntil: 'domcontentloaded' });
  const gstCard = p1Page.locator(
    'xpath=//h3[normalize-space(text())="GST"]/ancestor::*[self::div][.//button[contains(., "Manage")]][1]'
  );
  await gstCard.getByRole('button', { name: 'Manage' }).click();
  await p1Page.getByRole('heading', { name: /Manage Members/ }).waitFor({ timeout: 10000 });
  await p1Page.getByRole('button', { name: 'Add Member' }).click();
  const addMemberSelect = p1Page.getByLabel('Add Member', { exact: true });
  const e1OptionValue = await addMemberSelect
    .locator('option', { hasText: data.e1.name })
    .first()
    .getAttribute('value');
  await addMemberSelect.selectOption(e1OptionValue);
  await p1Page.getByRole('button', { name: 'Add', exact: true }).click();
  await p1Page.getByText(data.e1.name, { exact: true }).first().waitFor({ timeout: 5000 });
  await p1Page.getByRole('button', { name: 'Done' }).click();

  // The admin client's PostgREST connection can lag a beat behind the app's
  // own connection under the Supabase pooler, so poll rather than a single
  // fixed-delay read (that single read was an intermittent false-negative).
  let deptMember = null;
  for (let i = 0; i < 8 && !deptMember; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const { data: row } = await admin
      .from('department_members')
      .select('*')
      .eq('department_id', data.gstDeptId)
      .eq('user_id', data.e1.id)
      .maybeSingle();
    deptMember = row;
  }
  results.push(log('E1 added to GST department via Team UI', !!deptMember));

  // ---- E2: revoke clients.view via direct service-role insert ----
  const { error: revokeErr } = await admin.from('user_permissions').insert({
    user_id: data.e2.id,
    permission_key: 'clients.view',
    granted: false,
    granted_by: data.p1.id,
  });
  results.push(log('E2 clients.view revoked via service-role insert', !revokeErr, revokeErr?.message || ''));

  // ---- Clients A and B, each with an address + authorized person ----
  const clientAName = `Alpha Textiles Pvt Ltd ${TAG}`;
  const clientBName = `Beta Traders LLP ${TAG}`;

  await createClientUi(p1Page, {
    name: clientAName,
    businessType: 'pvt_ltd',
    gstin: '27ABCDE1234F1Z5',
    // Client A's contact email == the portal login email we invite below.
    // Portal invites are constrained to the client's recorded contacts
    // (app-layer audit M5a), so this must be a saved email on the client.
    email: data.clientAUser.email,
    address: { line1: '12 MG Road', city: 'Mumbai', state: 'Maharashtra', stateCode: '27', pincode: '400001' },
    person: { name: 'Alok Alpha', designation: 'Director' },
  });
  await createClientUi(p1Page, {
    name: clientBName,
    businessType: 'llp',
    address: { line1: '45 Residency Road', city: 'Bengaluru', state: 'Karnataka', stateCode: '29', pincode: '560025' },
    person: { name: 'Bhavna Beta', designation: 'Partner' },
  });

  const { data: clientA } = await admin.from('clients').select('id, name').eq('name', clientAName).single();
  const { data: clientB } = await admin.from('clients').select('id, name').eq('name', clientBName).single();
  results.push(log('Client A created', !!clientA?.id, clientA?.id));
  results.push(log('Client B created', !!clientB?.id, clientB?.id));
  data.clientA = clientA;
  data.clientB = clientB;

  // ---- Tasks spread across both clients ----
  const dueDate = '2026-08-15';

  // Task M: reviewer set (P1) — drives the full stage-matrix + reviewer-rule walk.
  await createTask(p1Page, {
    title: `GSTR-3B Filing — ${TAG}`,
    client: clientAName,
    department: 'GST',
    dueDate,
    priority: 'high',
    assignTo: data.e1.name,
    reviewer: data.p1.name,
  });
  // Task N: no reviewer — direct in_progress->completed, and the shared task
  // for comments/documents/portal e2e (client-visible throughout).
  await createTask(p1Page, {
    title: `TDS Return Q1 — ${TAG}`,
    client: clientAName,
    department: 'GST',
    dueDate,
    priority: 'medium',
    assignTo: data.e1.name,
  });
  // Task R: monthly recurring.
  await createTask(p1Page, {
    title: `Monthly Bookkeeping — ${TAG}`,
    client: clientAName,
    department: 'GST',
    dueDate,
    recurrence: 'monthly',
    assignTo: data.e1.name,
  });
  // Task D: client B, Income Tax dept, NOT assigned to E1, internal-only —
  // the RLS-isolation negative case (E1 must not see this).
  await createTask(p1Page, {
    title: `Income Tax Assessment — ${TAG}`,
    client: clientBName,
    department: 'Income Tax',
    dueDate,
    visibleToClient: false,
  });

  const { data: tasks } = await admin
    .from('tasks')
    .select('id, title, stage, client_id, department_id, assigned_to, reviewer_id, visible_to_client')
    .eq('firm_id', data.firmId)
    .ilike('title', `%${TAG}%`);
  results.push(log('4 tasks created', tasks?.length === 4, `${tasks?.length} found`));
  data.taskMatrixWithReviewer = tasks.find((t) => t.title.startsWith('GSTR-3B'));
  data.taskShared = tasks.find((t) => t.title.startsWith('TDS Return'));
  data.taskRecurring = tasks.find((t) => t.title.startsWith('Monthly Bookkeeping'));
  data.taskOtherDept = tasks.find((t) => t.title.startsWith('Income Tax Assessment'));
  results.push(log('Task M auto-advanced created->assigned on insert (assignee set)', data.taskMatrixWithReviewer?.stage === 'assigned'));
  results.push(log('Task M has reviewer set', !!data.taskMatrixWithReviewer?.reviewer_id));
  results.push(log('Task N has no reviewer', !data.taskShared?.reviewer_id));
  results.push(log('Task D not assigned to E1 / different department', data.taskOtherDept?.assigned_to !== data.e1.id));

  // ---- Portal invite for Client A — capture link from UI AND server console ----
  await p1Page.goto(`/clients/${clientA.id}`, { waitUntil: 'domcontentloaded' });
  await p1Page.getByRole('button', { name: 'Invite to Portal' }).click();
  await p1Page.getByRole('heading', { name: 'Invite to Client Portal' }).waitFor({ timeout: 10000 });
  // M5a: the invite recipient is now a <Select> constrained to the client's
  // recorded contacts (label "Send the invitation to"), not a free-text input.
  // Client A's contact email was set to clientAUser.email above, so it's an option.
  await p1Page.getByLabel('Send the invitation to').selectOption(data.clientAUser.email);
  await p1Page.getByRole('button', { name: 'Create invitation' }).click();
  // Success copy is now "Invitation created and an email has been sent to the client."
  await p1Page.getByText(/Invitation created/).waitFor({ timeout: 10000 });
  const inviteUrlText = await p1Page.locator('code').first().textContent();
  data.clientAInviteUrl = inviteUrlText?.trim();
  results.push(log('Portal invite URL captured from UI modal', !!data.clientAInviteUrl?.includes('accept-invite'), data.clientAInviteUrl));

  const { data: invitation } = await admin
    .from('client_portal_invitations')
    .select('token, email')
    .eq('client_id', clientA.id)
    .eq('email', data.clientAUser.email)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  results.push(log('client_portal_invitations row exists', !!invitation?.token));
  data.clientAInviteToken = invitation?.token;

  // Refresh P1's storageState (session cookies unlikely to have changed, but
  // keep the persisted file in sync with the final navigated state).
  await p1.context.storageState({ path: data.statePaths.p1 });

  writeFileSync(CONTEXT_PATH, JSON.stringify(data, null, 2));
  await browser.close();

  console.log('\n--- Step 1 summary (accounts + departments + permissions) ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n${failed.length} FAILURES — stopping before client/task creation.`);
    process.exit(1);
  }
  console.log(`\nContext written to ${CONTEXT_PATH}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
