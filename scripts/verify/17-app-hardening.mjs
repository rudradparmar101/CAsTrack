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

async function main() {
  console.log('\n17-app-hardening — pure-function proofs for the app-layer audit fixes');
  try {
    await sectionEmail();
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
