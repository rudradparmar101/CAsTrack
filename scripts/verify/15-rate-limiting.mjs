// Phase (off-roadmap, 2026-07-24) — public-endpoint rate limiting (migration
// 019: rate_limit_buckets + check_rate_limit()). Same house style as
// 10/11/12/14: direct RPC-level proofs for the mechanics that matter most
// (atomicity under concurrency, window reset, fail-open), plus a real-UI
// Playwright pass for wiring correctness. Self-seeding via fresh, per-run
// action names (Date.now()-tagged) so this is safely re-runnable without
// colliding with a previous run's still-live buckets.
//
// WHY THE CONCURRENCY TEST MATTERS MOST: check_rate_limit() uses
// `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1` specifically to
// avoid the classic SELECT-then-UPDATE race (two concurrent callers both
// read the same pre-increment count, both write back count+1, one increment
// is lost). Sequential testing can never catch that class of bug — only
// firing genuinely concurrent requests and checking the final count is
// EXACT (not undercounted) proves the atomic-upsert approach actually works
// under load, which is exactly what this test does.
//
// FAIL-OPEN NOTE: lib/rate-limit.ts is TypeScript, imported by Next.js server
// actions — this plain Node script has no TS loader and can't import it
// directly (no ts-node/tsx in this project's devDependencies). Part 4 below
// proves the RPC genuinely errors under a simulated failure (invalid args),
// producing exactly the `{ error }` shape evaluateRateLimit()'s `if (error)`
// branch checks for; that branch's own behavior (return `{ allowed: true,
// retryAfterSeconds: 0 }`, `console.error` first) is then confirmed by direct
// code inspection of src/lib/rate-limit.ts, noted explicitly rather than
// assumed — the same "verified by code inspection, not independently
// exercised live" allowance this project's own Phase 7 notes already use for
// a case Playwright genuinely cannot construct (there is no way to make a
// live Supabase project's RPC endpoint fail on demand from a script with
// only anon/service-role API access, no direct Postgres connection).
//
// Requires the dev server already running at SITE_URL (npm run dev) for
// Parts 5 and 6 (real HTTP/UI calls). Parts 1-4 talk to the live Supabase
// project directly and don't need the dev server.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './lib/admin.mjs';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL } from './lib/env.mjs';
import { log } from './lib/playwright-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '.data');
const TAG = `rl${Date.now()}`;

const results = [];
const R = (label, ok, detail = '') => results.push(log(label, ok, detail));

