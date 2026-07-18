import React from 'react';
import { Receipt } from 'lucide-react';
import { getAuthContext } from '@/lib/auth';
import { EmptyState } from '@/components/ui/empty-state';
import { BillingPageClient } from './billing-page-client';
import type { Client, ClientOutstanding, FeeMaster, FirmInvoiceWithClient } from '@/lib/types';

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

  const [{ data: invoices }, { data: outstanding }, { data: clients }, { data: feeMasters }] = await Promise.all([
    supabase
      .from('firm_invoices')
      .select('*, client:client_id(id, name, trade_name)')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('client_outstanding').select('*, client:client_id(name)'),
    supabase.from('clients').select('id, name, gstin').eq('is_active', true).order('name'),
    supabase.from('fee_masters').select('*').eq('is_active', true),
  ]);

  return (
    <BillingPageClient
      invoices={(invoices as FirmInvoiceWithClient[]) || []}
      outstanding={(outstanding as (ClientOutstanding & { client: { name: string } | null })[]) || []}
      clients={(clients as Pick<Client, 'id' | 'name' | 'gstin'>[]) || []}
      feeMasters={(feeMasters as FeeMaster[]) || []}
      firmGstin={firm.gstin}
      canManage={canManage}
    />
  );
}
