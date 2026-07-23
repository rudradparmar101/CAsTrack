// Phase 13.3 — Playwright pass through the REAL /team permissions editor UI.
// RLS-level proofs already covered by 12-permissions-ui.mjs (25/25, run
// AFTER migration 009 was applied and confirmed). This script drives the
// actual browser end to end: a partner grants templates.manage to an
// employee via the real editor, confirms the previously-unreachable
// /templates surface is now reachable for that employee (a real
// user-visible effect, not just a row write), then revokes it and confirms
// the surface is gone again — proving the resolution path end to end.
//
// Self-contained (own TAG/ID/EMAIL constants, intentionally duplicated
// rather than imported — every script in this directory is independently
// runnable). Requires the dev server already running at SITE_URL (npm run
// dev).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { SITE_URL } from './lib/env.mjs';
import { adminClient } from './lib/admin.mjs';
import { newActorSession, log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');

const TAG = 'permpw1';
const PASSWORD = 'PermPwTest123!';

const ID = {
  firm: 'a0000000-0000-4000-8000-000013310001',
};

const EMAIL = {
  pa: `${TAG}.pa@example.com`,
  ev: `${TAG}.ev@example.com`, // templates.manage default false — the surface under test
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

  const paId = await ensureUser(admin, EMAIL.pa, { name: 'PA Playwright', role: 'partner', firm_id: ID.firm });
  const evId = await ensureUser(admin, EMAIL.ev, { name: 'EV Permissions', role: 'employee', firm_id: ID.firm });

  await up(admin, 'profiles', { id: paId, firm_id: ID.firm, name: 'PA Playwright', email: EMAIL.pa, role: 'partner' });
  await up(admin, 'profiles', { id: evId, firm_id: ID.firm, name: 'EV Permissions', email: EMAIL.ev, role: 'employee' });

  // Clean slate: no override on templates.manage for EV, so she starts on
  // the role default (false — unreachable /templates).
  await admin.from('user_permissions').delete().eq('user_id', evId).eq('permission_key', 'templates.manage');

  return { paId, evId };
}

async function main() {
  const admin = adminClient();
  await seed(admin);
  const browser = await chromium.launch();

  // ==========================================================================
  // Baseline: EV cannot reach /templates (templates.manage default false).
  // ==========================================================================
  {
    const ev = await newActorSession(browser, { baseURL: SITE_URL, email: EMAIL.ev, password: PASSWORD });
    await ev.page.goto('/templates', { waitUntil: 'domcontentloaded' });
    await ev.page.waitForURL(/\/dashboard/, { timeout: 10000 }).catch(() => {});
    const onDashboard = ev.page.url().includes('/dashboard');
    results.push(log('Baseline: EV (templates.manage default false) is redirected away from /templates', onDashboard,
      `landed on: ${ev.page.url()}`));
    await ev.context.close();
  }

  // ==========================================================================
  // PA: open the real /team permissions editor for EV, grant templates.manage.
  // ==========================================================================
  {
    const pa = await newActorSession(browser, { baseURL: SITE_URL, email: EMAIL.pa, password: PASSWORD });
    await pa.page.goto('/team', { waitUntil: 'domcontentloaded' });

    const evRow = pa.page.locator('tr', { hasText: 'EV Permissions' });
    await evRow.waitFor({ timeout: 10000 });
    await evRow.getByRole('button', { name: 'Permissions' }).click();
    await pa.page.getByRole('heading', { name: /Permissions — EV Permissions/ }).waitFor({ timeout: 10000 });

    const templatesRow = pa.page.locator('div.rounded-lg', { hasText: 'templates.manage' });
    await templatesRow.waitFor({ timeout: 10000 }); // rows load async after the modal opens
    const offBefore = await templatesRow.getByText('Off', { exact: true }).isVisible().catch(() => false);
    results.push(log('PA: templates.manage shows "Off" for EV before granting', offBefore));

    await templatesRow.getByTitle('Grant').click();
    await templatesRow.getByText('explicitly granted').waitFor({ timeout: 10000 });
    const onAfterGrant = await templatesRow.getByText('On', { exact: true }).isVisible().catch(() => false);
    results.push(log('PA: templates.manage shows "On" / "explicitly granted" for EV after granting', onAfterGrant));

    await pa.page.screenshot({ path: path.join(DATA_DIR, 'permissions-editor-granted.png'), fullPage: true });
    await pa.page.getByRole('button', { name: 'Done' }).click();
    await pa.context.close();
  }

  // ==========================================================================
  // EV: /templates is now reachable — the actual user-visible effect, not
  // just a row write.
  // ==========================================================================
  {
    const ev = await newActorSession(browser, { baseURL: SITE_URL, email: EMAIL.ev, password: PASSWORD });
    await ev.page.goto('/templates', { waitUntil: 'domcontentloaded' });
    const reachable = await ev.page.getByRole('heading', { name: 'Task Templates' }).isVisible().catch(() => false);
    // Two buttons share this label (toolbar + empty-state CTA) — .first() as
    // the DSC/team scripts do for the equivalent "Add Client"/"Add DSC" case.
    const canCreate = await ev.page.getByRole('button', { name: 'New Template' }).first().isVisible().catch(() => false);
    results.push(log('After grant: EV CAN reach /templates', reachable, `url: ${ev.page.url()}`));
    results.push(log('After grant: EV sees "New Template" (templates.manage in effect, not just page-reachable)', canCreate));
    await ev.context.close();
  }

  // ==========================================================================
  // PA: revoke templates.manage for EV via the real editor.
  // ==========================================================================
  {
    const pa = await newActorSession(browser, { baseURL: SITE_URL, email: EMAIL.pa, password: PASSWORD });
    await pa.page.goto('/team', { waitUntil: 'domcontentloaded' });

    const evRow = pa.page.locator('tr', { hasText: 'EV Permissions' });
    await evRow.waitFor({ timeout: 10000 });
    await evRow.getByRole('button', { name: 'Permissions' }).click();
    await pa.page.getByRole('heading', { name: /Permissions — EV Permissions/ }).waitFor({ timeout: 10000 });

    const templatesRow = pa.page.locator('div.rounded-lg', { hasText: 'templates.manage' });
    await templatesRow.waitFor({ timeout: 10000 });
    await templatesRow.getByTitle('Revoke').click();
    await templatesRow.getByText('explicitly revoked').waitFor({ timeout: 10000 });
    const offAfterRevoke = await templatesRow.getByText('Off', { exact: true }).isVisible().catch(() => false);
    results.push(log('PA: templates.manage shows "Off" / "explicitly revoked" for EV after revoking', offAfterRevoke));

    await pa.page.screenshot({ path: path.join(DATA_DIR, 'permissions-editor-revoked.png'), fullPage: true });
    await pa.page.getByRole('button', { name: 'Done' }).click();
    await pa.context.close();
  }

  // ==========================================================================
  // EV: /templates is gone again.
  // ==========================================================================
  {
    const ev = await newActorSession(browser, { baseURL: SITE_URL, email: EMAIL.ev, password: PASSWORD });
    await ev.page.goto('/templates', { waitUntil: 'domcontentloaded' });
    await ev.page.waitForURL(/\/dashboard/, { timeout: 10000 }).catch(() => {});
    const onDashboard = ev.page.url().includes('/dashboard');
    results.push(log('After revoke: EV is redirected away from /templates again', onDashboard,
      `landed on: ${ev.page.url()}`));
    await ev.context.close();
  }

  await browser.close();

  // ── summary ──
  console.log('\n--- 13-permissions-playwright summary ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed.`);

  try {
    writeFileSync(path.join(DATA_DIR, 'results-13-permissions-playwright.json'), JSON.stringify(results, null, 2));
  } catch {
    // .data/ may not exist in a fresh checkout — the console output is the record.
  }
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
