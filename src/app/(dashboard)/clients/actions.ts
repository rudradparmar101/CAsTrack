'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import { CLIENTS_PAGE_SIZE } from '@/lib/pagination';
import {
  ADDRESS_TYPE_OPTIONS,
  REGISTRATION_TYPE_OPTIONS,
  GST_SCHEME_OPTIONS,
  GSTIN_RE,
  PAN_RE,
  TAN_RE,
  DIN_RE,
  PINCODE_RE,
} from '@/lib/ca-options';
import { parseClientFields, clientFieldsFromFormData } from './client-validation';
import type {
  ActionResult,
  ActionResultWithData,
  ClientWithCreator,
} from '@/lib/types';
import { friendlyDbError } from '@/lib/db-errors';

/**
 * Client CRUD for the CA schema.
 *
 * Every mutation re-checks the clients.manage permission at the APP layer via
 * the has_permission RPC (the same SECURITY DEFINER function the RLS policies
 * call), on top of RLS enforcement. DeadlineTracker's updateClientAction/
 * deleteClientAction skipped this and relied on RLS alone (REFERENCE_
 * ARCHITECTURE.md §8.4) — that gap is deliberately not inherited here.
 *
 * There is NO delete action: the schema has no DELETE policy on clients by
 * design (statutory records must survive). Deactivation via is_active only.
 */

// ---- shared guards & parsing -------------------------------------------------

export async function requireClientsManage(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof getAuthProfile>>['supabase']; userId: string; firmId: string }
  | { ok: false; error: string }
> {
  const { supabase, userId, profile } = await getAuthProfile();

  if (profile.role === 'client_user') {
    return { ok: false, error: 'Not allowed.' };
  }
  if (profile.role !== 'partner') {
    const { data: allowed } = await supabase.rpc('has_permission', {
      p_key: 'clients.manage',
    });
    if (allowed !== true) {
      return { ok: false, error: 'You do not have permission to manage clients.' };
    }
  }
  return { ok: true, supabase, userId, firmId: profile.firm_id };
}

interface ParsedAddress {
  type: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  state_code: string | null;
  pincode: string | null;
}

interface ParsedPerson {
  name: string;
  designation: string | null;
  pan: string | null;
  din: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
}

interface ParsedRegistration {
  type: string;
  registration_number: string;
  state: string | null;
  state_code: string | null;
  gst_scheme: string | null;
  is_active: boolean;
}

// parseClientFields/clientFieldsFromFormData live in client-validation.ts —
// a plain (non-'use server') module, since parseClientFields is a pure sync
// function and this file's 'use server' directive requires every export to
// be async. See that file for the shared-validator rationale.