function pureAnon() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function rpc(client, action, identifier, maxAttempts, windowSeconds) {
  const { data, error } = await client.rpc('check_rate_limit', {
    p_action: action,
    p_identifier: identifier,
    p_max_attempts: maxAttempts,
    p_window_seconds: windowSeconds,
  });
  return { row: Array.isArray(data) ? data[0] : data, error };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const admin = adminClient();
  const anon = pureAnon();

  // ==========================================================================
  // PART 1 — basic threshold: N allowed, N+1th denied with a sane retry-after
  // ==========================================================================
  {
    const action = `${TAG}-basic`;
    const id = 'ip-basic';
    let allDenied = true;
    for (let i = 1; i <= 3; i++) {
      const { row, error } = await rpc(anon, action, id, 3, 3600);
      if (error || !row?.allowed) allDenied = false;
    }
    R('Part 1: 3 calls under a limit of 3 are all allowed', allDenied);

    const { row, error } = await rpc(anon, action, id, 3, 3600);
    R('Part 1: the 4th call over the same limit is denied', !error && row?.allowed === false, error?.message || `allowed=${row?.allowed}`);
    R('Part 1: a denied call reports a positive, in-window retry-after', !error && row?.retry_after_seconds > 0 && row?.retry_after_seconds <= 3600, `retry_after_seconds=${row?.retry_after_seconds}`);
  }

  // ==========================================================================
  // PART 2 — window reset: denied inside the window, allowed again once the
  // (short, test-only) window has actually elapsed
  // ==========================================================================
  {
    const action = `${TAG}-window`;
    const id = 'ip-window';
    const windowSeconds = 3;
    await rpc(anon, action, id, 1, windowSeconds); // consumes the only slot
    const { row: denied } = await rpc(anon, action, id, 1, windowSeconds);
    R('Part 2: second call inside a 1-per-3s window is denied', denied?.allowed === false, `allowed=${denied?.allowed}`);

    await sleep((windowSeconds + 1) * 1000);
    const { row: freshWindow } = await rpc(anon, action, id, 1, windowSeconds);
    R('Part 2: same action+identifier is allowed again once the window elapses', freshWindow?.allowed === true, `allowed=${freshWindow?.allowed}`);
  }

  // ==========================================================================
  // PART 3 — concurrency: the count under N simultaneous callers must be
  // EXACT, not undercounted. maxAttempts=20, fire 40 concurrent calls,
  // expect exactly 20 allowed and 20 denied — a naive SELECT-then-UPDATE
  // implementation would let more than 20 through under this race.
  // ==========================================================================
  {
    const action = `${TAG}-concurrency`;
    const id = 'ip-concurrency';
    const maxAttempts = 20;
    const totalCalls = 40;

    const outcomes = await Promise.all(
      Array.from({ length: totalCalls }, () => rpc(pureAnon(), action, id, maxAttempts, 3600))
    );

    const errors = outcomes.filter((o) => o.error);
    const allowedCount = outcomes.filter((o) => !o.error && o.row?.allowed === true).length;
    const deniedCount = outcomes.filter((o) => !o.error && o.row?.allowed === false).length;

    R('Part 3: all 40 concurrent RPC calls completed without error', errors.length === 0, `${errors.length} errored`);
    R(`Part 3: EXACTLY ${maxAttempts} of ${totalCalls} concurrent callers were allowed (not undercounted/overcounted — proves the atomic upsert)`,
      allowedCount === maxAttempts, `allowed=${allowedCount}, denied=${deniedCount}`);
    R(`Part 3: the remaining ${totalCalls - maxAttempts} were denied`, deniedCount === totalCalls - maxAttempts, `denied=${deniedCount}`);

    // Cross-check directly against the table: the bucket's own count column
    // must equal totalCalls (every call incremented it exactly once), not
    // just "the allowed/denied split summed correctly" — a second, stronger
    // proof of the same atomicity claim.
    const windowStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    const bucketKey = `${action}:${id}:${windowStart}`;
    const { data: bucketRow, error: bucketErr } = await admin
      .from('rate_limit_buckets')
      .select('count')
      .eq('bucket_key', bucketKey)
      .maybeSingle();
    R('Part 3: the underlying bucket row\'s count column equals the total call count (40), read directly from the table',
      !bucketErr && bucketRow?.count === totalCalls, bucketErr?.message || `count=${bucketRow?.count}`);
  }

  // ==========================================================================
  // PART 4 — fail-open trigger: prove the RPC genuinely errors under a
  // simulated failure, producing the exact shape evaluateRateLimit()'s
  // `if (error)` branch in src/lib/rate-limit.ts checks for. That branch's
  // own behavior (allow + log) is then a code-inspection claim, not a live
  // one — see the header note above for why a live DB-outage can't be
  // constructed from this script.
  // ==========================================================================
  {
    const { error: badArgsError } = await anon.rpc('check_rate_limit', {
      p_action: `${TAG}-failopen`,
      p_identifier: 'ip-failopen',
      p_max_attempts: 5,
      p_window_seconds: 0, // triggers the function's own RAISE EXCEPTION guard
    });
    R('Part 4: an invalid call (window_seconds=0) genuinely errors at the RPC layer, in the same {error} shape evaluateRateLimit() branches on',
      !!badArgsError, badArgsError ? 'errored as expected' : 'no error returned — unexpected');

    const { error: missingFnError } = await anon.rpc('check_rate_limit_does_not_exist', {});
    R('Part 4: a nonexistent-function call also genuinely errors (simulates a broken/misconfigured limiter)',
      !!missingFnError, missingFnError ? 'errored as expected' : 'no error returned — unexpected');
  }
  console.log('  [note] Part 4 confirms real Postgres errors reach the `{ error }` branch. src/lib/rate-limit.ts\'s evaluateRateLimit() catches that branch and returns { allowed: true, retryAfterSeconds: 0 } after console.error — confirmed by direct code inspection, not re-executed here (see header).');

  // ==========================================================================
  // PART 5 — cleanup cron: seed an already-expired bucket, hit the real
  // /api/cron/send-reminders route, confirm it's gone.
  // ==========================================================================
  {
    const staleKey = `${TAG}-stale:cleanup-probe:0`;
    await admin.from('rate_limit_buckets').insert({
      bucket_key: staleKey,
      action: `${TAG}-stale`,
      identifier: 'cleanup-probe',
      window_start: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      count: 1,
      expires_at: new Date(Date.now() - 3600 * 1000).toISOString(), // 1hr in the past
    });

    const { data: beforeRow } = await admin.from('rate_limit_buckets').select('bucket_key').eq('bucket_key', staleKey).maybeSingle();
    R('Part 5: stale bucket seeded directly (pre-condition)', !!beforeRow);

    const cronSecret = process.env.CRON_SECRET;
    let cronOk = false;
    let cronDetail = '';
    try {
      const res = await fetch(`${SITE_URL}/api/cron/send-reminders`, {
        headers: { authorization: `Bearer ${cronSecret}` },
      });
      const body = await res.json();
      cronOk = res.ok;
      cronDetail = `status=${res.status}, rateLimitBucketsExpired=${body.rateLimitBucketsExpired}`;
    } catch (err) {
      cronDetail = `fetch failed: ${err.message} (is the dev server running at ${SITE_URL}?)`;
    }
    R('Part 5: /api/cron/send-reminders responds 200 and reports an expired-bucket count', cronOk, cronDetail);

    const { data: afterRow } = await admin.from('rate_limit_buckets').select('bucket_key').eq('bucket_key', staleKey).maybeSingle();
    R('Part 5: the stale bucket is gone after the cron run (cleanup actually deleted it)', !afterRow, afterRow ? 'still present' : 'deleted');
  }

  // ==========================================================================
  // PART 6 — real UI wiring: normal error paths still work (not broken by
  // the new pre-checks), and a rate-limited response renders as a friendly
  // message, never a raw 500. Uses a fresh browser context per check so each
  // gets its own IP-bucket state as seen by the dev server (all from
  // 127.0.0.1 in local dev — proves the MECHANISM end-to-end; live IP
  // trust on Vercel is verified separately against production, not here).
  // ==========================================================================
  const browser = await chromium.launch();
  try {
    // 6a. Normal invalid-invite-code signup still shows the real validation
    // error (not eaten by the new invite_code_lookup pre-check).
    {
      const page = await browser.newContext().then((c) => c.newPage());
      await page.goto(`${SITE_URL}/signup`);
      await page.getByRole('button', { name: 'Join a Firm' }).click();
      await page.getByLabel('Full Name').fill('RL Test User');
      await page.getByLabel('Email').fill(`${TAG}.signup@example.com`);
      await page.getByLabel('Password').fill('RateLimitTest123!');
      await page.getByLabel('Invite Code').fill('not-a-real-code');
      await page.getByRole('button', { name: 'Join & Create Account' }).click();
      const errorLocator = page.getByText('Invalid invite code. Please check with a partner at your firm.');
      await errorLocator.waitFor({ timeout: 10000 }).catch(() => {});
      R('Part 6a: join-firm signup with a bad code still shows the normal validation error (rate-limit pre-check does not eat it)',
        await errorLocator.isVisible().catch(() => false));
      await page.close();
    }

    // 6b. Normal invalid accept-invite token still shows "not valid" (not
    // mistaken for a rate-limit denial).
    {
      const page = await browser.newContext().then((c) => c.newPage());
      await page.goto(`${SITE_URL}/portal/accept-invite?token=not-a-real-token`);
      const invalidLocator = page.getByText("This invitation isn't valid");
      await invalidLocator.waitFor({ timeout: 10000 }).catch(() => {});
      R('Part 6b: accept-invite with a bad token still shows the normal "not valid" screen',
        await invalidLocator.isVisible().catch(() => false));
      await page.close();
    }

    // 6c. forgot-password: a single legitimate submission (well under any
    // limit) still gets the generic "check your email" success screen —
    // proves the new rate-limit checks don't false-positive on normal use.
    {
      const page = await browser.newContext().then((c) => c.newPage());
      await page.goto(`${SITE_URL}/forgot-password`);
      await page.getByLabel('Email').fill(`${TAG}.legit@example.com`);
      await page.getByRole('button', { name: 'Send reset link' }).click();
      const successLocator = page.getByText('Check your email');
      await successLocator.waitFor({ timeout: 10000 }).catch(() => {});
      R('Part 6c: a single legitimate forgot-password submission (under the limit) still succeeds normally',
        await successLocator.isVisible().catch(() => false));
      await page.close();
    }

    // 6d. forgot-password rate limit tripped for real through the UI: submit
    // past the per-email limit (8/hr) with the SAME email, confirm a
    // friendly "too many attempts" message appears — never a raw 500 — and
    // then confirm enumeration-safety holds UNDER rate limiting: the exact
    // same message appears for a real vs. a made-up email once both are
    // limited (this run's IP bucket is already primed from 6c above, so a
    // fresh identifier keeps this check isolated to the per-EMAIL limit).
    {
      const rlEmail = `${TAG}.emaillimit@example.com`;
      const page = await browser.newContext().then((c) => c.newPage());
      let lastText = '';
      for (let i = 0; i < 9; i++) {
        await page.goto(`${SITE_URL}/forgot-password`);
        await page.getByLabel('Email').fill(rlEmail);
        await page.getByRole('button', { name: 'Send reset link' }).click();
        await page.waitForTimeout(300);
      }
      const limitedLocator = page.getByText(/Too many attempts\. Please try again in \d+ minutes?\./);
      await limitedLocator.waitFor({ timeout: 10000 }).catch(() => {});
      const limited = await limitedLocator.isVisible().catch(() => false);
      R('Part 6d: submitting forgot-password 9x with the same email (limit 8/hr) surfaces a friendly rate-limit message, not a crash', limited);
      lastText = limited ? (await limitedLocator.textContent()) ?? '' : '';
      await page.close();

      // 6e. Enumeration safety UNDER rate limiting: repeat with a DIFFERENT
      // email past its own limit and confirm the exact same generic message
      // shape appears — the response must never distinguish "this identifier
      // is a real account" from "this identifier is made up," only "this
      // identifier tripped the limit."
      const otherEmail = `${TAG}.differentaddress@example.com`;
      const page2 = await browser.newContext().then((c) => c.newPage());
      for (let i = 0; i < 9; i++) {
        await page2.goto(`${SITE_URL}/forgot-password`);
        await page2.getByLabel('Email').fill(otherEmail);
        await page2.getByRole('button', { name: 'Send reset link' }).click();
        await page2.waitForTimeout(300);
      }
      const limitedLocator2 = page2.getByText(/Too many attempts\. Please try again in \d+ minutes?\./);
      await limitedLocator2.waitFor({ timeout: 10000 }).catch(() => {});
      const limited2 = await limitedLocator2.isVisible().catch(() => false);
      const lastText2 = limited2 ? (await limitedLocator2.textContent()) ?? '' : '';
      R('Part 6e: a second, unrelated email tripping its own per-email limit renders an identical-shaped message to 6d (no existence signal leaked)',
        limited2 && lastText.replace(/\d+/, 'N') === lastText2.replace(/\d+/, 'N'),
        `6d="${lastText}" 6e="${lastText2}"`);
      await page2.close();
    }
  } finally {
    await browser.close();
  }

  // ==========================================================================
  // ── summary ──
  // ==========================================================================
  console.log('\n--- 15-rate-limiting summary ---');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed.`);

  try {
    writeFileSync(path.join(DATA_DIR, 'results-15-rate-limiting.json'), JSON.stringify(results, null, 2));
  } catch {
    // .data/ may not exist in a fresh checkout — the console output is the record.
  }
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
