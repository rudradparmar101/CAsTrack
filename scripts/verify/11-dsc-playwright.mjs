// Phase 13.2 — Playwright pass through the REAL /dsc UI (migration 008
// already applied and confirmed; RLS/RPC-level proofs already covered by
// 10-dsc-register.mjs, 17/17). This script drives the actual browser: a
// partner creates a DSC, an employee with clients.view checks it out and
// checks it back in through the real UI (never a direct DB call), and an
// employee with clients.view revoked sees the page's own "No access" state.
//
// Self-contained (same TAG/ID/EMAIL constants as 10-dsc-register.mjs,
// intentionally duplicated rather than imported — every script in this
// directory is independently runnable). Requires the dev server already
// running at SITE_URL (npm run dev).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { SITE_URL } from './lib/env.mjs';
import { adminClient } from './lib/admin.mjs';
import { newActorSession, fillLabeled, selectByOptionText, log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');

const TAG = 'dscpw1';
const PASSWORD = 'DscPwTest123!';

const ID = {
  firm: 'a0000000-0000-4000-8000-00000d140001',
  client: 'a0000000-0000-4000-8000-00000d14c001',
  dscExpired: 'a0000000-0000-4000-8000-00000d14d001',
  dscExpiringSoon: 'a0000000-0000-4000-8000-00000d14d002',
  dscValid: 'a0000000-0000-4000-8000-00000d14d003',
};

const EMAIL = {
  pa: `${TAG}.pa@example.com`,
  ev: `${TAG}.ev@example.com`, // clients.view granted (employee default)
  e0: `${TAG}.e0@example.com`, // clients.view revoked
};

const results = [];

function isoDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

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

  const paId = await ensureUser(admin, EMAIL.pa, { name: 'PA Playwright', role: 'partner', firm_id: ID.firm });
  const evId = await ensureUser(admin, EMAIL.ev, { name: 'EV Playwright', role: 'employee', firm_id: ID.firm });
  const e0Id = await ensureUser(admin, EMAIL.e0, { name: 'E0 Playwright', role: 'employee', firm_id: ID.firm });

  await up(admin, 'profiles', { id: paId, firm_id: ID.firm, name: 'PA Playwright', email: EMAIL.pa, role: 'partner' });
  await up(admin, 'profiles', { id: evId, firm_id: ID.firm, name: 'EV Playwright', email: EMAIL.ev, role: 'employee' });
  await up(admin, 'profiles', { id: e0Id, firm_id: ID.firm, name: 'E0 Playwright', email: EMAIL.e0, role: 'employee' });

  await up(admin, 'clients', { id: ID.client, firm_id: ID.firm, name: `${TAG} Client`, business_type: 'pvt_ltd', created_by: paId });

  await up(admin, 'user_permissions', { user_id: e0Id, permission_key: 'clients.view', granted: false, granted_by: paId }, 'user_id,permission_key');

  // Three pre-seeded DSCs covering all three expiry-status badges. The
  // create FORM itself is exercised separately, live, as PA below.
  await up(admin, 'dsc_register', {
    id: ID.dscExpired, firm_id: ID.firm, client_id: ID.client,
    holder_name: `${TAG} Expired Holder`, issuing_authority: 'eMudhra', dsc_class: 'Class 3',
    serial_number: `${TAG}-EXPIRED`, expires_on: isoDate(-5), current_custodian_id: null,
    is_active: true, created_by: paId,
  });
  await up(admin, 'dsc_register', {
    id: ID.dscExpiringSoon, firm_id: ID.firm, client_id: ID.client,
    holder_name: `${TAG} Expiring-Soon Holder`, issuing_authority: 'Sify', dsc_class: 'Class 3',
    serial_number: `${TAG}-EXPSOON`, expires_on: isoDate(15), current_custodian_id: null,
    is_active: true, created_by: paId,
  });
  await up(admin, 'dsc_register', {
    id: ID.dscValid, firm_id: ID.firm, client_id: ID.client,
    holder_name: `${TAG} Valid Holder`, issuing_authority: 'nCode', dsc_class: 'Class 3',
    serial_number: `${TAG}-VALID`, expires_on: isoDate(180), current_custodian_id: null,
    is_active: true, created_by: paId,
  });
  // Clean movement history from any previous run so the "empty history"
  // and "exactly one entry after check-out" checks below are unambiguous.
  await admin.from('dsc_custody_movements').delete().eq('dsc_id', ID.dscValid);

  return { paId, evId, e0Id };
}

