'use server';

import { revalidatePath } from 'next/cache';
import { parseCsv } from '@/lib/csv';
import { requireClientsManage } from './actions';
import { parseClientFields } from './client-validation';
import type { ActionResultWithData } from '@/lib/types';
import { friendlyDbError } from '@/lib/db-errors';

/**
 * Bulk client import (Phase 12.6) — a faster front-end to the SAME create
 * path as the manual "Add Client" form, not a new privileged write path.
 * Every row goes through the exact same requireClientsManage() app guard +
 * parseClientFields() validator + clients INSERT RLS policy as a single
 * manual create; nothing here bypasses either layer, and there is no
 * service-role client anywhere in this file.
 *
 * v1 scope: CORE CLIENT FIELDS ONLY — no addresses/authorized-persons/
 * registrations. Two reasons, not just CSV-flatness: (1) encoding nested
 * child rows in a flat CSV needs its own design (repeated-row-per-address
 * conventions, etc.) that's a genuine follow-up, not a corner to cut here;
 * (2) createClientAction's own multi-table sequence (client row, then
 * addresses, then persons, then registrations) is NOT atomic — a child
 * insert failing after the client row lands leaves a real, already-existing
 * client behind (see actions.ts's own comments: "Client was created, but
 * saving X failed... Open the client and edit to retry"). That's an
 * accepted, pre-existing single-create risk; multiplied across a 50-row
 * import it would be a much worse failure mode (a batch of half-written
 * clients to manually reconcile). Restricting v1 to core fields means every
 * row is exactly ONE single-table INSERT — inherently atomic, no rollback
 * logic needed, no half-written client possible.
 *
 * Import semantics: PARTIAL, not all-or-nothing — valid rows are created,
 * invalid/duplicate rows are skipped and reported with a reason. Recommended
 * for onboarding usability (one typo'd row in a 50-row file shouldn't block
 * the other 49) and made explicit here per the phase brief.
 *
 * Duplicate handling: SKIP AND REPORT, keyed on PAN (never GSTIN — a single
 * client entity legitimately holds multiple state-wise GSTINs, so GSTIN is
 * the wrong dedup key; PAN is the one universal per-entity identifier in
 * Indian practice). There is no DB-level UNIQUE constraint on clients.pan
 * (unlike client_registrations, which is unique per client) — so this is an
 * application-layer check, done once per import (never silently updates an
 * existing client from a CSV).
 */

export interface ImportRow {
  /** 1-based, matching the row as a user would see it in a spreadsheet —
   *  the header is row 1, so the first data row is row 2. */
  rowNumber: number;
  values: Record<string, string>;
}

export interface ImportRowResult {
  rowNumber: number;
  name: string;
  status: 'valid' | 'duplicate' | 'invalid' | 'created';
  error?: string;
}

const REQUIRED_HEADER = 'name';
const MAX_ROWS = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function classifyRow(row: ImportRow, seenPans: Set<string>): ImportRowResult {
  const name = row.values.name?.trim() || '(no name)';
  const parsed = parseClientFields(row.values);
  if (!parsed.ok) {
    return { rowNumber: row.rowNumber, name, status: 'invalid', error: parsed.error };
  }
  const pan = parsed.values.pan as string | null;
  if (pan) {
    if (seenPans.has(pan)) {
      return {
        rowNumber: row.rowNumber,
        name,
        status: 'duplicate',
        error: `A client with PAN ${pan} already exists (or appears earlier in this file) — skipped.`,
      };
    }
    seenPans.add(pan);
  }
  return { rowNumber: row.rowNumber, name, status: 'valid' };
}

/** Dry run: parses + validates every row, reports what WOULD happen, writes
 *  nothing. Lets the user fix their CSV before anything is committed. */
export async function previewClientImportAction(
  formData: FormData
): Promise<ActionResultWithData<{ rows: ImportRow[]; results: ImportRowResult[] }>> {
  const guard = await requireClientsManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const file = formData.get('file');
  if (!(file instanceof File)) return { success: false, error: 'No file uploaded.' };
  if (file.size > MAX_FILE_BYTES) return { success: false, error: 'File is too large (max 2 MB).' };

  const text = await file.text();
  const { headers, rows: rawRows } = parseCsv(text);

  if (!headers.includes(REQUIRED_HEADER)) {
    return {
      success: false,
      error: `The CSV is missing a required "${REQUIRED_HEADER}" column. Download the template and match its headers exactly.`,
    };
  }
  if (rawRows.length === 0) {
    return { success: false, error: 'The CSV has no data rows.' };
  }
  if (rawRows.length > MAX_ROWS) {
    return { success: false, error: `Please import ${MAX_ROWS} rows or fewer at a time.` };
  }

  const rows: ImportRow[] = rawRows.map((values, i) => ({ rowNumber: i + 2, values }));

  const { data: existing } = await supabase
    .from('clients')
    .select('pan')
    .eq('firm_id', firmId)
    .not('pan', 'is', null);
  const seenPans = new Set((existing || []).map((c) => c.pan as string));

  const results = rows.map((row) => classifyRow(row, seenPans));

  return { success: true, data: { rows, results } };
}

/** The real write. Re-validates every row from scratch (never trusts the
 *  preview pass's verdict) — the same requireClientsManage() guard + the
 *  same parseClientFields() validator + the same clients INSERT RLS policy
 *  as createClientAction. Each row is one atomic single-table insert. */
export async function commitClientImportAction(
  rows: ImportRow[]
): Promise<ActionResultWithData<{ results: ImportRowResult[]; createdCount: number }>> {
  const guard = await requireClientsManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, firmId } = guard;

  if (!Array.isArray(rows) || rows.length === 0) {
    return { success: false, error: 'Nothing to import.' };
  }
  if (rows.length > MAX_ROWS) {
    return { success: false, error: `Please import ${MAX_ROWS} rows or fewer at a time.` };
  }

  const { data: existing } = await supabase
    .from('clients')
    .select('pan')
    .eq('firm_id', firmId)
    .not('pan', 'is', null);
  const seenPans = new Set((existing || []).map((c) => c.pan as string));

  const results: ImportRowResult[] = [];
  let createdCount = 0;

  for (const row of rows) {
    const name = row.values?.name?.trim() || '(no name)';
    const parsed = parseClientFields(row.values || {});
    if (!parsed.ok) {
      results.push({ rowNumber: row.rowNumber, name, status: 'invalid', error: parsed.error });
      continue;
    }

    const pan = parsed.values.pan as string | null;
    if (pan && seenPans.has(pan)) {
      results.push({
        rowNumber: row.rowNumber,
        name,
        status: 'duplicate',
        error: `A client with PAN ${pan} already exists (or appears earlier in this file) — skipped.`,
      });
      continue;
    }

    // Same insert shape as createClientAction — .select('id').single() so an
    // RLS denial (e.g. a permission revoked mid-import) fails loudly into
    // this row's report instead of silently reporting success.
    const { data: client, error } = await supabase
      .from('clients')
      .insert({ ...parsed.values, firm_id: firmId, created_by: userId })
      .select('id')
      .single();

    if (error || !client) {
      results.push({ rowNumber: row.rowNumber, name, status: 'invalid', error: friendlyDbError(error, { deniedMessage: 'Failed to create client.', context: 'clientImport' }) });
      continue;
    }

    if (pan) seenPans.add(pan);
    results.push({ rowNumber: row.rowNumber, name, status: 'created' });
    createdCount++;
  }

  if (createdCount > 0) {
    revalidatePath('/clients');
  }

  return { success: true, data: { results, createdCount } };
}
