import React from 'react';
import { Receipt } from 'lucide-react';
import { getAuthContext } from '@/lib/auth';
import { EmptyState } from '@/components/ui/empty-state';
import { BillingPageClient } from './billing-page-client';
import type { Client, ClientOutstanding, ComplianceType, FeeMaster, FeeMasterWithRefs, FirmInvoiceWithClient } from '@/lib/types';

/** Client's state for defaulting an invoice's place of supply (recon Group
 *  D): prefer an active GSTIN registration's state (more GST-correct when a
 *  client holds multiple GSTINs across states), falling back to the
 *  registered address. Both are pre-filled defaults, never locked — the
 *  invoice form's place-of-supply field stays fully editable. */
interface ClientDefaultState {
  state: string | null;
  state_code: string | null;
}

export default async function BillingPage() {
  const { supabase, profile, firm } = await getAuthContext();
  const isPartner = profile.role === 'partner';
  const canView = isPartner || (await supabase.rpc('has_permission', { p_key: 'billing.view' })).data === true;

  if (!canView) {
    return (
      <EmptyState
        icon={<Receipt className="h-10 w-10" />}
        title="No access"
        description="You don't have permission to view billing."
      />
    );
  }
  const canManage = isPartner || (await supabase.rpc('has_permission', { p_key: 'billing.manage' })).data === true;

  const [
    { data: invoices },
    { data: outstanding },
    { data: clients },
    { data: feeMasters },
    { data: allFeeMasters },
    { data: complianceTypes },
    { data: gstinRegistrations },
    { data: registeredAddresses },
  ] = await Promise.all([
    supabase
      .from('firm_invoices')
      .select('*, client:client_id(id, name, trade_name)')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('client_outstanding').select('*, client:client_id(name)'),
    supabase.from('clients').select('id, name, gstin').eq('is_active', true).order('name'),
    // Active-only, feeds the invoice create-modal's "fill from rate card"
    // autofill — a deactivated row must disappear from that dropdown.
    supabase.from('fee_masters').select('*').eq('is_active', true),
    // Full history (active + inactive) for the rate-card management list below.
    supabase
      .from('fee_masters')
      .select('*, client:client_id(id, name), compliance_type:compliance_type_id(id, code, name)')
      .order('service_name'),
    supabase.from('compliance_types').select('id, code, name').eq('is_active', true).order('name'),
    // Place-of-supply defaulting (recon Group D): active GSTIN registrations first.
    supabase.from('client_registrations').select('client_id, state, state_code').eq('type', 'gstin').eq('is_active', true),
    // Fallback: registered address, for clients with no GSTIN registration on file.
    supabase.from('client_addresses').select('client_id, state, state_code').eq('type', 'registered'),
  ]);

  const clientDefaultStates: Record<string, ClientDefaultState> = {};
  for (const addr of (registeredAddresses as { client_id: string; state: string; state_code: string | null }[]) || []) {
    if (!clientDefaultStates[addr.client_id]) {
      clientDefaultStates[addr.client_id] = { state: addr.state, state_code: addr.state_code };
    }
  }
  // GSTIN registration takes priority — overwrite the address fallback if present.
  for (const reg of (gstinRegistrations as { client_id: string; state: string | null; state_code: string | null }[]) || []) {
    if (reg.state_code) {
      clientDefaultStates[reg.client_id] = { state: reg.state, state_code: reg.state_code };
    }
  }

  return (
    <BillingPageClient
      invoices={(invoices as FirmInvoiceWithClient[]) || []}
      outstanding={(outstanding as (ClientOutstanding & { client: { name: string } | null })[]) || []}
      clients={(clients as Pick<Client, 'id' | 'name' | 'gstin'>[]) || []}
      feeMasters={(feeMasters as FeeMaster[]) || []}
      allFeeMasters={(allFeeMasters as unknown as FeeMasterWithRefs[]) || []}
      complianceTypes={(complianceTypes as Pick<ComplianceType, 'id' | 'code' | 'name'>[]) || []}
      firmGstin={firm.gstin}
      clientDefaultStates={clientDefaultStates}
      canManage={canManage}
    />
  );
}