async function main() {
  const admin = adminClient();
  await seed(admin);
  const browser = await chromium.launch();

  // ==========================================================================
  // PA (partner): create a DSC through the REAL form; confirm it lands with
  // an "Expiring soon" badge for a +10-day expiry.
  // ==========================================================================
  const newHolderName = `${TAG} Created via UI`;
  {
    const pa = await newActorSession(browser, { baseURL: SITE_URL, email: EMAIL.pa, password: PASSWORD });
    await pa.page.goto('/dsc', { waitUntil: 'domcontentloaded' });

    await pa.page.getByRole('button', { name: 'Add DSC' }).click();
    await pa.page.getByRole('heading', { name: 'Add DSC' }).waitFor({ timeout: 10000 });

    await selectByOptionText(pa.page, 'Client', `${TAG} Client`);
    await fillLabeled(pa.page, 'Holder name', newHolderName);
    await fillLabeled(pa.page, 'Issuing authority', 'eMudhra');
    await fillLabeled(pa.page, 'Serial / reference number', `${TAG}-UI-CREATED`);
    await fillLabeled(pa.page, 'Expires on', isoDate(10));

    await pa.page.locator('form').getByRole('button', { name: 'Add DSC', exact: true }).click();
    await pa.page.getByRole('heading', { name: 'Add DSC' }).waitFor({ state: 'detached', timeout: 10000 });

    const row = pa.page.locator('tr', { hasText: newHolderName });
    await row.waitFor({ timeout: 10000 });
    results.push(log('PA: created a DSC via the real Add DSC form and it appears in the list', true));

    const badgeText = await row.getByText('Expiring soon').isVisible().catch(() => false);
    results.push(log('PA: the newly created (+10 day expiry) DSC shows an "Expiring soon" badge', badgeText));

    // All three badge variants, in one screen.
    const expiredRow = pa.page.locator('tr', { hasText: `${TAG} Expired Holder` });
    const expiringRow = pa.page.locator('tr', { hasText: `${TAG} Expiring-Soon Holder` });
    const validRow = pa.page.locator('tr', { hasText: `${TAG} Valid Holder` });
    results.push(log('Badge: expired DSC shows "Expired"', await expiredRow.getByText('Expired', { exact: true }).isVisible().catch(() => false)));
    results.push(log('Badge: expiring-soon DSC shows "Expiring soon"', await expiringRow.getByText('Expiring soon').isVisible().catch(() => false)));
    results.push(log('Badge: +180-day DSC shows "Valid"', await validRow.getByText('Valid', { exact: true }).isVisible().catch(() => false)));

    await pa.page.screenshot({ path: path.join(DATA_DIR, 'dsc-partner-list.png'), fullPage: true });

    // PA can edit directly (pencil icon present for a partner).
    const editableRow = pa.page.locator('tr', { hasText: `${TAG} Valid Holder` });
    const editIconVisible = await editableRow.getByTitle('Edit DSC record').isVisible().catch(() => false);
    results.push(log('PA: sees the Edit (pencil) icon on a DSC row', editIconVisible));

    await pa.context.close();
  }

  // ==========================================================================
  // EV (employee, clients.view granted): reads, checks a DSC out to
  // herself, checks it back in, views history — all through the real UI.
  // Never sees Add DSC / Edit (partner-only).
  // ==========================================================================
  {
    const ev = await newActorSession(browser, { baseURL: SITE_URL, email: EMAIL.ev, password: PASSWORD });
    await ev.page.goto('/dsc', { waitUntil: 'domcontentloaded' });

    const canSeeList = await ev.page.getByText(`${TAG} Valid Holder`).isVisible().catch(() => false);
    results.push(log('EV (clients.view granted): CAN see the DSC register list', canSeeList));

    const addButtonVisible = await ev.page.getByRole('button', { name: 'Add DSC' }).isVisible().catch(() => false);
    results.push(log('EV: does NOT see "Add DSC" (partner-only)', !addButtonVisible));

    const validRow = ev.page.locator('tr', { hasText: `${TAG} Valid Holder` });
    const editIconVisible = await validRow.getByTitle('Edit DSC record').isVisible().catch(() => false);
    results.push(log('EV: does NOT see the Edit (pencil) icon (partner-only)', !editIconVisible));

    // Check-out to herself.
    await validRow.getByTitle('Check out').click();
    await ev.page.getByRole('heading', { name: 'Check out DSC' }).waitFor({ timeout: 10000 });
    await ev.page.getByLabel('Check out to', { exact: true }).selectOption({ label: 'EV Playwright (me)' });
    const checkoutNote = `${TAG} collected in person for GSTR-9 filing`;
    await fillLabeled(ev.page, 'Note (optional)', checkoutNote);
    await ev.page.locator('form').getByRole('button', { name: 'Check out', exact: true }).click();
    await ev.page.getByRole('heading', { name: 'Check out DSC' }).waitFor({ state: 'detached', timeout: 10000 });

    await ev.page.reload({ waitUntil: 'domcontentloaded' });
    const custodianShown = await ev.page
      .locator('tr', { hasText: `${TAG} Valid Holder` })
      .getByText('EV Playwright')
      .isVisible()
      .catch(() => false);
    results.push(log('EV: after check-out, the row shows her as custodian', custodianShown));

    const stillValidBadge = await ev.page
      .locator('tr', { hasText: `${TAG} Valid Holder` })
      .getByText('Valid', { exact: true })
      .isVisible()
      .catch(() => false);
    results.push(log('EV: expiry badge is unaffected by custody (still "Valid")', stillValidBadge));

    // Movement history shows the check-out with her note.
    await ev.page.locator('tr', { hasText: `${TAG} Valid Holder` }).getByTitle('Movement history').click();
    await ev.page.getByRole('heading', { name: /Movement history/ }).waitFor({ timeout: 10000 });
    const historyShowsCheckout = await ev.page.getByText(/Checked out to/).isVisible().catch(() => false);
    const historyShowsNote = await ev.page.getByText(checkoutNote).isVisible().catch(() => false);
    results.push(log('EV: movement history shows the check-out entry', historyShowsCheckout));
    results.push(log('EV: movement history shows her note', historyShowsNote));
    await ev.page.screenshot({ path: path.join(DATA_DIR, 'dsc-movement-history.png'), fullPage: true });
    await ev.page.keyboard.press('Escape');

    // Check back in.
    await ev.page.locator('tr', { hasText: `${TAG} Valid Holder` }).getByTitle('Check in').click();
    await ev.page.getByRole('heading', { name: 'Check in DSC' }).waitFor({ timeout: 10000 });
    await fillLabeled(ev.page, 'Note (optional)', 'returned to office safe');
    await ev.page.locator('form').getByRole('button', { name: 'Check in', exact: true }).click();
    await ev.page.getByRole('heading', { name: 'Check in DSC' }).waitFor({ state: 'detached', timeout: 10000 });

    await ev.page.reload({ waitUntil: 'domcontentloaded' });
    const backToUnassigned = await ev.page
      .locator('tr', { hasText: `${TAG} Valid Holder` })
      .getByText('Not checked out')
      .isVisible()
      .catch(() => false);
    results.push(log('EV: after check-in, the row shows "Not checked out" again', backToUnassigned));

    await ev.context.close();
  }

  // ==========================================================================
  // E0 (employee, clients.view REVOKED): the page's own "No access" state.
  // The raw-PostgREST-level rejection (zero rows AND record_dsc_movement()
  // rejected) is already proven by 10-dsc-register.mjs (R2/R4/M1, 17/17) —
  // this confirms the UI-visible experience matches that DB-level truth.
  // ==========================================================================
  {
    const e0 = await newActorSession(browser, { baseURL: SITE_URL, email: EMAIL.e0, password: PASSWORD });
    await e0.page.goto('/dsc', { waitUntil: 'domcontentloaded' });
    const noAccessVisible = await e0.page.getByText('No access').isVisible().catch(() => false);
    const registerHidden = await e0.page.getByText(`${TAG} Valid Holder`).isVisible().catch(() => false);
    results.push(log('E0 (clients.view revoked): sees the page\'s own "No access" state', noAccessVisible));
    results.push(log('E0: the register itself is NOT rendered', !registerHidden));
    await e0.page.screenshot({ path: path.join(DATA_DIR, 'dsc-no-access.png'), fullPage: true });
    await e0.context.close();
  }

  // client_user: no /portal/dsc route exists at all (by design — no
  // client-facing surface was built, per the phase's explicit scope). There
  // is nothing to click through; the RLS-level proof (zero rows, RPC
  // rejected) is 10-dsc-register.mjs's M2/R3/R5.
  results.push(log('client_user: no /portal DSC surface exists to test (by design); RLS proof is in 10-dsc-register.mjs', true));

  await browser.close();

  // ── summary ──
  console.log('\n--- 11-dsc-playwright summary ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed.`);

  try {
    writeFileSync(path.join(DATA_DIR, 'results-11-dsc-playwright.json'), JSON.stringify(results, null, 2));
  } catch {
    // .data/ may not exist in a fresh checkout — the console output is the record.
  }
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
