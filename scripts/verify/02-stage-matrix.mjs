// Phase 7 — Step 2: full stage-transition matrix, reviewer rule, illegal
// transition (UI + direct PostgREST), partner force, and per-transition
// history/activity/notification verification.

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from './lib/env.mjs';
import { adminClient, signInAs } from './lib/admin.mjs';
import { restoreActorSession, log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');
const ctx = JSON.parse(readFileSync(path.join(DATA_DIR, 'context.json'), 'utf-8'));

const results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Buffered "now" for notification since-filters: absorbs local-machine vs.
// Supabase-server clock skew (observed causing a false-negative "notification
// missing" when timestamps were compared without slack).
const bufferedNowIso = () => new Date(Date.now() - 10_000).toISOString();

async function clickTransition(page, label) {
  await page.getByRole('button', { name: label, exact: false }).first().click();
  await wait(600); // let the server action settle client-side
}

async function stageOf(admin, taskId) {
  const { data } = await admin.from('tasks').select('stage, reviewer_id, assigned_to').eq('id', taskId).single();
  return data;
}

// The admin (service-role) PostgREST connection can lag a beat behind the
// app's own connection under the Supabase pooler (observed in step 1 too) —
// poll instead of trusting a single fixed-delay read.
async function waitForStage(admin, taskId, expectedStage, timeoutMs = 5000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await stageOf(admin, taskId);
    if (last.stage === expectedStage) return last;
    await wait(300);
  }
  return last;
}

async function historyRows(admin, taskId) {
  const { data } = await admin
    .from('task_stage_history')
    .select('from_stage, to_stage, note, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  return data || [];
}

async function activityRows(admin, taskId, action) {
  const { data } = await admin
    .from('task_activities')
    .select('*')
    .eq('task_id', taskId)
    .eq('action_type', action)
    .order('created_at', { ascending: false });
  return data || [];
}

async function notificationsFor(admin, userId, type, sinceIso) {
  const { data } = await admin
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .eq('type', type)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false });
  return data || [];
}