function parseAddresses(formData: FormData):
  | { ok: true; addresses: ParsedAddress[] }
  | { ok: false; error: string } {
  const raw = formData.get('addresses');
  if (!raw || typeof raw !== 'string') return { ok: true, addresses: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Addresses payload was malformed.' };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: 'Addresses payload was malformed.' };

  const addresses: ParsedAddress[] = [];
  for (const [i, entry] of parsed.entries()) {
    const a = entry as Record<string, string>;
    const type = a.type?.trim();
    const line1 = a.line1?.trim();
    const city = a.city?.trim();
    const state = a.state?.trim();
    const pincode = a.pincode?.trim().toUpperCase() || null;

    if (!type || !ADDRESS_TYPE_OPTIONS.some((o) => o.value === type)) {
      return { ok: false, error: `Address ${i + 1}: please choose a valid type.` };
    }
    if (!line1 || !city || !state) {
      return { ok: false, error: `Address ${i + 1}: line 1, city, and state are required.` };
    }
    if (pincode && !PINCODE_RE.test(pincode)) {
      return { ok: false, error: `Address ${i + 1}: PIN code must be 6 digits.` };
    }

    addresses.push({
      type,
      line1,
      line2: a.line2?.trim() || null,
      city,
      state,
      state_code: a.state_code?.trim() || null,
      pincode,
    });
  }
  return { ok: true, addresses };
}

function parsePersons(formData: FormData):
  | { ok: true; persons: ParsedPerson[] }
  | { ok: false; error: string } {
  const raw = formData.get('authorized_persons');
  if (!raw || typeof raw !== 'string') return { ok: true, persons: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Authorized persons payload was malformed.' };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: 'Authorized persons payload was malformed.' };

  const persons: ParsedPerson[] = [];
  for (const [i, entry] of parsed.entries()) {
    const p = entry as Record<string, unknown>;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const pan = typeof p.pan === 'string' && p.pan.trim() ? p.pan.trim().toUpperCase() : null;
    const din = typeof p.din === 'string' && p.din.trim() ? p.din.trim() : null;

    if (!name) {
      return { ok: false, error: `Authorized person ${i + 1}: name is required.` };
    }
    if (pan && !PAN_RE.test(pan)) {
      return { ok: false, error: `Authorized person ${i + 1}: PAN format looks invalid.` };
    }
    if (din && !DIN_RE.test(din)) {
      return { ok: false, error: `Authorized person ${i + 1}: DIN must be 8 digits.` };
    }

    persons.push({
      name,
      designation: typeof p.designation === 'string' ? p.designation.trim() || null : null,
      pan,
      din,
      email: typeof p.email === 'string' ? p.email.trim() || null : null,
      phone: typeof p.phone === 'string' ? p.phone.trim() || null : null,
      is_primary: p.is_primary === true,
    });
  }
  return { ok: true, persons };
}

function parseRegistrations(formData: FormData):
  | { ok: true; registrations: ParsedRegistration[] }
  | { ok: false; error: string } {
  const raw = formData.get('registrations');
  if (!raw || typeof raw !== 'string') return { ok: true, registrations: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Registrations payload was malformed.' };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: 'Registrations payload was malformed.' };

  const registrations: ParsedRegistration[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of parsed.entries()) {
    const r = entry as Record<string, unknown>;
    const type = typeof r.type === 'string' ? r.type.trim() : '';
    const registrationNumber =
      typeof r.registration_number === 'string' ? r.registration_number.trim().toUpperCase() : '';

    if (!type || !REGISTRATION_TYPE_OPTIONS.some((o) => o.value === type)) {
      return { ok: false, error: `Registration ${i + 1}: please choose a valid type.` };
    }
    if (!registrationNumber) {
      return { ok: false, error: `Registration ${i + 1}: registration number is required.` };
    }
    if (type === 'gstin' && !GSTIN_RE.test(registrationNumber)) {
      return { ok: false, error: `Registration ${i + 1}: GSTIN format looks invalid (e.g., 27ABCDE1234F1Z5).` };
    }
    if (type === 'tan' && !TAN_RE.test(registrationNumber)) {
      return { ok: false, error: `Registration ${i + 1}: TAN format looks invalid (e.g., MUMA12345B).` };
    }
    if (seen.has(registrationNumber)) {
      return { ok: false, error: `Registration ${i + 1}: duplicate registration number "${registrationNumber}".` };
    }
    seen.add(registrationNumber);

    const gstScheme = typeof r.gst_scheme === 'string' && r.gst_scheme ? r.gst_scheme : null;
    if (type === 'gstin' && gstScheme && !GST_SCHEME_OPTIONS.some((o) => o.value === gstScheme)) {
      return { ok: false, error: `Registration ${i + 1}: please choose a valid GST scheme.` };
    }

    registrations.push({
      type,
      registration_number: registrationNumber,
      state: typeof r.state === 'string' ? r.state.trim() || null : null,
      state_code: typeof r.state_code === 'string' ? r.state_code.trim() || null : null,
      gst_scheme: type === 'gstin' ? gstScheme : null,
      is_active: r.is_active !== false,
    });
  }
  return { ok: true, registrations };
}

// ---- actions ------------------------------------------------------------------

export async function fetchMoreClientsAction(
  offset: number
): Promise<ActionResultWithData<ClientWithCreator[]>> {
  const { supabase } = await getAuthProfile();

  // RLS scopes rows: partners see the whole firm, employees only clients they
  // have clients.view for or a task against, client_users only themselves.
  const { data, error } = await supabase
    .from('clients')
    .select('*, creator:created_by(id, name)')
    .order('created_at', { ascending: false })
    .range(offset, offset + CLIENTS_PAGE_SIZE - 1);

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'clients' }) };
  }

  return { success: true, data: (data as ClientWithCreator[]) || [] };
}

