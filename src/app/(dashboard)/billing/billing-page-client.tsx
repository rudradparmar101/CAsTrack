'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { InvoiceForm } from './invoice-form';
import { formatINR, INVOICE_STATUS_LABELS, INVOICE_STATUS_BADGE_VARIANT } from '@/lib/format';
import type { Client, ClientOutstanding, FeeMaster, FirmInvoiceWithClient } from '@/lib/types';

interface BillingPageClientProps {
  invoices: FirmInvoiceWithClient[];
  outstanding: (ClientOutstanding & { client: { name: string } | null })[];
  clients: Pick<Client, 'id' | 'name' | 'gstin'>[];
  feeMasters: FeeMaster[];
  firmGstin: string | null;
  canManage: boolean;
}

export function BillingPageClient({
  invoices,
  outstanding,
  clients,
  feeMasters,
  firmGstin,
  canManage,
}: BillingPageClientProps) {
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const totalOutstanding = outstanding.reduce((sum, o) => sum + Number(o.outstanding || 0), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Billing</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Firm-wide outstanding: <span className="font-semibold text-[var(--color-text)]">{formatINR(totalOutstanding)}</span>
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4" />
            New Invoice
          </Button>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-3">Outstanding Ledger</h2>
        <Card padding={outstanding.length === 0 ? 'md' : 'none'} className="overflow-x-auto">
          {outstanding.length === 0 ? (
            <EmptyState title="Nothing outstanding" description="No client currently has an unpaid or partially paid invoice." />
          ) : (
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Open</th>
                  <th className="px-3 py-2">Outstanding</th>
                  <th className="px-3 py-2">0-30d</th>
                  <th className="px-3 py-2">31-60d</th>
                  <th className="px-3 py-2">61-90d</th>
                  <th className="px-3 py-2">90d+</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {outstanding.map((row) => (
                  <tr key={row.client_id}>
                    <td className="px-3 py-2 font-medium text-[var(--color-text)]">
                      <Link href={`/clients/${row.client_id}`} className="hover:text-[var(--color-accent)]">
                        {row.client?.name || 'Unknown client'}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.open_invoice_count}</td>
                    <td className="px-3 py-2 font-semibold text-[var(--color-text)]">{formatINR(row.outstanding)}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{formatINR(row.bucket_0_30)}</td>
                    <td className="px-3 py-2 text-[var(--color-warning-text)]">{formatINR(row.bucket_31_60)}</td>
                    <td className="px-3 py-2 text-[var(--color-warning-text)]">{formatINR(row.bucket_61_90)}</td>
                    <td className="px-3 py-2 text-[var(--color-danger-text)]">{formatINR(row.bucket_90_plus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-3">Invoices</h2>
        <Card padding={invoices.length === 0 ? 'md' : 'none'} className="overflow-x-auto">
          {invoices.length === 0 ? (
            <EmptyState
              icon={<Receipt className="h-10 w-10" />}
              title="No invoices yet"
              description="Create your first invoice to start tracking client billing."
              action={
                canManage ? (
                  <Button onClick={() => setShowCreateModal(true)}>
                    <Plus className="h-4 w-4" />
                    New Invoice
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">FY</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2">
                      <Link href={`/billing/${inv.id}`} className="font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]">
                        {inv.invoice_number || 'Draft'}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{inv.client?.name}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{inv.financial_year}</td>
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
      </div>

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Invoice" maxWidth="lg">
        <InvoiceForm
          clients={clients}
          feeMasters={feeMasters}
          firmGstin={firmGstin}
          onSuccess={(invoiceId) => {
            setShowCreateModal(false);
            router.push(`/billing/${invoiceId}`);
          }}
          onCancel={() => setShowCreateModal(false)}
        />
      </Modal>
    </div>
  );
}
