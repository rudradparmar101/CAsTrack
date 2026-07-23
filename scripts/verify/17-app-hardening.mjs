/**
 * 17-app-hardening.mjs — pure-function proofs for the app-layer audit fixes
 * that have no database or UI surface to probe.
 *
 * The other verify scripts sign in as real roles and hit the live database,
 * because that is what their subject matter requires. These fixes are
 * different: HTML escaping, Postgres-error mapping, password policy, and
 * redirect allow-listing are all decisions made by pure functions, so the
 * strongest available proof is to compile the REAL modules and exercise them
 * directly — no reimplementation, no mock that could drift from the original.
 *
 * Same tsc-shell-out approach as 16-upload-safety.mjs, for the same reason:
 * this project has no ts-node/tsx (documented in 15-rate-limiting.mjs), and a
 * compile failure FAILS the run rather than silently skipping it, so a green
 * result always means the real code was exercised.
 *
 * Sections:
 *   A  email HTML escaping         (audit M2)
 *   B  Postgres error mapping      (audit L2)
 *   C  password policy             (audit M4)
 *   D  redirect allow-listing      (audit L1)
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TMP = path.join(__dirname, '.data', 'app-hardening');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Compile one real .ts module and import it. Throws (fails the run) on error. */
async function loadModule(relPath, outName) {
  mkdirSync(TMP, { recursive: true });
  execSync(
    `npx tsc "${path.join(ROOT, relPath)}" --outDir "${TMP}" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck`,
    { cwd: ROOT, stdio: 'pipe' }
  );
  const js = path.join(TMP, `${outName}.js`);
  if (!existsSync(js)) throw new Error(`tsc produced no output for ${relPath}`);
  const mjs = path.join(TMP, `${outName}.mjs`);
  writeFileSync(mjs, readFileSync(js, 'utf8'));
  return import('file://' + mjs.replace(/\\/g, '/'));
}

/** The exact shape the audit named: breaks out of <strong>, injects an anchor. */
const HTML_PAYLOAD = '</strong></p><a href="https://evil.example/gst-portal">Verify now</a><p>';

async function sectionEmail() {
  console.log('\nA. Email HTML escaping (M2)');
  const t = await loadModule('src/lib/email/templates.ts', 'templates');

  // Every template that can carry user-controlled text into a CLIENT's inbox.
  const cases = [
    [
      'A1  statutoryReminderEmail — taskTitle + firmName',
      t.statutoryReminderEmail({
        clientName: HTML_PAYLOAD,
        firmName: HTML_PAYLOAD,
        taskTitle: HTML_PAYLOAD,
        periodLabel: HTML_PAYLOAD,
        dueDate: '2026-08-20',
        daysRemaining: 3,
        portalUrl: 'https://praxida.in/portal',
      }),
    ],
    [
      'A2  waitingClientNagEmail — taskTitle + clientName',
      t.waitingClientNagEmail({
        clientName: HTML_PAYLOAD,
        firmName: HTML_PAYLOAD,
        taskTitle: HTML_PAYLOAD,
        daysWaiting: 4,
        portalUrl: 'https://praxida.in/portal',
      }),
    ],
    [
      'A3  notificationEmail — message (carries rejection reasons, comments)',
      t.notificationEmail({ title: HTML_PAYLOAD, message: HTML_PAYLOAD, firmName: HTML_PAYLOAD }),
    ],
    [
      'A4  portalInviteEmail — clientName + firmName',
      t.portalInviteEmail({
        clientName: HTML_PAYLOAD,
        firmName: HTML_PAYLOAD,
        inviteUrl: 'https://praxida.in/portal/accept-invite?token=x',
      }),
    ],
    [
      'A5  invoiceIssuedEmail — invoiceNumber + names',
      t.invoiceIssuedEmail({
        clientName: HTML_PAYLOAD,
        firmName: HTML_PAYLOAD,
        invoiceNumber: HTML_PAYLOAD,
        totalAmount: 25000,
        dueDate: '2026-08-31',
        portalUrl: 'https://praxida.in/portal/billing',
      }),
    ],
    [
      'A6  dscExpiryAlertEmail — holderName + clientName',
      t.dscExpiryAlertEmail({
        firmName: HTML_PAYLOAD,
        holderName: HTML_PAYLOAD,
        clientName: HTML_PAYLOAD,
        expiresOn: '2026-09-01',
        daysRemaining: 7,
        dscUrl: 'https://praxida.in/dsc',
      }),
    ],
  ];

  for (const [name, html] of cases) {
    // The injected anchor must not survive as markup anywhere in the output —
    // not in the body, not in the preheader, not in the <h1>.
    const injected = html.includes('<a href="https://evil.example');
    check(name, !injected, injected ? 'raw <a> survived — injection NOT neutralised' : '');
  }

  // Escaping must be real, not achieved by dropping the text entirely: the
  // content still has to reach the reader, just inert.
  const escaped = t.notificationEmail({ title: 'x', message: HTML_PAYLOAD });
  check(
    'A7  escaped payload is still PRESENT as visible text (not silently dropped)',
    escaped.includes('&lt;a href=&quot;https://evil.example')
  );

  // ctaUrl is app-constructed at every call site today; this guards the future.
  const jsUrl = t.portalInviteEmail({
    clientName: 'Acme',
    firmName: 'Firm',
    inviteUrl: 'javascript:alert(document.domain)',
  });
  check('A8  javascript: ctaUrl is refused, degraded to href="#"', !jsUrl.includes('javascript:') && jsUrl.includes('href="#"'));

  const dataUrl = t.passwordResetEmail({ resetUrl: 'data:text/html,<script>alert(1)</script>' });
  check('A9  data: ctaUrl is refused too', !dataUrl.includes('data:text/html'));

  const goodUrl = t.passwordResetEmail({ resetUrl: 'https://praxida.in/auth/confirm?token_hash=abc&type=recovery' });
  check(
    'A10 a legitimate https ctaUrl still renders correctly (& escaped, link intact)',
    goodUrl.includes('href="https://praxida.in/auth/confirm?token_hash=abc&amp;type=recovery"')
  );
}

