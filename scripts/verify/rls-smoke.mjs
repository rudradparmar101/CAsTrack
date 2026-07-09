// Phase 7 — Step 7: RLS smoke test. Direct PostgREST calls (anon key,
// signed in as each role) against the LIVE policies — no service role, no
// UI — proving the database itself enforces isolation, not just hidden
// buttons. Named rls-smoke per the roadmap checklist; .mjs (not .ts) to
// match every other script in this directory — there's no TS runner
// (tsx/ts-node) configured in this project.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signInAs } from './lib/admin.mjs';
import { log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');
const ctx = JSON.parse(readFileSync(path.join(DATA_DIR, 'context.json'), 'utf-8'));

const results = [];

async function main() {
  const { client: e1 } = await signInAs(ctx.e1.email, ctx.password);
  const { client: e2 } = await signInAs(ctx.e2.email, ctx.password);
  const { client: clientA } = await signInAs(ctx.clientAUser.email, ctx.clientAUser.password);

  // ============================================================
  // E1 (employee, GST department, assigned to Task M/N/R) — sees
  // (assigned to them) UNION (their department), nothing else.
  // ============================================================
  {
    const { data: e1Tasks } = await e1.from('tasks').select('id, department_id, assigned_to').eq('firm_id', ctx.firmId);
    const ids = new Set((e1Tasks || []).map((t) => t.id));
    const allInScope = (e1Tasks || []).every(
      (t) => t.assigned_to === ctx.e1.id || t.department_id === ctx.gstDeptId
    );
    results.push(log('E1: every visible task is assigned-to-them OR in their GST department', allInScope));
    results.push(log('E1: does NOT see the other-department, unassigned, client-B task', !ids.has(ctx.taskOtherDept.id)));
  }

  {
    const { data: otherDeptRow, error: selErr } = await e1
      .from('tasks')
      .select('id')
      .eq('id', ctx.taskOtherDept.id)
      .maybeSingle();
    results.push(log('E1: direct SELECT of the other-dept client-B task returns empty', !otherDeptRow, selErr?.message || ''));

    const { data: updData, error: updErr } = await e1
      .from('tasks')
      .update({ priority: 'urgent' })
      .eq('id', ctx.taskOtherDept.id)
      .select();
    results.push(log('E1: UPDATE on the other-dept client-B task affects zero rows', !updErr && (updData || []).length === 0, updErr?.message || `rows: ${updData?.length}`));
  }

  // ============================================================
  // E2 (employee, no department, clients.view explicitly REVOKED via
  // user_permissions override) — clients.view is an employee DEFAULT, but
  // the override must win: SELECT clients must come back empty.
  // ============================================================
  {
    const { data: e2Clients, error } = await e2.from('clients').select('id').eq('firm_id', ctx.firmId);
    results.push(log('E2: clients SELECT is EMPTY despite employee default (revoked override wins)', (e2Clients || []).length === 0, error?.message || `rows: ${e2Clients?.length}`));
  }

  // ============================================================
  // client_user (client A) — structural isolation. Task N carries one
  // internal + one client-visible comment (03-comments-and-documents.mjs).
  // ============================================================
  {
    const { data: comments } = await clientA
      .from('task_comments')
      .select('content, visible_to_client')
      .eq('task_id', ctx.taskShared.id);
    const hasInternal = (comments || []).some((c) => c.content === ctx.taskSharedInternalCommentText);
    const hasVisible = (comments || []).some((c) => c.content === ctx.taskSharedVisibleCommentText);
    results.push(log('client-A: cannot SELECT the internal comment on a visible task', !hasInternal));
    results.push(log('client-A: CAN SELECT the client-visible comment on the same task', hasVisible));
  }

  {
    const { data: bTasks } = await clientA.from('tasks').select('id').eq('client_id', ctx.clientB.id);
    results.push(log('client-A: cannot see ANY client-B task', (bTasks || []).length === 0, `rows: ${bTasks?.length}`));

    const { data: bDocs } = await clientA.from('documents').select('id').eq('client_id', ctx.clientB.id);
    results.push(log('client-A: cannot see ANY client-B document', (bDocs || []).length === 0, `rows: ${bDocs?.length}`));
  }

  {
    const { data: updData, error: updErr } = await clientA
      .from('tasks')
      .update({ priority: 'urgent' })
      .eq('id', ctx.taskShared.id)
      .select();
    results.push(log('client-A: UPDATE on their own visible task affects zero rows (no UPDATE path)', !updErr && (updData || []).length === 0, updErr?.message || `rows: ${updData?.length}`));
  }

  {
    const { error: notifErr } = await clientA.from('notifications').insert({
      firm_id: ctx.firmId,
      user_id: ctx.clientAUser.id,
      type: 'comment_added',
      title: 'Self-forged notification',
      message: 'RLS smoke test — should be rejected',
    });
    results.push(log('client-A: direct INSERT into notifications is REJECTED (staff/RPC-only)', !!notifErr, notifErr?.message || 'no error — INSERT SUCCEEDED (bug)'));
  }

  {
    const { error: hiddenErr } = await clientA.from('task_comments').insert({
      firm_id: ctx.firmId,
      task_id: ctx.taskShared.id,
      content: 'RLS smoke test — attempted hidden comment',
      visible_to_client: false,
      created_by: ctx.clientAUser.id,
    });
    results.push(log('client-A: INSERT with visible_to_client=false is REJECTED (forced-visible WITH CHECK)', !!hiddenErr, hiddenErr?.message || 'no error — INSERT SUCCEEDED (bug)'));
  }

  // ============================================================
  // task_stage_history — staff-only read (no client_user policy at all).
  // ============================================================
  {
    const { data: staffHistory } = await e1.from('task_stage_history').select('id').eq('task_id', ctx.taskShared.id);
    results.push(log('E1 (staff): CAN read task_stage_history for an accessible task', (staffHistory || []).length > 0, `rows: ${staffHistory?.length}`));

    const { data: clientHistory } = await clientA.from('task_stage_history').select('id').eq('task_id', ctx.taskShared.id);
    results.push(log('client-A: task_stage_history SELECT is EMPTY (no client policy at all)', (clientHistory || []).length === 0, `rows: ${clientHistory?.length}`));
  }

  console.log('\n--- Step 7 summary (RLS smoke) ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed.`);

  writeFileSync(path.join(DATA_DIR, 'results-rls-smoke.json'), JSON.stringify(results, null, 2));
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
