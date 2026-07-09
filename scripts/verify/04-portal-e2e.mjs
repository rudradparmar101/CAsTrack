// Phase 7 — Step 5: client portal end-to-end (never runtime-tested before
// this phase) — accept-invite, curated task list, comment/document
// isolation, portal reply + upload, rejection-reason display, and staff
// stage changes reflecting in the portal on refresh.

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from './lib/env.mjs';
import { adminClient } from './lib/admin.mjs';
import { restoreActorSession, fillLabeled, fillByPlaceholder, log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');
const ctx = JSON.parse(readFileSync(path.join(DATA_DIR, 'context.json'), 'utf-8'));

const SCRATCH = 'C:\\Users\\Rudra\\AppData\\Local\\Temp\\claude\\D--Codes-Startup-CA-prod\\5671dc79-e808-4480-9650-7de35546a33e\\scratchpad';
mkdirSync(SCRATCH, { recursive: true });

const results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

function makeTestFile(name, content) {
  const p = path.join(SCRATCH, name);
  writeFileSync(p, content);
  return p;
}

async function main() {
  const admin = adminClient();
  const browser = await chromium.launch();

  // ============================================================
  // Accept invite in a CLEAN browser context (no prior session)
  // ============================================================
  const clientCtx = await browser.newContext({ baseURL: SITE_URL, viewport: { width: 1440, height: 1100 } });
  await clientCtx.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = `*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }`;
    (document.head || document.documentElement).appendChild(style);
  });
  const client = await clientCtx.newPage();

  await client.goto(ctx.clientAInviteUrl, { waitUntil: 'domcontentloaded' });
  const inviteHeading = await client.getByRole('heading', { name: "You're invited to the client portal" }).isVisible().catch(() => false);
  results.push(log('Console-captured invite link opens a valid invite page', inviteHeading));

  const PORTAL_PASSWORD = 'Ph7ClientPass123!';
  await fillLabeled(client, 'Password', PORTAL_PASSWORD);
  await client.getByRole('button', { name: 'Activate account' }).click();
  // Same class of issue documented for /onboarding in phase-7-runtime.md:
  // the server action's redirect() completes server-side (the profile row
  // lands) but the Next.js 16 dev client router sometimes doesn't follow a
  // 'use server' redirect triggered from a non-full-page-load interaction.
  // On the FIRST hit of this route in a fresh `next dev` process, Turbopack's
  // on-demand compile of /portal/accept-invite + /portal adds real latency on
  // top of that (observed: a 6s budget was not enough, pushing the fallback
  // goto('/portal') to fire WHILE the server action's sign-in was still
  // in-flight, racing it to a cookie-less /login bounce instead). A longer
  // initial budget plus a retried (not single-shot) fallback avoids the race.
  try {
    await client.waitForURL(/\/portal/, { timeout: 20000 });
  } catch {
    for (let i = 0; i < 3 && !client.url().endsWith('/portal'); i++) {
      await wait(1500);
      await client.goto('/portal', { waitUntil: 'load' }).catch(() => {});
    }
  }
  results.push(log('Accept-invite -> auto-confirmed login -> middleware lands on /portal', client.url().endsWith('/portal')));

  const clientUserProfile = await waitForCond(async () => {
    const { data } = await admin.from('profiles').select('id, role, client_id').eq('email', ctx.clientAUser.email).maybeSingle();
    return data;
  });
  results.push(log('client_user profile provisioned with role=client_user + client_id', clientUserProfile?.role === 'client_user' && clientUserProfile?.client_id === ctx.clientA.id));
  ctx.clientAUser.id = clientUserProfile.id;
  ctx.clientAUser.password = PORTAL_PASSWORD;

  // ============================================================
  // Portal home — curated task list
  // ============================================================
  // provisionClientFromInvite() defaults the display name to the email
  // prefix (the accept-invite form only collects a password — see
  // src/lib/provisioning.ts) so "Client Alpha Contact" (the fixture's human
  // label in context.json, never actually persisted anywhere) can never
  // appear on this page; assert the name the app actually renders instead.
  const expectedPortalName = ctx.clientAUser.email.split('@')[0];
  await client.getByText(`Welcome, ${expectedPortalName}`, { exact: false }).waitFor({ timeout: 10000 });
  const taskMTitleVisible = await client.getByText('GSTR-3B Filing', { exact: false }).first().isVisible().catch(() => false);
  const taskNTitleVisible = await client.getByText('TDS Return Q1', { exact: false }).first().isVisible().catch(() => false);
  const taskRTitleVisible = await client.getByText('Monthly Bookkeeping', { exact: false }).first().isVisible().catch(() => false);
  const taskDTitleVisible = await client.getByText('Income Tax Assessment', { exact: false }).first().isVisible().catch(() => false);
  results.push(log('Portal lists client-A visible tasks (M, N, R)', taskMTitleVisible && taskNTitleVisible && taskRTitleVisible));
  results.push(log('Portal does NOT list client-B / non-visible task (Income Tax Assessment)', !taskDTitleVisible));

  // ============================================================
  // Task N — comment isolation + rejection reason display
  // ============================================================
  await client.getByText('TDS Return Q1', { exact: false }).first().click();
  await client.waitForURL(/\/portal\/tasks\//, { timeout: 10000 });

  const bodyText1 = await client.locator('body').innerText();
  results.push(log("Portal task page does NOT show E1's internal comment", !bodyText1.includes(ctx.taskSharedInternalCommentText)));
  results.push(log('Portal task page DOES show the client-visible comment', bodyText1.includes(ctx.taskSharedVisibleCommentText)));
  const authorAsFirm = await client.getByText('Your CA firm', { exact: false }).first().isVisible().catch(() => false);
  results.push(log('Staff comment author renders as "Your CA firm" to the client', authorAsFirm));

  results.push(log('Rejection reason shown verbatim', bodyText1.includes(ctx.taskNDocumentRejectionReason)));
  const correctedFileBtn = await client.getByRole('button', { name: 'Upload a corrected file' }).isVisible().catch(() => false);
  results.push(log('"Upload a corrected file" button present on the rejected doc', correctedFileBtn));

  // ============================================================
  // Portal reply — lands on staff side with activity
  // ============================================================
  const replyText = `Sure, uploading the statement now — ${ctx.tag}`;
  await fillByPlaceholder(client, 'Write a message to your CA firm...', replyText);
  await client.getByRole('button', { name: 'Comment', exact: true }).click();
  await wait(800);

  const replyRow = await waitForCond(async () => {
    const { data } = await admin.from('task_comments').select('*').eq('task_id', ctx.taskShared.id).eq('content', replyText).maybeSingle();
    return data;
  });
  results.push(log('Portal reply lands in task_comments, forced visible_to_client=true, created_by=client user', replyRow?.visible_to_client === true && replyRow?.created_by === clientUserProfile.id));
  // addTaskCommentAction awaits the comment insert, then notifyUsers, then
  // logTaskActivity sequentially server-side — poll rather than one-shot,
  // since the comment row can land before that third step finishes.
  const replyActivity = await waitForCond(async () => {
    const { data } = await admin.from('task_activities').select('*').eq('task_id', ctx.taskShared.id).eq('actor_id', clientUserProfile.id).eq('action_type', 'comment_added');
    return (data || []).length >= 1 ? data : null;
  });
  results.push(log('Activity feed logs the client comment (actor = client user)', (replyActivity || []).length >= 1));

  // ============================================================
  // Portal upload — corrected file on the rejected document
  // ============================================================
  const correctedFilePath = makeTestFile(`corrected-bank-statement-${ctx.tag}.txt`, 'Corrected bank statement content — ' + ctx.tag);
  await client.getByRole('button', { name: 'Upload a corrected file' }).click();
  await client.getByRole('heading', { name: 'Upload a corrected file' }).waitFor({ timeout: 10000 });
  await client.getByLabel('File', { exact: true }).setInputFiles(correctedFilePath);
  await client.locator('form').getByRole('button', { name: 'Upload corrected file', exact: true }).click();
  await client.getByRole('heading', { name: 'Upload a corrected file' }).waitFor({ state: 'detached', timeout: 10000 });

  const docAfterCorrection = await waitForCond(async () => {
    const { data } = await admin.from('documents').select('*').eq('id', ctx.taskNDocumentId).single();
    return data.current_version === 4 ? data : null;
  });
  results.push(log('Portal correction: new version inserted (current_version -> 4)', docAfterCorrection?.current_version === 4));
  results.push(log('Portal correction: approval reset to pending', docAfterCorrection?.approval_status === 'pending'));

  // ============================================================
  // Portal proactive upload (task-less, from the portal home Documents section)
  // ============================================================
  const proactiveFilePath = makeTestFile(`proactive-upload-${ctx.tag}.txt`, 'Client proactive upload — ' + ctx.tag);
  const proactiveName = `Client Proactive Upload ${ctx.tag}`;
  await client.goto('/portal', { waitUntil: 'domcontentloaded' });
  await client.getByRole('button', { name: 'Upload document' }).click();
  await client.getByRole('heading', { name: 'Upload document' }).waitFor({ timeout: 10000 });
  await client.getByLabel('File', { exact: true }).setInputFiles(proactiveFilePath);
  await client.getByLabel('Document name', { exact: true }).fill(proactiveName);
  await client.locator('form').getByRole('button', { name: 'Upload', exact: true }).click();
  await client.getByRole('heading', { name: 'Upload document' }).waitFor({ state: 'detached', timeout: 10000 });

  const proactiveDoc = await waitForCond(async () => {
    const { data } = await admin.from('documents').select('*').eq('client_id', ctx.clientA.id).eq('name', proactiveName).maybeSingle();
    return data;
  });
  results.push(log('Portal proactive (task-less) upload: task_id NULL, uploaded_by=client, pending', proactiveDoc?.task_id === null && proactiveDoc?.uploaded_by === clientUserProfile.id && proactiveDoc?.approval_status === 'pending'));

  // ============================================================
  // Staff stage change (P1, real UI) reflected in the portal on refresh,
  // and the waiting_client banner/softened wording.
  // ============================================================
  const p1 = await restoreActorSession(browser, { baseURL: SITE_URL, statePath: ctx.statePaths.p1 });
  await p1.page.goto(`/tasks/${ctx.taskMatrixWithReviewer.id}`, { waitUntil: 'domcontentloaded' });
  await p1.page.getByRole('button', { name: 'Waiting on client' }).click();
  await wait(800);
  const taskMNowWaiting = await waitForCond(async () => {
    const { data } = await admin.from('tasks').select('stage').eq('id', ctx.taskMatrixWithReviewer.id).single();
    return data.stage === 'waiting_client' ? data : null;
  });
  results.push(log('Staff (P1) moves Task M to waiting_client via real UI', !!taskMNowWaiting));

  await client.goto(`/portal/tasks/${ctx.taskMatrixWithReviewer.id}`, { waitUntil: 'domcontentloaded' });
  const waitingBanner = await client.getByText('Your CA firm is waiting on you.', { exact: false }).isVisible().catch(() => false);
  results.push(log('Portal task page reflects the staff stage change (waiting_client banner) on load', waitingBanner));
  const softenedLabel = await client.getByText('Waiting on you', { exact: false }).first().isVisible().catch(() => false);
  results.push(log('Portal shows softened stage wording ("Waiting on you")', softenedLabel));

  await client.goto('/portal', { waitUntil: 'domcontentloaded' });
  // .first(): the regex matches both the inner <span> and its parent <p>
  // (whose text includes the span's), which is a strict-mode violation
  // without narrowing to one element.
  const homeBanner = await client.getByText(/task.*waiting on you/i).first().isVisible().catch(() => false);
  results.push(log('Portal home shows the "N tasks are waiting on you" banner', homeBanner));

  writeFileSync(path.join(DATA_DIR, 'context.json'), JSON.stringify(ctx, null, 2));
  await browser.close();

  console.log('\n--- Step 5 summary (portal end-to-end) ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  writeFileSync(path.join(DATA_DIR, 'results-04-portal-e2e.json'), JSON.stringify(results, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
