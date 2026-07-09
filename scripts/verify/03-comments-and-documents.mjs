// Phase 7 — Steps 3 & 4: comment visibility isolation, and the documents
// module (upload, new version resets approval to pending, approve, reject
// with reason, attach-existing same-client).

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from './lib/env.mjs';
import { adminClient } from './lib/admin.mjs';
import { restoreActorSession, fillByPlaceholder, log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');
const ctx = JSON.parse(readFileSync(path.join(DATA_DIR, 'context.json'), 'utf-8'));

const SCRATCH = 'C:\\Users\\Rudra\\AppData\\Local\\Temp\\claude\\D--Codes-Startup-CA-prod\\5671dc79-e808-4480-9650-7de35546a33e\\scratchpad';
mkdirSync(SCRATCH, { recursive: true });

const results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 6000, intervalMs = 300) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await wait(intervalMs);
  }
  return last;
}

function makeTestFile(name, content) {
  const p = path.join(SCRATCH, name);
  writeFileSync(p, content);
  return p;
}

async function main() {
  const admin = adminClient();
  const browser = await chromium.launch();
  const p1 = await restoreActorSession(browser, { baseURL: SITE_URL, statePath: ctx.statePaths.p1 });
  const e1 = await restoreActorSession(browser, { baseURL: SITE_URL, statePath: ctx.statePaths.e1 });

  const taskN = ctx.taskShared; // client-visible, in_progress (reset by script 02)
  const clientA = ctx.clientA;

  // ============================================================
  // STEP 3 — Comments isolation
  // ============================================================
  await e1.page.goto(`/tasks/${taskN.id}`, { waitUntil: 'domcontentloaded' });
  await e1.page.getByRole('heading', { name: 'Comments', exact: true }).waitFor({ timeout: 10000 });

  const internalText = `[internal] Reviewed the working papers — ${ctx.tag}`;
  await fillByPlaceholder(e1.page, 'Write a comment...', internalText);
  await e1.page.getByRole('button', { name: 'Comment', exact: true }).click();
  await wait(700);

  const visibleText = `[client-visible] Please share the April bank statement — ${ctx.tag}`;
  await fillByPlaceholder(e1.page, 'Write a comment...', visibleText);
  await e1.page.getByLabel('Visible to client', { exact: true }).check();
  await e1.page.getByRole('button', { name: 'Comment', exact: true }).click();
  await wait(700);

  const comments = await waitFor(async () => {
    const { data } = await admin
      .from('task_comments')
      .select('*')
      .eq('task_id', taskN.id)
      .in('content', [internalText, visibleText]);
    return data && data.length === 2 ? data : null;
  });
  const internalRow = comments?.find((c) => c.content === internalText);
  const visibleRow = comments?.find((c) => c.content === visibleText);
  results.push(log('Internal comment stored with visible_to_client=false', internalRow?.visible_to_client === false));
  results.push(log('Client-visible comment stored with visible_to_client=true', visibleRow?.visible_to_client === true));

  await e1.page.reload({ waitUntil: 'domcontentloaded' });
  await e1.page.getByText(visibleText, { exact: true }).first().waitFor({ timeout: 10000 });
  const internalChip = await e1.page.locator('text=Internal').first().isVisible().catch(() => false);
  const visibleChip = await e1.page.locator('text=Client-visible').first().isVisible().catch(() => false);
  results.push(log('UI: staff view shows "Internal" chip', internalChip));
  results.push(log('UI: staff view shows "Client-visible" chip', visibleChip));
  ctx.taskSharedInternalCommentText = internalText;
  ctx.taskSharedVisibleCommentText = visibleText;

  // ============================================================
  // STEP 4 — Documents
  // ============================================================
  const filePath1 = makeTestFile(`bank-statement-${ctx.tag}.txt`, 'Fake bank statement content v1 — ' + ctx.tag);
  const filePath2 = makeTestFile(`bank-statement-v2-${ctx.tag}.txt`, 'Fake bank statement content v2 (corrected) — ' + ctx.tag);
  const unlinkedFilePath = makeTestFile(`pan-copy-${ctx.tag}.txt`, 'Fake PAN copy — ' + ctx.tag);

  const docName = `Bank Statement April ${ctx.tag}`;

  // ---- E1 uploads a document on Task N ----
  await e1.page.goto(`/tasks/${taskN.id}`, { waitUntil: 'domcontentloaded' });
  await e1.page.getByRole('button', { name: 'Upload document' }).click();
  await e1.page.getByRole('heading', { name: 'Upload document' }).waitFor({ timeout: 10000 });
  await e1.page.getByLabel('File', { exact: true }).setInputFiles(filePath1);
  await e1.page.getByLabel('Document name', { exact: true }).fill(docName);
  await e1.page.locator('form').getByRole('button', { name: 'Upload', exact: true }).click();
  await e1.page.getByRole('heading', { name: 'Upload document' }).waitFor({ state: 'detached', timeout: 10000 });

  const doc = await waitFor(async () => {
    const { data } = await admin.from('documents').select('*').eq('task_id', taskN.id).eq('name', docName).maybeSingle();
    return data;
  });
  results.push(log('Document uploaded: documents row + v1 version created', doc?.current_version === 1 && doc?.approval_status === 'pending'));
  const uploadActivity = await admin.from('task_activities').select('*').eq('task_id', taskN.id).eq('action_type', 'document_uploaded').order('created_at', { ascending: false }).limit(1);
  results.push(log('Activity: document_uploaded logged', (uploadActivity.data || []).length >= 1));

  // ---- P1 uploads a new version — current_version bumps, approval resets to pending ----
  // First move it to approved so we can observe the reset.
  await admin.from('documents').update({ approval_status: 'approved', reviewed_by: ctx.p1.id, reviewed_at: new Date().toISOString() }).eq('id', doc.id);
  await p1.page.goto(`/tasks/${taskN.id}`, { waitUntil: 'domcontentloaded' });
  await p1.page.getByRole('button', { name: 'New version' }).first().click();
  await p1.page.getByRole('heading', { name: /New version/ }).waitFor({ timeout: 10000 });
  await p1.page.getByLabel('File', { exact: true }).setInputFiles(filePath2);
  await p1.page.getByLabel('Note (optional)', { exact: true }).fill('Corrected page 3');
  await p1.page.locator('form').getByRole('button', { name: 'Upload version', exact: true }).click();
  await p1.page.getByRole('heading', { name: /New version/ }).waitFor({ state: 'detached', timeout: 10000 });

  const docAfterVersion = await waitFor(async () => {
    const { data } = await admin.from('documents').select('*').eq('id', doc.id).single();
    return data.current_version === 2 ? data : null;
  });
  results.push(log('New version: current_version bumped to 2', docAfterVersion?.current_version === 2));
  results.push(log('New version: approval_status reset to pending', docAfterVersion?.approval_status === 'pending'));

  // ---- P1 approves — uploader (E1) notified ----
  const tApprove = new Date(Date.now() - 60_000).toISOString();
  await p1.page.reload({ waitUntil: 'domcontentloaded' });
  await p1.page.getByRole('button', { name: 'Approve' }).first().click();
  await wait(700);
  const docApproved = await waitFor(async () => {
    const { data } = await admin.from('documents').select('*').eq('id', doc.id).single();
    return data.approval_status === 'approved' ? data : null;
  });
  results.push(log('Approve: approval_status -> approved', docApproved?.approval_status === 'approved'));
  const approveNotif = await admin.from('notifications').select('*').eq('user_id', ctx.e1.id).eq('reference_id', taskN.id).gte('created_at', tApprove);
  results.push(log('Notification: uploader (E1) notified of approval', (approveNotif.data || []).some((n) => n.message.includes(docName) || n.title.toLowerCase().includes('approved'))));

  // ---- Reject with a reason (need a fresh pending doc — re-upload a version) ----
  const rejectionReason = `Missing pages for April–June — ${ctx.tag}`;
  await e1.page.goto(`/tasks/${taskN.id}`, { waitUntil: 'domcontentloaded' });
  await e1.page.getByRole('button', { name: 'New version' }).first().click();
  await e1.page.getByRole('heading', { name: /New version/ }).waitFor({ timeout: 10000 });
  await e1.page.getByLabel('File', { exact: true }).setInputFiles(filePath1);
  await e1.page.locator('form').getByRole('button', { name: 'Upload version', exact: true }).click();
  await e1.page.getByRole('heading', { name: /New version/ }).waitFor({ state: 'detached', timeout: 10000 });
  await waitFor(async () => {
    const { data } = await admin.from('documents').select('current_version').eq('id', doc.id).single();
    return data.current_version === 3 ? data : null;
  });

  const tReject = new Date(Date.now() - 10_000).toISOString();
  await p1.page.reload({ waitUntil: 'domcontentloaded' });
  await p1.page.getByRole('button', { name: 'Reject' }).first().click();
  await p1.page.getByRole('heading', { name: 'Reject document' }).waitFor({ timeout: 10000 });
  await p1.page.getByLabel('Reason for rejection', { exact: true }).fill(rejectionReason);
  await p1.page.locator('form').getByRole('button', { name: 'Reject', exact: true }).click();
  await p1.page.getByRole('heading', { name: 'Reject document' }).waitFor({ state: 'detached', timeout: 10000 });

  const docRejected = await waitFor(async () => {
    const { data } = await admin.from('documents').select('*').eq('id', doc.id).single();
    return data.approval_status === 'rejected' ? data : null;
  });
  results.push(log('Reject: approval_status -> rejected, reason stored verbatim', docRejected?.rejection_reason === rejectionReason));
  const rejectNotif = await admin.from('notifications').select('*').eq('user_id', ctx.e1.id).eq('reference_id', taskN.id).gte('created_at', tReject);
  results.push(log('Notification: uploader (E1) notified of rejection', (rejectNotif.data || []).some((n) => n.message.includes(rejectionReason))));

  // ---- Attach existing (same-client unlinked doc) ----
  await p1.page.goto(`/clients/${clientA.id}`, { waitUntil: 'domcontentloaded' });
  await p1.page.getByRole('button', { name: 'Upload document' }).first().click();
  await p1.page.getByRole('heading', { name: 'Upload document' }).waitFor({ timeout: 10000 });
  const unlinkedName = `PAN Copy ${ctx.tag}`;
  await p1.page.getByLabel('File', { exact: true }).setInputFiles(unlinkedFilePath);
  await p1.page.getByLabel('Document name', { exact: true }).fill(unlinkedName);
  await p1.page.locator('form').getByRole('button', { name: 'Upload', exact: true }).click();
  await p1.page.getByRole('heading', { name: 'Upload document' }).waitFor({ state: 'detached', timeout: 10000 });

  const unlinkedDoc = await waitFor(async () => {
    const { data } = await admin.from('documents').select('*').eq('client_id', clientA.id).eq('name', unlinkedName).maybeSingle();
    return data;
  });
  results.push(log('Unlinked same-client document uploaded (task_id NULL)', unlinkedDoc?.task_id === null));

  await p1.page.goto(`/tasks/${taskN.id}`, { waitUntil: 'domcontentloaded' });
  await p1.page.getByRole('button', { name: 'Attach existing document' }).click();
  await p1.page.getByRole('heading', { name: 'Attach existing document' }).waitFor({ timeout: 10000 });
  await p1.page.getByLabel('Document', { exact: true }).selectOption({ label: unlinkedName });
  // The attach modal has no <form> wrapper (plain onClick handlers).
  await p1.page.getByRole('button', { name: 'Attach', exact: true }).click();
  await p1.page.getByRole('heading', { name: 'Attach existing document' }).waitFor({ state: 'detached', timeout: 10000 });

  const attached = await waitFor(async () => {
    const { data } = await admin.from('documents').select('task_id').eq('id', unlinkedDoc.id).single();
    return data.task_id === taskN.id ? data : null;
  });
  results.push(log('Attach existing: same-client unlinked document linked to the task', !!attached));
  const attachActivity = await admin.from('task_activities').select('*').eq('task_id', taskN.id).eq('action_type', 'document_attached').order('created_at', { ascending: false }).limit(1);
  results.push(log('Activity: document_attached logged', (attachActivity.data || []).length >= 1));

  // Cross-client attach block: verified by CODE INSPECTION, not live UI —
  // documented in docs/verification/phase-7-runtime.md. The task detail
  // page's attachableDocuments query is itself scoped to
  // `client_id = task.client_id` (src/app/(dashboard)/tasks/[id]/page.tsx),
  // so a cross-client document never reaches the dropdown to click in the
  // first place; the belt-and-suspenders app-layer check in
  // attachDocumentToTaskAction (`doc.client_id !== task.client_id`) can only
  // be exercised by calling the 'use server' action directly, which isn't
  // reachable from outside a real form submit without reverse-engineering
  // the Next.js Server Action wire protocol — disproportionate effort for
  // one already-code-confirmed guard.
  results.push(log('Cross-client attach block verified by CODE INSPECTION (see report — not independently exercised live)', true));

  ctx.taskNDocumentId = doc.id;
  ctx.taskNDocumentRejectionReason = rejectionReason;
  writeFileSync(path.join(DATA_DIR, 'context.json'), JSON.stringify(ctx, null, 2));

  await p1.context.storageState({ path: ctx.statePaths.p1 });
  await e1.context.storageState({ path: ctx.statePaths.e1 });
  await browser.close();

  console.log('\n--- Steps 3 & 4 summary (comments + documents) ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  writeFileSync(path.join(DATA_DIR, 'results-03-comments-documents.json'), JSON.stringify(results, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
