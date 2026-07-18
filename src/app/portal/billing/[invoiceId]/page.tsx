import React from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Building2 } from 'lucide-react';
import { getAuthContext } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { NotificationBell } from '@/components/notification-bell';
import { PortalSignOutButton } from '../../sign-out-button';
import { formatINR, INVOICE_STATUS_LABELS, INVOICE_STATUS_BADGE_VARIANT } from '@/lib/format';
import type { ClientInvoice, ClientInvoiceItem } from '@/lib/types';

interface PortalInvoicePageProps {
  params: Promise<{ invoiceId: string }>;
}

/** Reads ONLY through client_invoices/client_invoice_items — see the header
 *  comment on ../page.tsx for why. */
export default async function PortalInvoicePage({ params }: PortalInvoicePageProps) {
  const { invoiceId } = await params;
  const { supabase, profile, firm, clientId } = await getAuthContext();

  if (profile.role !== 'client_user' || !clientId) {
    redirect('/dashboard');
  }

  const { data: invoice } = await supabase.from('client_invoices').select('*').eq('id', invoiceId).single();
  if (!invoice) {
    notFound();
  }

  const { data: items } = await supabase
    .from('client_invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('sort_order');

  const typedInvoice = invoice as ClientInvoice;
  const typedItems = (items as ClientInvoiceItem[]) || [];

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <header className="bg-[var(--color-surface)] border-b border-[var(--color-border)]">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-[var(--color-accent)] flex items-center justify-center">
              <Building2 className="h-5 w-5 text-[var(--color-accent-foreground)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">{firm.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Client Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell basePath="/portal/tasks" />
            <PortalSignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Link href="/portal/billing" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
          <ArrowLeft className="h-4 w-4" />
          Back to billing
        </Link>

        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-[var(--color-text)]">{typedInvoice.invoice_number}</h1>
          <Badge variant={INVOICE_STATUS_BADGE_VARIANT[typedInvoice.status]}>
            {INVOICE_STATUS_LABELS[typedInvoice.status]}
          </Badge>
        </div>

        <Card padding="none" className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Rate</th>
                <th className="px-3 py-2">GST %</th>
                <th className="px-3 py-2">Taxable Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {typedItems.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2 text-[var(--color-text)]">{item.description}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.quantity}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{formatINR(item.rate)}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.gst_rate}%</td>
                  <td className="px-3 py-2 text-[var(--color-text)]">{formatINR(item.taxable_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card padding="md" className="max-w-sm ml-auto space-y-1.5 text-sm">
          <div className="flex justify-between text-[var(--color-text-secondary)]">
            <span>Subtotal</span>
            <span>{formatINR(typedInvoice.subtotal)}</span>
          </div>
          {typedInvoice.is_interstate ? (
            <div className="flex justify-between text-[var(--color-text-secondary)]">
              <span>IGST</span>
              <span>{formatINR(typedInvoice.igst_amount)}</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-[var(--color-text-secondary)]">
                <span>CGST</span>
                <span>{formatINR(typedInvoice.cgst_amount)}</span>
              </div>
              <div className="flex justify-between text-[var(--color-text-secondary)]">
                <span>SGST</span>
                <span>{formatINR(typedInvoice.sgst_amount)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between font-semibold text-[var(--color-text)] border-t border-[var(--color-border)] pt-1.5">
            <span>Total</span>
            <span>{formatINR(typedInvoice.total_amount)}</span>
          </div>
          <div className="flex justify-between text-[var(--color-success-text)]">
            <span>Received</span>
            <span>{formatINR(typedInvoice.amount_received)}</span>
          </div>
          <div className="flex justify-between font-semibold text-[var(--color-danger-text)]">
            <span>Outstanding</span>
            <span>{formatINR(typedInvoice.total_amount - typedInvoice.amount_received - typedInvoice.tds_received)}</span>
          </div>
        </Card>
      </main>
    </div>
  );
}
