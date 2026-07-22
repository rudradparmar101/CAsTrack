'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import type { ActionResult } from '@/lib/types';

/**
 * DSC register actions (Phase 13.2, migration 008).
 *
 * Two distinct app-layer guards, mirroring the two distinct RLS rules:
 *   - requireDscManage(): PARTNER-ONLY, for create/edit/deactivate — mirrors
 *     udin/actions.ts's requirePartner() (no permission-catalog key,
 *     get_user_role() at the RLS layer).
 *   - requireClientsView(): any staff with the EXISTING clients.view
 *     permission (partner bypass automatic) — for reading and for recording
 *     custody movements. Deliberately the SAME check for both, since RLS
 *     gates both the same way: a staff member who cannot see a client
 *     cannot record a movement on that client's DSC either.
 *
 * Movements never touch dsc_register directly from this file — they call
 * the record_dsc_movement() RPC (migration 008), which does the real
 * validation (its own internal clients.view check is the load-bearing one,
 * since it's SECURITY DEFINER and bypasses RLS). The app-layer guard here
 * exists only to fail fast with a friendly message before attempting the
 * RPC, per this codebase's dual-layer house style — it is not the security
 * boundary.
 */

type Guard =
  | { ok: true; supabase: Awaited<ReturnType<typeof getAuthProfile>>['supabase']; userId: string; firmId: string }
  | { ok: false; error: string };

async function requireDscManage(): Promise<Guard> {
  const { supabase, userId, profile } = await getAuthProfile();
  if (profile.role !== 'partner') {
    return { ok: false, error: 'Only a partner can create, edit, or deactivate a DSC record.' };
  }
  return { ok: true, supabase, userId, firmId: profile.firm_id };
}

async function requireClientsView(): Promise<Guard> {
  const { supabase, userId, profile } = await getAuthProfile();
  if (profile.role === 'client_user') {
    return { ok: false, error: 'Not allowed.' };
  }
  if (profile.role !== 'partner') {
    const { data: allowed } = await supabase.rpc('has_permission', { p_key: 'clients.view' });
    if (allowed !== true) {
      return { ok: false, error: 'You do not have permission to view this client’s DSC records.' };
    }
  }
  return { ok: true, supabase, userId, firmId: profile.firm_id };
}

/** PostgREST returns PGRST116 when a write matched no row — with RLS in
 *  play that means "you can see this row but cannot modify it" (same
 *  mapping as tasks/actions.ts's, billing/actions.ts's, and udin/actions.ts's
 *  rlsFriendly()). */
function rlsFriendly(message?: string): string {
  if (!message || message.includes('0 rows') || message.includes('multiple (or no) rows')) {
    return 'You do not have permission to make this change.';
  }
  return message;
}

interface DscEntryInput {
  id?: string;
  client_id: string;
  holder_name: string;
  holder_designation: string | null;
  issuing_authority: string;
  dsc_class: string;
  serial_number: string;
  issued_on: string | null;
  expires_on: string;
  physical_storage_location: string | null;
  notes: string | null;
}

function validateDscInput(input: DscEntryInput): string | null {
  if (!input.client_id) return 'Select a client.';
  if (!input.holder_name?.trim()) return 'Holder name is required.';
  if (!input.issuing_authority?.trim()) return 'Issuing authority is required.';
  if (!input.dsc_class?.trim()) return 'DSC class is required.';
  if (!input.serial_number?.trim()) return 'Serial number is required.';
  if (!input.expires_on) return 'Expiry date is required.';
  return null;
}

export async function createDscAction(input: DscEntryInput): Promise<ActionResult> {
  const guard = await requireDscManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, firmId } = guard;

  const validationError = validateDscInput(input);
  if (validationError) return { success: false, error: validationError };

  const { data, error } = await supabase
    .from('dsc_register')
    .insert({
      firm_id: firmId,
      client_id: input.client_id,
      holder_name: input.holder_name.trim(),
      holder_designation: input.holder_designation?.trim() || null,
      issuing_authority: input.issuing_authority.trim(),
      dsc_class: input.dsc_class.trim(),
      serial_number: input.serial_number.trim(),
      issued_on: input.issued_on || null,
      expires_on: input.expires_on,
      physical_storage_location: input.physical_storage_location?.trim() || null,
      notes: input.notes?.trim() || null,
      created_by: userId,
    })
    .select('id')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      return { success: false, error: 'A DSC with this serial number from this issuing authority is already recorded.' };
    }
    return { success: false, error: rlsFriendly(error?.message) };
  }

  revalidatePath('/dsc');
  return { success: true };
}

export async function updateDscAction(input: DscEntryInput): Promise<ActionResult> {
  const guard = await requireDscManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  if (!input.id) return { success: false, error: 'Missing DSC record.' };

  const validationError = validateDscInput(input);
  if (validationError) return { success: false, error: validationError };

  const { data, error } = await supabase
    .from('dsc_register')
    .update({
      client_id: input.client_id,
      holder_name: input.holder_name.trim(),
      holder_designation: input.holder_designation?.trim() || null,
      issuing_authority: input.issuing_authority.trim(),
      dsc_class: input.dsc_class.trim(),
      serial_number: input.serial_number.trim(),
      issued_on: input.issued_on || null,
      expires_on: input.expires_on,
      physical_storage_location: input.physical_storage_location?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .eq('id', input.id)
    .eq('firm_id', firmId)
    .select('id')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      return { success: false, error: 'A DSC with this serial number from this issuing authority is already recorded.' };
    }
    return { success: false, error: rlsFriendly(error?.message) };
  }

  revalidatePath('/dsc');
  return { success: true };
}

export async function toggleDscActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  const guard = await requireDscManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const { data, error } = await supabase
    .from('dsc_register')
    .update({ is_active: isActive })
    .eq('id', id)
    .eq('firm_id', firmId)
    .select('id')
    .single();

  if (error || !data) {
    return { success: false, error: rlsFriendly(error?.message) };
  }

  revalidatePath('/dsc');
  return { success: true };
}

/** Check a DSC out to a staff custodian, or check it in (p_new_custodian_id
 *  = null). Routes through the record_dsc_movement() RPC — never a direct
 *  UPDATE on dsc_register (which has no non-partner UPDATE policy at all). */
export async function recordDscMovementAction(
  dscId: string,
  newCustodianId: string | null,
  note: string | null
): Promise<ActionResult> {
  const guard = await requireClientsView();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase } = guard;

  const { error } = await supabase.rpc('record_dsc_movement', {
    p_dsc_id: dscId,
    p_new_custodian_id: newCustodianId,
    p_note: note?.trim() || null,
  });

  if (error) {
    // The RPC's own RAISE EXCEPTION messages are already written to be
    // user-facing (same convention as the DB trigger's stage-transition
    // errors surfaced through task-stage-panel.tsx).
    return { success: false, error: error.message };
  }

  revalidatePath('/dsc');
  return { success: true };
}