export async function createClientAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireClientsManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, firmId } = guard;

  const fields = parseClientFields(clientFieldsFromFormData(formData));
  if (!fields.ok) return { success: false, error: fields.error };
  const addressesResult = parseAddresses(formData);
  if (!addressesResult.ok) return { success: false, error: addressesResult.error };
  const personsResult = parsePersons(formData);
  if (!personsResult.ok) return { success: false, error: personsResult.error };
  const registrationsResult = parseRegistrations(formData);
  if (!registrationsResult.ok) return { success: false, error: registrationsResult.error };

  const { data: client, error } = await supabase
    .from('clients')
    .insert({ ...fields.values, firm_id: firmId, created_by: userId })
    .select('id')
    .single();

  if (error || !client) {
    return { success: false, error: friendlyDbError(error, { deniedMessage: 'Failed to create client.', context: 'createClient' }) };
  }

  // Children are validated above, so failures here are infra-level. The client
  // row cannot be rolled back (no DELETE path on clients by design), so report
  // honestly and let the user finish via Edit.
  if (addressesResult.addresses.length > 0) {
    const { error: addrError } = await supabase.from('client_addresses').insert(
      addressesResult.addresses.map((a) => ({ ...a, firm_id: firmId, client_id: client.id }))
    );
    if (addrError) {
      revalidatePath('/clients');
      return {
        success: false,
        error: `Client was created, but saving addresses failed (${friendlyDbError(addrError, { context: 'createClient.addresses' })}) Open the client and edit to retry.`,
      };
    }
  }

  if (personsResult.persons.length > 0) {
    const { error: personError } = await supabase.from('client_authorized_persons').insert(
      personsResult.persons.map((p) => ({ ...p, firm_id: firmId, client_id: client.id }))
    );
    if (personError) {
      revalidatePath('/clients');
      return {
        success: false,
        error: `Client was created, but saving authorized persons failed (${friendlyDbError(personError, { context: 'createClient.persons' })}) Open the client and edit to retry.`,
      };
    }
  }

  if (registrationsResult.registrations.length > 0) {
    const { error: regError } = await supabase.from('client_registrations').insert(
      registrationsResult.registrations.map((r) => ({ ...r, firm_id: firmId, client_id: client.id }))
    );
    if (regError) {
      revalidatePath('/clients');
      return {
        success: false,
        error: `Client was created, but saving registrations failed (${friendlyDbError(regError, { context: 'createClient.registrations' })}) Open the client and edit to retry.`,
      };
    }
  }

  revalidatePath('/clients');
  return { success: true };
}

