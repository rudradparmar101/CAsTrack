'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import { sendEmail } from '@/lib/email/resend';
import { invoiceIssuedEmail } from '@/lib/email/templates';
import type { ActionResult, ActionResultWithData } from '@/lib/types';

/**
 * Billing actions for client invoices, receipts, and fee masters (Phase 12).
 * Mirrors the requireClientsManage/requireTemplatesManage pattern: partners
 * always pass, employees need the relevant permission via has_permission
 * (the same SECURITY DEFINER RPC the RLS policies use) — dual-layer with the
 * DB, never RLS-only.
 */

type Guard =
  | { ok: true; supabase: Awaited<ReturnType<typeof getAuthProfile>>['supabase']; userId: string; firmId: string }
  | { ok: false; error: string };

async function requireBillingManage(): Promise<Guard> {
  const { supabase, userId, profile } = await getAuthProfile();
  if (profile.role === 'client_user') {
    return { ok: false, error: 'Not allowed.' };
  }
  if (profile.role !== 'partner') {
    const { data: allowed } = await supabase.rpc('has_permission', { p_key: 'billing.manage' });
    if (allowed !== true) {
      return { ok: false, error: 'You do not have permission to manage billing.' };
    }
  }
  return { ok: true, supabase, userId, firmId: profile.firm_id };
}

interface DraftItemInput {
  description: string;
  sac_code?: string;
  quantity: number;
  rate: number;
  gst_rate: number;
}

export async function createDraftInvoiceAction(input: {
  client_id: string;
  financial_year: string;
  due_date: string | null;
  firm_gstin: string | null;
  client_gstin: string | null;
  place_of_supply: string | null;
  place_of_supply_state_code: string | null;
  is_interstate: boolean;
  tds_expected: number;
  items: DraftItemInput[];
}): Promise<ActionResultWithData<{ id: string }>> {
  const guard = await requireBillingManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, firmId } = guard;

  if (!input.client_id) return { success: false, error: 'Select a client.' };
  if (!input.items.length) return { success: false, error: 'Add at least one line item.' };
  for (const item of input.items) {
    if (!item.description?.trim()) return { success: false, error: 'Every line item needs a description.' };
    if (!(item.quantity > 0)) return { success: false, error: 'Quantity must be greater than zero.' };
    if (item.rate < 0) return { success: false, error: 'Rate cannot be negative.' };
  }

  const { data: invoice, error: invError } = await supabase
    .from('firm_invoices')
    .insert({
      firm_id: firmId,
      client_id: input.client_id,
      financial_year: input.financial_year,
      due_date: input.due_date,
      firm_gstin: input.firm_gstin,
      client_gstin: input.client_gstin,
      place_of_supply: input.place_of_supply,
      place_of_supply_state_code: input.place_of_supply_state_code,
      is_interstate: input.is_interstate,
      tds_expected: input.tds_expected,
      created_by: userId,
    })
    .select('id')
    .single();

  if (invError || !invoice) {
    return { success: false, error: invError?.message || 'Failed to create draft invoice.' };
  }

  const itemRows = input.items.map((item, idx) => ({
    firm_id: firmId,
    invoice_id: invoice.id,
    description: item.description.trim(),
    sac_code: item.sac_code?.trim() || '9982',
    quantity: item.quantity,
    rate: item.rate,
    taxable_value: Math.round(item.quantity * item.rate * 100) / 100,
    gst_rate: item.gst_rate,
    sort_order: idx,
  }));

  const { error: itemsError } = await supabase.from('firm_invoice_items').insert(itemRows);
  if (itemsError) {
    // Best-effort cleanup so a failed line-item insert doesn't leave an
    // empty draft behind (issue_firm_invoice would reject it anyway).
    await supabase.from('firm_invoices').delete().eq('id', invoice.id);
    return { success: false, error: itemsError.message };
  }

  revalidatePath('/billing');
  return { success: true, data: { id: invoice.id } };
}

export async function deleteDraftInvoiceAction(invoiceId: string): Promise<ActionResult> {
  const guard = await requireBillingManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const { error } = await supabase
    .from('firm_invoices')
    .delete()
    .eq('id', invoiceId)
    .eq('firm_id', firmId); // RLS also requires status='draft'

  if (error) return { success: false, error: error.message };

  revalidatePath('/billing');
  return { success: true };
}

export async function issueInvoiceAction(invoiceId: string): Promise<ActionResult> {
  const guard = await requireBillingManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase } = guard;

  const { error } = await supabase.rpc('issue_firm_invoice', { p_invoice_id: invoiceId });
  if (error) return { success: false, error: error.message };

  // Best-effort email — never blocks the issue itself.
  const { data: invoice } = await supabase
    .from('firm_invoices')
    .select('id, invoice_number, total_amount, due_date, financial_year, client:client_id(name, email), firm:firm_id(name)')
    .eq('id', invoiceId)
    .single<{
      id: string;
      invoice_number: string | null;
      total_amount: number;
      due_date: string | null;
      financial_year: string;
      client: { name: string; email: string | null } | null;
      firm: { name: string } | null;
    }>();

  if (invoice?.client?.email) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    await sendEmail({
      to: invoice.client.email,
      subject: `Invoice ${invoice.invoice_number ?? ''} from ${invoice.firm?.name ?? 'your CA firm'}`,
      html: invoiceIssuedEmail({
        clientName: invoice.client.name,
        firmName: invoice.firm?.name ?? 'Your CA firm',
        invoiceNumber: invoice.invoice_number ?? '',
        totalAmount: invoice.total_amount,
        dueDate: invoice.due_date,
        portalUrl: `${siteUrl}/portal/billing`,
      }),
    });
  }

  revalidatePath('/billing');
  revalidatePath(`/billing/${invoiceId}`);
  return { success: true };
}

export async function cancelInvoiceAction(invoiceId: string, reason: string): Promise<ActionResult> {
  const guard = await requireBillingManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  if (!reason?.trim()) return { success: false, error: 'A cancellation reason is required.' };

  const { error } = await supabase
    .from('firm_invoices')
    .update({ status: 'cancelled', cancellation_reason: reason.trim(), cancelled_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .eq('firm_id', firmId);

  if (error) return { success: false, error: error.message };

  revalidatePath('/billing');
  revalidatePath(`/billing/${invoiceId}`);
  return { success: true };
}

export async function recordReceiptAction(input: {
  invoice_id: string;
  client_id: string;
  receipt_date: string;
  amount: number;
  tds_amount: number;
  mode: string;
  reference_no: string | null;
  notes: string | null;
}): Promise<ActionResult> {
  const guard = await requireBillingManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, firmId } = guard;

  if (input.amount + input.tds_amount <= 0) {
    return { success: false, error: 'Amount + TDS must be greater than zero.' };
  }

  const { error } = await supabase.from('receipts').insert({
    firm_id: firmId,
    client_id: input.client_id,
    invoice_id: input.invoice_id,
    receipt_date: input.receipt_date,
    amount: input.amount,
    tds_amount: input.tds_amount,
    mode: input.mode,
    reference_no: input.reference_no?.trim() || null,
    notes: input.notes?.trim() || null,
    created_by: userId,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath('/billing');
  revalidatePath(`/billing/${input.invoice_id}`);
  return { success: true };
}
