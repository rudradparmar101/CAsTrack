'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import type { ActionResult } from '@/lib/types';
import { friendlyDbError } from '@/lib/db-errors';

/**
 * UDIN register actions (Phase 12.5, migration 007). Writes are PARTNER-ONLY
 * — not permission-gated like billing/team/templates — mirroring migration
 * 007's RLS (checked via get_user_role(), no permission-catalog key) and
 * Phase 10's identical choice for statutory-task generation. Reading the
 * register itself happens directly in page.tsx via the existing
 * reports.view-gated RLS SELECT policy (same inline pattern as
 * /compliance and /billing's page.tsx — no shared guard helper needed).
 */

type Guard =
  | { ok: true; supabase: Awaited<ReturnType<typeof getAuthProfile>>['supabase']; userId: string; firmId: string }
  | { ok: false; error: string };

async function requirePartner(): Promise<Guard> {
  const { supabase, userId, profile } = await getAuthProfile();
  if (profile.role !== 'partner') {
    return { ok: false, error: 'Only a partner can manage the UDIN register.' };
  }
  return { ok: true, supabase, userId, firmId: profile.firm_id };
}

interface UdinEntryInput {
  id?: string;
  client_id: string;
  udin: string;
  document_type: string;
  generated_on: string;
  signing_partner_id: string;
  task_id: string | null;
  document_id: string | null;
  notes: string | null;
}

const UDIN_FORMAT = /^[0-9A-Z]{18}$/;

function validateUdinInput(input: UdinEntryInput): string | null {
  if (!input.client_id) return 'Select a client.';
  const udin = input.udin?.trim().toUpperCase();
  if (!udin || !UDIN_FORMAT.test(udin)) {
    return 'UDIN must be exactly 18 alphanumeric characters (as issued by ICAI).';
  }
  if (!input.document_type?.trim()) return 'Document type is required.';
  if (!input.generated_on) return 'Generation date is required.';
  if (!input.signing_partner_id) return 'Select the signing partner.';
  return null;
}

export async function createUdinEntryAction(input: UdinEntryInput): Promise<ActionResult> {
  const guard = await requirePartner();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, firmId } = guard;

  const validationError = validateUdinInput(input);
  if (validationError) return { success: false, error: validationError };

  const { data, error } = await supabase
    .from('udin_register')
    .insert({
      firm_id: firmId,
      client_id: input.client_id,
      udin: input.udin.trim().toUpperCase(),
      document_type: input.document_type.trim(),
      generated_on: input.generated_on,
      signing_partner_id: input.signing_partner_id,
      task_id: input.task_id || null,
      document_id: input.document_id || null,
      notes: input.notes?.trim() || null,
      created_by: userId,
    })
    .select('id')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      return { success: false, error: 'This UDIN is already recorded in the register.' };
    }
    if (error?.code === '23514') {
      return { success: false, error: 'UDIN must be exactly 18 alphanumeric characters (as issued by ICAI).' };
    }
    return { success: false, error: friendlyDbError(error, { context: 'udin' }) };
  }

  revalidatePath('/udin');
  return { success: true };
}

export async function updateUdinEntryAction(input: UdinEntryInput): Promise<ActionResult> {
  const guard = await requirePartner();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  if (!input.id) return { success: false, error: 'Missing register entry.' };

  const validationError = validateUdinInput(input);
  if (validationError) return { success: false, error: validationError };

  const { data, error } = await supabase
    .from('udin_register')
    .update({
      client_id: input.client_id,
      udin: input.udin.trim().toUpperCase(),
      document_type: input.document_type.trim(),
      generated_on: input.generated_on,
      signing_partner_id: input.signing_partner_id,
      task_id: input.task_id || null,
      document_id: input.document_id || null,
      notes: input.notes?.trim() || null,
    })
    .eq('id', input.id)
    .eq('firm_id', firmId)
    .select('id')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      return { success: false, error: 'This UDIN is already recorded in the register.' };
    }
    if (error?.code === '23514') {
      return { success: false, error: 'UDIN must be exactly 18 alphanumeric characters (as issued by ICAI).' };
    }
    return { success: false, error: friendlyDbError(error, { context: 'udin' }) };
  }

  revalidatePath('/udin');
  return { success: true };
}