export async function updateClientAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireClientsManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const id = formData.get('id') as string;
  if (!id) return { success: false, error: 'Missing client id.' };

  const fields = parseClientFields(clientFieldsFromFormData(formData));
  if (!fields.ok) return { success: false, error: fields.error };
  const addressesResult = parseAddresses(formData);
  if (!addressesResult.ok) return { success: false, error: addressesResult.error };
  const personsResult = parsePersons(formData);
  if (!personsResult.ok) return { success: false, error: personsResult.error };
  const registrationsResult = parseRegistrations(formData);
  if (!registrationsResult.ok) return { success: false, error: registrationsResult.error };

  // Explicitly firm-scoped (defense-in-depth) in addition to RLS. Uses the
  // .select().single() pattern (same as tasks/actions.ts) rather than a bare
  // .update(): an RLS-denied update matches zero rows and returns error=null,
  // which would otherwise silently report success with nothing written.
  const { data: updated, error } = await supabase
    .from('clients')
    .update(fields.values)
    .eq('id', id)
    .eq('firm_id', firmId)
    .select('id')
    .single();

  if (error || !updated) {
    return {
      success: false,
      error: friendlyDbError(error, { deniedMessage: 'Update was blocked — the client may no longer be visible to you.', context: 'updateClient' }),
    };
  }

  // Replace-all strategy for the repeatable sub-forms: the edit form always
  // submits the FULL current set (it's preloaded on the detail page), so
  // delete-and-reinsert keeps the action simple and idempotent.
  const { error: addrDeleteError } = await supabase
    .from('client_addresses')
    .delete()
    .eq('client_id', id)
    .eq('firm_id', firmId);
  if (addrDeleteError) {
    return { success: false, error: friendlyDbError(addrDeleteError, { deniedMessage: 'Failed to update addresses.', context: 'updateClient.addresses' }) };
  }
  if (addressesResult.addresses.length > 0) {
    const { error: addrError } = await supabase.from('client_addresses').insert(
      addressesResult.addresses.map((a) => ({ ...a, firm_id: firmId, client_id: id }))
    );
    if (addrError) {
      return { success: false, error: friendlyDbError(addrError, { deniedMessage: 'Failed to save addresses.', context: 'updateClient.addresses' }) };
    }
  }

  const { error: personDeleteError } = await supabase
    .from('client_authorized_persons')
    .delete()
    .eq('client_id', id)
    .eq('firm_id', firmId);
  if (personDeleteError) {
    return { success: false, error: friendlyDbError(personDeleteError, { deniedMessage: 'Failed to update authorized persons.', context: 'updateClient.persons' }) };
  }
  if (personsResult.persons.length > 0) {
    const { error: personError } = await supabase.from('client_authorized_persons').insert(
      personsResult.persons.map((p) => ({ ...p, firm_id: firmId, client_id: id }))
    );
    if (personError) {
      return { success: false, error: friendlyDbError(personError, { deniedMessage: 'Failed to save authorized persons.', context: 'updateClient.persons' }) };
    }
  }

  const { error: regDeleteError } = await supabase
    .from('client_registrations')
    .delete()
    .eq('client_id', id)
    .eq('firm_id', firmId);
  if (regDeleteError) {
    return { success: false, error: friendlyDbError(regDeleteError, { deniedMessage: 'Failed to update registrations.', context: 'updateClient.registrations' }) };
  }
  if (registrationsResult.registrations.length > 0) {
    const { error: regError } = await supabase.from('client_registrations').insert(
      registrationsResult.registrations.map((r) => ({ ...r, firm_id: firmId, client_id: id }))
    );
    if (regError) {
      return { success: false, error: friendlyDbError(regError, { deniedMessage: 'Failed to save registrations.', context: 'updateClient.registrations' }) };
    }
  }

  revalidatePath('/clients');
  revalidatePath(`/clients/${id}`);
  return { success: true };
}

/**
 * Deactivate/reactivate — the ONLY "removal" this app offers. The schema has
 * no DELETE policy on clients by design: statutory records must survive.
 */
export async function setClientActiveAction(
  clientId: string,
  isActive: boolean
): Promise<ActionResult> {
  const guard = await requireClientsManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const { error } = await supabase
    .from('clients')
    .update({ is_active: isActive })
    .eq('id', clientId)
    .eq('firm_id', firmId);

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'clients' }) };
  }

  revalidatePath('/clients');
  revalidatePath(`/clients/${clientId}`);
  return { success: true };
}
