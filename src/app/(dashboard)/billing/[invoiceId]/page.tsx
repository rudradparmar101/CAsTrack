import React from 'react';
import { notFound } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import { InvoiceDetailClient } from './invoice-detail-client';
import type { FirmInvoiceItem, Receipt } from '@/lib/types';

interface InvoiceDetailPageProps {
  params: Promise<{ invoiceId: string }>;
}

export default async function InvoiceDetailPage({ params }: InvoiceDetailPageProps) {
  const { invoiceId } = await params;
  const { supabase, profile } = await getAuthContext();
  const isPartner = profile.role === 'partner';
  const canView = isPartner || (await supabase.rpc('has_permission', { p_key: 'billing.view' })).data === true;

  if (!canView) {
    notFound();
  }
  const canManage = isPartner || (await supabase.rpc('has_permission', { p_key: 'billing.manage' })).data === true;

  const { data: invoice } = await supabase
    .from('firm_invoices')
    .select('*, client:client_id(id, name, trade_name, email)')
    .eq('id', invoiceId)
    .single();

  if (!invoice) {
    notFound();
  }

  const [{ data: items }, { data: receipts }] = await Promise.all([
    supabase.from('firm_invoice_items').select('*').eq('invoice_id', invoiceId).order('sort_order'),
    supabase.from('receipts').select('*').eq('invoice_id', invoiceId).order('receipt_date', { ascending: false }),
  ]);

  return (
    <InvoiceDetailClient
      invoice={invoice}
      items={(items as FirmInvoiceItem[]) || []}
      receipts={(receipts as Receipt[]) || []}
      canManage={canManage}
    />
  );
}
