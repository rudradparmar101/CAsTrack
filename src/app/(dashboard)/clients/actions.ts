'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import { CLIENTS_PAGE_SIZE } from '@/lib/pagination';
import {
  BUSINESS_TYPE_OPTIONS,
  ADDRESS_TYPE_OPTIONS,
  GSTIN_RE,
  PAN_RE,
  TAN_RE,
  CIN_RE,
  DIN_RE,
  PINCODE_RE,
} from '@/lib/ca-options';
import type {
  ActionResult,
  ActionResultWithData,
  ClientWithCreator,
} from '@/lib/types';

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

async function requireClientsManage(): Promise<
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

function opt(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s === '' ? null : s;
}

function optUpper(value: FormDataEntryValue | null): string | null {
  const s = opt(value);
  return s ? s.toUpperCase() : null;
}

/** Validates core client fields; returns friendly errors instead of letting
 *  the schema CHECK constraints bubble up as raw Postgres messages. */
function parseClientFields(formData: FormData):
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: string } {
  const name = opt(formData.get('name'));
  if (!name) return { ok: false, error: 'Client name is required.' };

  const businessType = opt(formData.get('business_type'));
  if (!businessType || !BUSINESS_TYPE_OPTIONS.some((o) => o.value === businessType)) {
    return { ok: false, error: 'Please choose a valid business type.' };
  }

  const gstin = optUpper(formData.get('gstin'));
  if (gstin && !GSTIN_RE.test(gstin)) {
    return { ok: false, error: 'GSTIN format looks invalid (e.g., 27ABCDE1234F1Z5).' };
  }
  const pan = optUpper(formData.get('pan'));
  if (pan && !PAN_RE.test(pan)) {
    return { ok: false, error: 'PAN format looks invalid (e.g., ABCDE1234F).' };
  }
  const tan = optUpper(formData.get('tan'));
  if (tan && !TAN_RE.test(tan)) {
    return { ok: false, error: 'TAN format looks invalid (e.g., MUMA12345B).' };
  }
  const cin = optUpper(formData.get('cin'));
  if (cin && !CIN_RE.test(cin)) {
    return { ok: false, error: 'CIN format looks invalid (21 characters, starts with L or U).' };
  }

  return {
    ok: true,
    values: {
      name,
      trade_name: opt(formData.get('trade_name')),
      business_type: businessType,
      gstin,
      pan,
      tan,
      cin,
      incorporation_date: opt(formData.get('incorporation_date')),
      gst_registration_date: opt(formData.get('gst_registration_date')),
      email: opt(formData.get('email')),
      phone: opt(formData.get('phone')),
      notes: opt(formData.get('notes')),
    },
  };
}

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
    return { success: false, error: error.message };
  }

  return { success: true, data: (data as ClientWithCreator[]) || [] };
}

export async function createClientAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireClientsManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, firmId } = guard;

  const fields = parseClientFields(formData);
  if (!fields.ok) return { success: false, error: fields.error };
  const addressesResult = parseAddresses(formData);
  if (!addressesResult.ok) return { success: false, error: addressesResult.error };
  const personsResult = parsePersons(formData);
  if (!personsResult.ok) return { success: false, error: personsResult.error };

  const { data: client, error } = await supabase
    .from('clients')
    .insert({ ...fields.values, firm_id: firmId, created_by: userId })
    .select('id')
    .single();

  if (error || !client) {
    return { success: false, error: error?.message || 'Failed to create client.' };
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
        error: `Client was created, but saving addresses failed (${addrError.message}). Open the client and edit to retry.`,
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
        error: `Client was created, but saving authorized persons failed (${personError.message}). Open the client and edit to retry.`,
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

  const fields = parseClientFields(formData);
  if (!fields.ok) return { success: false, error: fields.error };
  const addressesResult = parseAddresses(formData);
  if (!addressesResult.ok) return { success: false, error: addressesResult.error };
  const personsResult = parsePersons(formData);
  if (!personsResult.ok) return { success: false, error: personsResult.error };

  // Explicitly firm-scoped (defense-in-depth) in addition to RLS.
  const { error } = await supabase
    .from('clients')
    .update(fields.values)
    .eq('id', id)
    .eq('firm_id', firmId);

  if (error) {
    return { success: false, error: error.message };
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
    return { success: false, error: `Failed to update addresses: ${addrDeleteError.message}` };
  }
  if (addressesResult.addresses.length > 0) {
    const { error: addrError } = await supabase.from('client_addresses').insert(
      addressesResult.addresses.map((a) => ({ ...a, firm_id: firmId, client_id: id }))
    );
    if (addrError) {
      return { success: false, error: `Failed to save addresses: ${addrError.message}` };
    }
  }

  const { error: personDeleteError } = await supabase
    .from('client_authorized_persons')
    .delete()
    .eq('client_id', id)
    .eq('firm_id', firmId);
  if (personDeleteError) {
    return { success: false, error: `Failed to update authorized persons: ${personDeleteError.message}` };
  }
  if (personsResult.persons.length > 0) {
    const { error: personError } = await supabase.from('client_authorized_persons').insert(
      personsResult.persons.map((p) => ({ ...p, firm_id: firmId, client_id: id }))
    );
    if (personError) {
      return { success: false, error: `Failed to save authorized persons: ${personError.message}` };
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
    return { success: false, error: error.message };
  }

  revalidatePath('/clients');
  revalidatePath(`/clients/${clientId}`);
  return { success: true };
}
