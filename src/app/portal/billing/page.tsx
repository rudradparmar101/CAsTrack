import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Building2, Receipt } from 'lucide-react';
import { getAuthContext } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { NotificationBell } from '@/components/notification-bell';
import { PortalSignOutButton } from '../sign-out-button';
import { formatINR, INVOICE_STATUS_LABELS, INVOICE_STATUS_BADGE_VARIANT } from '@/lib/format';
import type { ClientInvoice } from '@/lib/types';

/**
 * Client portal billing — reads ONLY through the client_invoices DEFINER
 * view (migration 004 finding 1 / migration 005 write-through fix). Never
 * queries firm_invoices/firm_invoice_items directly — a client_user has no
 * policy on those base tables and would get zero rows anyway. Outstanding
 * is summed here from the curated rows rather than client_outstanding
 * (that view is security_invoker and returns nothing for a client — by
 * design, per docs/verification/portal-isolation.md §7).
 */
export default async function PortalBillingPage() {
  const { supabase, profile, firm, clientId } = await getAuthContext();

  if (profile.role !== 'client_user' || !clientId) {
    redirect('/dashboard');
  }

  const { data: invoices } = await supabase
    .from('client_invoices')
    .select('*')
    .order('issued_at', { ascending: false });

  const clientInvoices = (invoices as ClientInvoice[]) || [];
  const outstanding = clientInvoices
    .filter((inv) => inv.status === 'issued' || inv.status === 'partially_paid')
    .reduce((sum, inv) => sum + (inv.total_amount - inv.amount_received - inv.tds_received), 0);

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
        <Link href="/portal" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
          <ArrowLeft className="h-4 w-4" />
          Back to portal
        </Link>

        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Billing</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Outstanding: <span className="font-semibold text-[var(--color-text)]">{formatINR(outstanding)}</span>
          </p>
        </div>

        <Card padding={clientInvoices.length === 0 ? 'md' : 'none'} className="overflow-x-auto">
          {clientInvoices.length === 0 ? (
            <EmptyState
              icon={<Receipt className="h-10 w-10" />}
              title="No invoices yet"
              description="Invoices your CA firm issues to you will appear here."
            />
          ) : (
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {clientInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2 font-medium text-[var(--color-text)]">
                      <Link href={`/portal/billing/${inv.id}`} className="hover:text-[var(--color-accent)]">
                        {inv.invoice_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{inv.invoice_date}</td>
                    <td className="px-3 py-2">
                      <Badge variant={INVOICE_STATUS_BADGE_VARIANT[inv.status]}>{INVOICE_STATUS_LABELS[inv.status]}</Badge>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text)]">{formatINR(inv.total_amount)}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{formatINR(inv.amount_received)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </main>
    </div>
  );
}
