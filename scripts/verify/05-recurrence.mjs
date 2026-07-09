// Phase 7 — Step 6: recurrence spawn. Completing a monthly recurring task
// (no reviewer, so E1 can go straight in_progress -> completed) must spawn
// the next occurrence: due/statutory dates shifted by the rule, period_label
// cleared (differs each cycle — staff relabel), parent_task_id set, and a
// recurring_generated activity logged on the NEW task.

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from './lib/env.mjs';
import { adminClient } from './lib/admin.mjs';
import { restoreActorSession, log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');
const ctx = JSON.parse(readFileSync(path.join(DATA_DIR, 'context.json'), 'utf-8'));

const results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickTransition(page, label) {
  await page.getByRole('button', { name: label, exact: false }).first().click();
  await wait(600);
}

async function waitForStage(admin, taskId, expectedStage, timeoutMs = 5000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    const { data } = await admin.from('tasks').select('stage').eq('id', taskId).single();
    last = data;
    if (last.stage === expectedStage) return last;
    await wait(300);
  }
  return last;
}

async function waitForCond(fn, timeoutMs = 8000, intervalMs = 300) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await wait(intervalMs);
  }
  return last;
}

function addMonthsISO(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

async function main() {
  const admin = adminClient();
  const browser = await chromium.launch();
  const e1 = await restoreActorSession(browser, { baseURL: SITE_URL, statePath: ctx.statePaths.e1 });

  const task = ctx.taskRecurring;
  const { data: before } = await admin.from('tasks').select('*').eq('id', task.id).single();
  results.push(log('Task R starts at stage=assigned, recurring_rule=monthly', before.stage === 'assigned' && before.recurring_rule === 'monthly'));

  const expectedNextDue = addMonthsISO(before.due_date, 1);
  const expectedNextStatutory = before.statutory_due_date ? addMonthsISO(before.statutory_due_date, 1) : null;

  await e1.page.goto(`/tasks/${task.id}`, { waitUntil: 'domcontentloaded' });
  await e1.page.getByRole('heading', { name: 'Stage' }).waitFor({ timeout: 10000 });

  // assigned -> in_progress
  await clickTransition(e1.page, 'Start work');
  let s = await waitForStage(admin, task.id, 'in_progress');
  results.push(log('Task R: assigned -> in_progress (Start work)', s.stage === 'in_progress'));

  // in_progress -> completed (no reviewer, so "Mark completed" is available directly)
  await e1.page.reload({ waitUntil: 'domcontentloaded' });
  await e1.page.getByRole('heading', { name: 'Stage' }).waitFor({ timeout: 10000 });
  await clickTransition(e1.page, 'Mark completed');
  s = await waitForStage(admin, task.id, 'completed');
  results.push(log('Task R: in_progress -> completed (Mark completed)', s.stage === 'completed'));

  const nextTask = await waitForCond(async () => {
    const { data } = await admin.from('tasks').select('*').eq('parent_task_id', task.id).maybeSingle();
    return data;
  });

  results.push(log('Recurrence: next occurrence spawned (parent_task_id set)', !!nextTask));
  results.push(log('Recurrence: due_date shifted by the rule (+1 month)', nextTask?.due_date === expectedNextDue, `got ${nextTask?.due_date}, expected ${expectedNextDue}`));
  results.push(log('Recurrence: statutory_due_date shifted consistently', nextTask?.statutory_due_date === expectedNextStatutory, `got ${nextTask?.statutory_due_date}, expected ${expectedNextStatutory}`));
  results.push(log('Recurrence: period_label cleared on the new occurrence', nextTask?.period_label === null));
  results.push(log('Recurrence: recurring_rule carried over', nextTask?.recurring_rule === before.recurring_rule));
  results.push(log('Recurrence: assignee/reviewer/visibility carried over', nextTask?.assigned_to === before.assigned_to && nextTask?.reviewer_id === before.reviewer_id && nextTask?.visible_to_client === before.visible_to_client));
  results.push(log('Recurrence: new occurrence starts at stage created->assigned (assignee set)', nextTask?.stage === 'assigned'));

  const activity = await waitForCond(async () => {
    const { data } = await admin.from('task_activities').select('*').eq('task_id', nextTask.id).eq('action_type', 'recurring_generated');
    return (data || []).length >= 1 ? data : null;
  });
  results.push(log('Recurrence: recurring_generated activity logged on the new task', (activity || []).length >= 1));
  results.push(log('Recurrence: activity actor is the completing user (E1)', activity?.[0]?.actor_id === ctx.e1.id));

  ctx.taskRecurringSpawnedId = nextTask?.id ?? null;
  writeFileSync(path.join(DATA_DIR, 'context.json'), JSON.stringify(ctx, null, 2));

  await browser.close();

  console.log('\n--- Step 6 summary (recurrence spawn) ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed.`);

  writeFileSync(path.join(DATA_DIR, 'results-05-recurrence.json'), JSON.stringify(results, null, 2));
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