async function main() {
  const admin = adminClient();
  const browser = await chromium.launch();
  const p1 = await restoreActorSession(browser, { baseURL: SITE_URL, statePath: ctx.statePaths.p1 });
  const e1 = await restoreActorSession(browser, { baseURL: SITE_URL, statePath: ctx.statePaths.e1 });

  const taskM = ctx.taskMatrixWithReviewer; // reviewer = P1
  const taskN = ctx.taskShared; // no reviewer

  // ============================================================
  // TASK M — full arrow walk with a reviewer set
  // ============================================================
  let t0 = bufferedNowIso();
  await e1.page.goto(`/tasks/${taskM.id}`, { waitUntil: 'domcontentloaded' });
  let s = await stageOf(admin, taskM.id);
  results.push(log('Task M auto-advanced created->assigned on creation (assignee set)', s.stage === 'assigned'));
  let hist = await historyRows(admin, taskM.id);
  results.push(log('Task M: history row for created->assigned exists', hist.some((h) => h.from_stage === null && h.to_stage === 'assigned')));

  // assigned -> in_progress ("Start work")
  await clickTransition(e1.page, 'Start work');
  s = await waitForStage(admin, taskM.id, 'in_progress');
  results.push(log('Task M: assigned -> in_progress (Start work)', s.stage === 'in_progress'));

  // Reviewer rule: "Mark completed" must be ABSENT while reviewer is set.
  await e1.page.reload({ waitUntil: 'domcontentloaded' });
  await e1.page.getByRole('heading', { name: 'Stage' }).waitFor({ timeout: 10000 });
  const markCompletedVisible = await e1.page.getByRole('button', { name: 'Mark completed' }).count();
  results.push(log('Task M: "Mark completed" button HIDDEN while reviewer is set', markCompletedVisible === 0));

  // in_progress -> waiting_client ("Waiting on client")
  t0 = bufferedNowIso();
  await clickTransition(e1.page, 'Waiting on client');
  s = await waitForStage(admin, taskM.id, 'waiting_client');
  results.push(log('Task M: in_progress -> waiting_client', s.stage === 'waiting_client'));
  const waitingNotifs = await admin.from('notifications').select('*').eq('reference_id', taskM.id).gte('created_at', t0);
  results.push(log('Task M: waiting_client transition creates NO notification (intentional)', (waitingNotifs.data || []).length === 0, `${(waitingNotifs.data || []).length} found`));

  // waiting_client -> in_progress ("Resume work") — the ⇄ arm
  await e1.page.reload({ waitUntil: 'domcontentloaded' });
  await clickTransition(e1.page, 'Resume work');
  s = await waitForStage(admin, taskM.id, 'in_progress');
  results.push(log('Task M: waiting_client -> in_progress (Resume work)', s.stage === 'in_progress'));

  // in_progress -> under_review ("Submit for review")
  t0 = bufferedNowIso();
  await e1.page.reload({ waitUntil: 'domcontentloaded' });
  await clickTransition(e1.page, 'Submit for review');
  s = await waitForStage(admin, taskM.id, 'under_review');
  results.push(log('Task M: in_progress -> under_review (Submit for review)', s.stage === 'under_review'));
  await wait(500);
  let approvalReq = await notificationsFor(admin, ctx.p1.id, 'approval_requested', t0);
  results.push(log('Notification: reviewer (P1) gets approval_requested', approvalReq.length >= 1));

  // under_review -> in_progress ("Send back", with a note) — as the reviewer (P1)
  t0 = bufferedNowIso();
  await p1.page.goto(`/tasks/${taskM.id}`, { waitUntil: 'domcontentloaded' });
  await p1.page.locator('textarea[placeholder*="Optional note"]').fill('Please redo section 3 — figures do not tie out.');
  await clickTransition(p1.page, 'Send back');
  s = await waitForStage(admin, taskM.id, 'in_progress');
  results.push(log('Task M: under_review -> in_progress (Send back, by reviewer)', s.stage === 'in_progress'));
  hist = await historyRows(admin, taskM.id);
  results.push(log('Task M: history row for under_review->in_progress exists', hist.some((h) => h.from_stage === 'under_review' && h.to_stage === 'in_progress')));
  const sendBackActivity = await activityRows(admin, taskM.id, 'stage_changed');
  const sendBackWithNote = sendBackActivity.find((a) => a.new_value?.note?.includes('redo section 3'));
  results.push(log('Activity: stage_changed carries the send-back note', !!sendBackWithNote));
  await wait(500);
  let rejectedNotifs = await notificationsFor(admin, ctx.e1.id, 'task_rejected', t0);
  results.push(log('Notification: assignee (E1) gets task_rejected carrying the note', rejectedNotifs.length >= 1 && rejectedNotifs[0].message.includes('redo section 3')));

  // Resubmit: in_progress -> under_review again (E1)
  await e1.page.reload({ waitUntil: 'domcontentloaded' });
  await clickTransition(e1.page, 'Submit for review');
  s = await waitForStage(admin, taskM.id, 'under_review');
  results.push(log('Task M: resubmitted in_progress -> under_review', s.stage === 'under_review'));

  // under_review -> completed ("Approve & complete") — by reviewer P1
  t0 = bufferedNowIso();
  await p1.page.reload({ waitUntil: 'domcontentloaded' });
  await clickTransition(p1.page, 'Approve & complete');
  s = await waitForStage(admin, taskM.id, 'completed');
  results.push(log('Task M: under_review -> completed (Approve & complete)', s.stage === 'completed'));
  await wait(500);
  let approvedNotifs = await notificationsFor(admin, ctx.e1.id, 'task_approved', t0);
  results.push(log('Notification: assignee (E1) gets task_approved (approval came via review)', approvedNotifs.length >= 1));
  // task_completed -> creator, but creator === actor here (P1 completed their
  // own-created task), so notifyUsers' excludeUserId correctly suppresses it.
  let completedNotifsToSelf = await notificationsFor(admin, ctx.p1.id, 'task_completed', t0);
  results.push(log('Notification: task_completed to creator correctly suppressed (actor === creator)', completedNotifsToSelf.length === 0));

  // Partner force: completed -> in_progress via the override select.
  await p1.page.reload({ waitUntil: 'domcontentloaded' });
  await p1.page.getByRole('button', { name: 'Partner override' }).click();
  // The force-select has no <label> (task-stage-panel.tsx renders it bare) —
  // locate it structurally via its placeholder option text instead.
  const forceSelect = p1.page.locator('select').filter({ has: p1.page.locator('option', { hasText: 'Force stage to...' }) });
  await forceSelect.selectOption({ label: 'In Progress' });
  await p1.page.getByRole('button', { name: 'Force' }).click();
  s = await waitForStage(admin, taskM.id, 'in_progress');
  results.push(log('Task M: PARTNER FORCE completed -> in_progress succeeds', s.stage === 'in_progress'));

  // ============================================================
  // ILLEGAL TRANSITION — waiting_client -> completed as an employee
  // Deterministic "stale UI" setup: create a throwaway task already at
  // waiting_client, load it as E1 (buttons correctly show only "Resume
  // work"), then directly flip it to a DIFFERENT of-the-moment state isn't
  // needed here — we instead prove the friendly-rejection path by editing
  // the DOM-less approach: call the illegal transition on TASK M (now
  // in_progress, no note) after externally forcing it to waiting_client,
  // while E1's already-rendered in_progress page (with a stale button set)
  // is still open.
  // ============================================================
  await e1.page.reload({ waitUntil: 'domcontentloaded' }); // fresh render at in_progress, hasReviewer=true
  // Externally (service role) move it to waiting_client without E1's page reloading.
  await admin.from('tasks').update({ stage: 'waiting_client' }).eq('id', taskM.id);
  s = await stageOf(admin, taskM.id);
  results.push(log('Setup: Task M force-moved to waiting_client behind E1\'s stale page', s.stage === 'waiting_client'));

  // E1's stale page still renders in_progress's buttons: "Waiting on
  // client", "Submit for review", NOT "Mark completed" (reviewer set) — so
  // to reach a genuinely illegal click we need a stale button whose target
  // is invalid from the NEW current stage. "Submit for review" (->
  // under_review) is not a legal move from waiting_client either
  // (waiting_client's only legal arrow is -> in_progress), so it serves the
  // "illegal transition attempted through the UI" case perfectly.
  await clickTransition(e1.page, 'Submit for review');
  const rejectionBanner = await e1.page.locator('text=/not allowed/i').first().textContent().catch(() => null);
  results.push(log('UI: illegal transition (stale click) shows friendly rejection message', !!rejectionBanner, rejectionBanner || ''));
  s = await stageOf(admin, taskM.id);
  results.push(log('DB: illegal transition did NOT change the stage (still waiting_client)', s.stage === 'waiting_client'));

  // Direct authenticated PostgREST retry as E1 — confirms the DB TRIGGER
  // (not just the app-layer check / hidden buttons) is the real enforcer.
  const { client: e1Rest } = await signInAs(ctx.e1.email, ctx.password);
  const { error: restErr1 } = await e1Rest
    .from('tasks')
    .update({ stage: 'completed' })
    .eq('id', taskM.id)
    .eq('stage', 'waiting_client');
  results.push(log('PostgREST: waiting_client -> completed as E1 rejected by DB trigger', !!restErr1, restErr1?.message || 'NO ERROR — WOULD BE A BUG'));
  s = await stageOf(admin, taskM.id);
  results.push(log('DB: stage still waiting_client after the raw PostgREST attempt', s.stage === 'waiting_client'));

  // Same direct-PostgREST proof for the reviewer-blocks-completion rule:
  // in_progress -> completed while reviewer_id is set, as the assignee E1.
  await admin.from('tasks').update({ stage: 'in_progress' }).eq('id', taskM.id);
  const { error: restErr2 } = await e1Rest
    .from('tasks')
    .update({ stage: 'completed' })
    .eq('id', taskM.id)
    .eq('stage', 'in_progress');
  results.push(log('PostgREST: in_progress -> completed as E1 REJECTED by DB trigger while reviewer_id is set', !!restErr2, restErr2?.message || 'NO ERROR — WOULD BE A BUG'));

  // ============================================================
  // TASK N — no reviewer: in_progress -> completed must SUCCEED naturally,
  // then completed -> archived (both via the real UI buttons).
  // ============================================================
  await e1.page.goto(`/tasks/${taskN.id}`, { waitUntil: 'domcontentloaded' });
  s = await stageOf(admin, taskN.id);
  results.push(log('Task N auto-advanced created->assigned on creation', s.stage === 'assigned'));
  await clickTransition(e1.page, 'Start work');
  s = await waitForStage(admin, taskN.id, 'in_progress');
  results.push(log('Task N: assigned -> in_progress', s.stage === 'in_progress'));

  await e1.page.reload({ waitUntil: 'domcontentloaded' });
  await e1.page.getByRole('heading', { name: 'Stage' }).waitFor({ timeout: 10000 });
  const markCompletedVisibleN = await e1.page.getByRole('button', { name: 'Mark completed' }).count();
  results.push(log('Task N: "Mark completed" button VISIBLE (no reviewer)', markCompletedVisibleN >= 1));

  t0 = bufferedNowIso();
  await clickTransition(e1.page, 'Mark completed');
  s = await waitForStage(admin, taskN.id, 'completed');
  results.push(log('Task N: in_progress -> completed SUCCEEDS with reviewer NULL', s.stage === 'completed'));
  await wait(500);
  let completedNotifToCreator = await notificationsFor(admin, ctx.p1.id, 'task_completed', t0);
  results.push(log('Notification: creator (P1) gets task_completed', completedNotifToCreator.length >= 1));

  await e1.page.reload({ waitUntil: 'domcontentloaded' });
  await clickTransition(e1.page, 'Archive');
  s = await waitForStage(admin, taskN.id, 'archived');
  results.push(log('Task N: completed -> archived', s.stage === 'archived'));

  // Leave Task N usable for later steps (comments/documents/portal) — put it
  // back to in_progress via partner force so it's client-visible & active.
  await p1.page.goto(`/tasks/${taskN.id}`, { waitUntil: 'domcontentloaded' });
  await p1.page.getByRole('button', { name: 'Partner override' }).click();
  const forceSelectN = p1.page.locator('select').filter({ has: p1.page.locator('option', { hasText: 'Force stage to...' }) });
  await forceSelectN.selectOption({ label: 'In Progress' });
  await p1.page.getByRole('button', { name: 'Force' }).click();
  s = await waitForStage(admin, taskN.id, 'in_progress');
  results.push(log('Task N reset to in_progress (partner force) for later steps', s.stage === 'in_progress'));

  // ============================================================
  // UI notification-bell spot check (one, as requested)
  // ============================================================
  await e1.page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await e1.page.getByRole('button', { name: 'Notifications' }).click();
  await wait(400);
  const bellText = await e1.page.locator('text=Task sent back').first().isVisible().catch(() => false);
  results.push(log('UI bell spot-check: E1 sees "Task sent back" notification', bellText));

  // Persist any storageState drift.
  await p1.context.storageState({ path: ctx.statePaths.p1 });
  await e1.context.storageState({ path: ctx.statePaths.e1 });

  await browser.close();

  console.log('\n--- Step 2 summary (stage matrix) ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  writeFileSync(path.join(DATA_DIR, 'results-02-stage-matrix.json'), JSON.stringify(results, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
