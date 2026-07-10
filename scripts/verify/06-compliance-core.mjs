// Phase 10 — compliance core: demo firm, ~20 clients with mixed
// applicability, verify calendar-driven statutory generation (via the real
// /api/cron/generate-statutory-tasks route, service-role, CRON_SECRET) is
// correct and idempotent, and that the itr_non_audit/itr_audit conflict pair
// resolves to exactly one per client (see generation.ts's documented fix).
//
// Unlike 01-05 (which drive the real UI via Playwright), this script seeds
// clients directly via the service-role admin client — the surface under
// test is the generation engine + cron route, not client-creation UI
// (already covered by Phase 7). Requires `npm run dev` running locally.

import { SITE_URL } from './lib/env.mjs';
import { adminClient, createConfirmedUser } from './lib/admin.mjs';

const TAG = Date.now().toString(36);
const PASSWORD = 'Ph10Test123!';
const results = [];

function log(label, ok, detail = '') {
  return { label, ok, detail };
}

function email(role) {
  return `ph10.${role}.${TAG}@example.com`;
}

async function callCron() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET not set in .env.local');
  const res = await fetch(`${SITE_URL}/api/cron/generate-statutory-tasks`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`cron route returned ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const admin = adminClient();

  // ---- Demo firm + partner (direct service-role inserts — no browser
  // needed since we're not testing onboarding here) ----
  const partnerEmail = email('partner');
  const partnerName = 'Priya Demo Partner';
  const partnerAuthId = await createConfirmedUser(admin, {
    email: partnerEmail,
    password: PASSWORD,
    metadata: { name: partnerName },
  });

  const { data: firm, error: firmErr } = await admin
    .from('firms')
    .insert({ name: `Phase10 Demo Firm ${TAG}` })
    .select('id, invite_code')
    .single();
  results.push(log('Demo firm created', !firmErr && !!firm?.id, firmErr?.message || firm?.id));
  const firmId = firm.id;

  const { data: partnerProfile, error: profileErr } = await admin
    .from('profiles')
    .insert({ id: partnerAuthId, firm_id: firmId, name: partnerName, email: partnerEmail, role: 'partner' })
    .select('id')
    .single();
  results.push(log('Partner profile created', !profileErr && !!partnerProfile?.id, profileErr?.message));
  const partnerId = partnerProfile.id;

  const { data: departments } = await admin.from('departments').select('id, code').eq('firm_id', firmId);
  results.push(log('6 default departments seeded', departments?.length === 6, `${departments?.length} found`));

  // ---- ~20 clients with mixed applicability ----
  // Group A (5): regular-scheme GST proprietorships — no TAN, no audit.
  // Group B (5): QRMP-scheme GST proprietorships.
  // Group C (3): composition-scheme GST.
  // Group D (4): pvt_ltd, regular GST + TAN + audit-applicable (the "everything" case).
  // Group E (3): plain individuals, no registrations, not audit-applicable
  //              (only itr_non_audit_annual should apply).
  const clientRows = [];
  for (let i = 1; i <= 5; i++) {
    clientRows.push({ key: `A${i}`, name: `Regular GST Co ${i} ${TAG}`, business_type: 'proprietorship' });
  }
  for (let i = 1; i <= 5; i++) {
    clientRows.push({ key: `B${i}`, name: `QRMP Co ${i} ${TAG}`, business_type: 'proprietorship' });
  }
  for (let i = 1; i <= 3; i++) {
    clientRows.push({ key: `C${i}`, name: `Composition Co ${i} ${TAG}`, business_type: 'proprietorship' });
  }
  for (let i = 1; i <= 4; i++) {
    clientRows.push({
      key: `D${i}`,
      name: `Audit Pvt Ltd ${i} ${TAG}`,
      business_type: 'pvt_ltd',
      is_audit_applicable: true,
      audit_type: 'tax_audit',
    });
  }
  for (let i = 1; i <= 3; i++) {
    clientRows.push({ key: `E${i}`, name: `Individual ${i} ${TAG}`, business_type: 'individual' });
  }

  const { data: insertedClients, error: clientsErr } = await admin
    .from('clients')
    .insert(
      clientRows.map((c) => ({
        firm_id: firmId,
        name: c.name,
        business_type: c.business_type,
        is_audit_applicable: c.is_audit_applicable || false,
        audit_type: c.audit_type || null,
        created_by: partnerId,
      }))
    )
    .select('id, name');
  results.push(log(`${clientRows.length} clients created`, !clientsErr && insertedClients?.length === clientRows.length, clientsErr?.message));

  const byKey = new Map(clientRows.map((c, i) => [c.key, insertedClients[i].id]));

  // Registrations: A/D get a regular GSTIN; B gets a qrmp GSTIN; C gets a
  // composition GSTIN; D also gets a TAN. E gets nothing.
  const regRows = [];
  let gstinCounter = 1000;
  for (const key of [...Array(5).keys()].map((i) => `A${i + 1}`)) {
    regRows.push({ client_id: byKey.get(key), type: 'gstin', registration_number: `27ABCDE${gstinCounter++}F1Z5`, gst_scheme: 'regular', state: 'Maharashtra', state_code: '27' });
  }
  for (const key of [...Array(5).keys()].map((i) => `B${i + 1}`)) {
    regRows.push({ client_id: byKey.get(key), type: 'gstin', registration_number: `29ABCDE${gstinCounter++}F1Z5`, gst_scheme: 'qrmp', state: 'Karnataka', state_code: '29' });
  }
  for (const key of [...Array(3).keys()].map((i) => `C${i + 1}`)) {
    regRows.push({ client_id: byKey.get(key), type: 'gstin', registration_number: `07ABCDE${gstinCounter++}F1Z5`, gst_scheme: 'composition', state: 'Delhi', state_code: '07' });
  }
  let tanCounter = 10000;
  for (const key of [...Array(4).keys()].map((i) => `D${i + 1}`)) {
    regRows.push({ client_id: byKey.get(key), type: 'gstin', registration_number: `06ABCDE${gstinCounter++}F1Z5`, gst_scheme: 'regular', state: 'Haryana', state_code: '06' });
    regRows.push({ client_id: byKey.get(key), type: 'tan', registration_number: `MUMA${tanCounter++}B` });
  }
  const { error: regErr } = await admin
    .from('client_registrations')
    .insert(regRows.map((r) => ({ ...r, firm_id: firmId })));
  results.push(log(`${regRows.length} registrations created`, !regErr, regErr?.message));

  // ---- First generation run ----
  const run1 = await callCron();
  const firmResult1 = run1.results.find((r) => r.firmId === firmId);
  results.push(log('Cron route reached the demo firm', !!firmResult1, JSON.stringify(firmResult1?.summary)));
  results.push(log('First run created tasks', (firmResult1?.summary?.created || 0) > 0, firmResult1?.summary?.created));
  results.push(log('First run had zero errors', (firmResult1?.summary?.errors?.length || 0) === 0, JSON.stringify(firmResult1?.summary?.errors)));

  const firstRunCreated = firmResult1?.summary?.created || 0;

  // ---- Second run: must be a no-op (idempotency) ----
  const run2 = await callCron();
  const firmResult2 = run2.results.find((r) => r.firmId === firmId);
  results.push(log('Second run created 0 new tasks (idempotent)', firmResult2?.summary?.created === 0, firmResult2?.summary?.created));
  results.push(
    log(
      'Second run skipped exactly as many as the first run created',
      firmResult2?.summary?.skippedExisting === firstRunCreated,
      `skipped=${firmResult2?.summary?.skippedExisting}, firstCreated=${firstRunCreated}`
    )
  );

  // ---- Spot-check applicability outcomes ----
  const { data: allTasks } = await admin
    .from('tasks')
    .select('client_id, compliance_type_id, compliance_types!inner(code)')
    .eq('firm_id', firmId)
    .eq('source', 'statutory');

  const codesByClient = new Map();
  for (const t of allTasks || []) {
    const list = codesByClient.get(t.client_id) || [];
    list.push(t.compliance_types.code);
    codesByClient.set(t.client_id, list);
  }

  const a1Codes = codesByClient.get(byKey.get('A1')) || [];
  results.push(log('Regular-GST client got gstr3b_monthly', a1Codes.includes('gstr3b_monthly'), a1Codes.join(',')));
  results.push(log('Regular-GST client did NOT get gstr3b_qrmp', !a1Codes.includes('gstr3b_qrmp')));
  results.push(log('Regular-GST client did NOT get tds_24q (no TAN)', !a1Codes.includes('tds_24q_quarterly')));

  const b1Codes = codesByClient.get(byKey.get('B1')) || [];
  results.push(log('QRMP client got gstr3b_qrmp', b1Codes.includes('gstr3b_qrmp'), b1Codes.join(',')));
  results.push(log('QRMP client did NOT get gstr3b_monthly', !b1Codes.includes('gstr3b_monthly')));

  const c1Codes = codesByClient.get(byKey.get('C1')) || [];
  results.push(log('Composition client got cmp08_quarterly', c1Codes.includes('cmp08_quarterly'), c1Codes.join(',')));
  results.push(log('Composition client did NOT get gstr3b_monthly', !c1Codes.includes('gstr3b_monthly')));

  const d1Codes = codesByClient.get(byKey.get('D1')) || [];
  results.push(log('Audit pvt_ltd got tds_24q_quarterly (has TAN)', d1Codes.includes('tds_24q_quarterly'), d1Codes.join(',')));
  results.push(log('Audit pvt_ltd got itr_audit_annual', d1Codes.includes('itr_audit_annual')));
  results.push(log('Audit pvt_ltd did NOT also get itr_non_audit_annual (conflict pair)', !d1Codes.includes('itr_non_audit_annual')));
  results.push(log('Audit pvt_ltd got tax_audit_report_annual', d1Codes.includes('tax_audit_report_annual')));
  results.push(log('Audit pvt_ltd (business_type) got aoc4_annual', d1Codes.includes('aoc4_annual')));
  results.push(log('Audit pvt_ltd (business_type) got mgt7_annual', d1Codes.includes('mgt7_annual')));

  const e1Codes = codesByClient.get(byKey.get('E1')) || [];
  results.push(log('No-registration individual got ONLY itr_non_audit_annual', e1Codes.length === 1 && e1Codes[0] === 'itr_non_audit_annual', e1Codes.join(',')));

  console.log('\n--- Phase 10 compliance-core summary ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ` (${r.detail})` : ''}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