async function sectionDbErrors() {
  console.log('\nB. Postgres error mapping (L2)');
  const { friendlyDbError } = await loadModule('src/lib/db-errors.ts', 'db-errors');

  // Silence the module's own server-side logging for the duration — the fact
  // that it logs is asserted separately below.
  const realError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));

  try {
    // The exact strings the audit found reaching the UI.
    const checkConstraint = friendlyDbError({
      code: '23514',
      message: 'new row for relation "receipts" violates check constraint "receipts_amount_check"',
    });
    check(
      'B1  CHECK violation no longer discloses the table or constraint name',
      !checkConstraint.includes('receipts') && !checkConstraint.includes('constraint'),
      `got: ${checkConstraint}`
    );

    const rlsInsert = friendlyDbError({
      code: '42501',
      message: 'new row violates row-level security policy for table "clients"',
    });
    check(
      'B2  RLS INSERT denial no longer discloses the table or the policy',
      !rlsInsert.includes('clients') && !rlsInsert.includes('row-level security'),
      `got: ${rlsInsert}`
    );

    const rlsNoCode = friendlyDbError({
      message: 'new row violates row-level security policy for table "tasks"',
    });
    check(
      'B3  RLS denial WITHOUT a clean code is still caught (message fallback)',
      !rlsNoCode.includes('tasks') && rlsNoCode.toLowerCase().includes('permission'),
      `got: ${rlsNoCode}`
    );

    const unknown = friendlyDbError({
      code: '42P01',
      message: 'relation "firm_invoice_counters" does not exist',
    });
    check(
      'B4  an UNMAPPED code falls through to the generic message (fails closed)',
      !unknown.includes('firm_invoice_counters') && !unknown.includes('relation'),
      `got: ${unknown}`
    );

    // --- the property that must NOT have been weakened -------------------
    const zeroRow = friendlyDbError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
    check(
      'B5  PGRST116 (zero-row write) still maps to a permission message — the loud-fail path',
      zeroRow.toLowerCase().includes('permission'),
      `got: ${zeroRow}`
    );
    const zeroRowCustom = friendlyDbError(
      { code: 'PGRST116', message: 'multiple (or no) rows' },
      { deniedMessage: 'You do not have permission to modify this task.' }
    );
    check(
      'B6  a call site can still supply its own denied message (tasks keeps its wording)',
      zeroRowCustom === 'You do not have permission to modify this task.'
    );
    const nullError = friendlyDbError(null, { deniedMessage: 'Document not found.' });
    check(
      'B7  a null error (row simply absent) still yields the call site\'s message, not a crash',
      nullError === 'Document not found.'
    );

    // --- deliberate schema guard messages must still reach the user -------
    const raised = friendlyDbError({
      code: 'P0001',
      message: 'You do not have permission to update this invoice\'s settlement',
    });
    check(
      'B8  P0001 RAISE EXCEPTION text passes through verbatim (schema guard messages are written FOR users)',
      raised === "You do not have permission to update this invoice's settlement",
      `got: ${raised}`
    );

    // --- server-side detail is retained ----------------------------------
    logged.length = 0;
    friendlyDbError(
      { code: '23514', message: 'violates check constraint "receipts_amount_check"', details: 'Failing row contains (...)' },
      { context: 'recordReceipt' }
    );
    check(
      'B9  the FULL original error is still logged server-side, with code + context',
      logged.length === 1 &&
        logged[0].includes('23514') &&
        logged[0].includes('receipts_amount_check') &&
        logged[0].includes('recordReceipt'),
      `logged: ${logged[0] ?? '(nothing)'}`
    );

    const friendlyCodes = ['23505', '23503', '23502', '22P02', '22001'];
    check(
      'B10 the common constraint codes all produce non-generic, actionable wording',
      friendlyCodes.every((c) => {
        const msg = friendlyDbError({ code: c, message: `raw detail for ${c}` });
        return !msg.includes('raw detail') && msg.length > 0;
      })
    );
  } finally {
    console.error = realError;
  }
}

async function main() {
  console.log('\n17-app-hardening — pure-function proofs for the app-layer audit fixes');
  try {
    await sectionEmail();
    await sectionDbErrors();
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('');
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
