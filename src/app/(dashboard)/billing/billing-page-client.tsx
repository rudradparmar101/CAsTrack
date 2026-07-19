'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Receipt, Pencil, Ban, CheckCircle2, ListTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { InvoiceForm } from './invoice-form';
import { FeeMasterForm } from './fee-master-form';
import { toggleFeeMasterActiveAction } from './actions';
import { formatINR, INVOICE_STATUS_LABELS, INVOICE_STATUS_BADGE_VARIANT } from '@/lib/format';
import type { Client, ClientOutstanding, ComplianceType, FeeMaster, FeeMasterWithRefs, FirmInvoiceWithClient } from '@/lib/types';

const PERIODICITY_LABELS: Record<string, string> = {
  one_time: 'One-time',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

interface BillingPageClientProps {
  invoices: FirmInvoiceWithClient[];
  outstanding: (ClientOutstanding & { client: { name: string } | null })[];
  clients: Pick<Client, 'id' | 'name' | 'gstin'>[];
  feeMasters: FeeMaster[];
  allFeeMasters: FeeMasterWithRefs[];
  complianceTypes: Pick<ComplianceType, 'id' | 'code' | 'name'>[];
  firmGstin: string | null;
  canManage: boolean;
}

export function BillingPageClient({
  invoices,
  outstanding,
  clients,
  feeMasters,
  allFeeMasters,
  complianceTypes,
  firmGstin,
  canManage,
}: BillingPageClientProps) {
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateFeeModal, setShowCreateFeeModal] = useState(false);
  const [editingFeeMaster, setEditingFeeMaster] = useState<FeeMasterWithRefs | null>(null);
  const [feeActionError, setFeeActionError] = useState('');

  const totalOutstanding = outstanding.reduce((sum, o) => sum + Number(o.outstanding || 0), 0);

  const handleToggleFeeActive = async (feeMaster: FeeMasterWithRefs) => {
    const verb = feeMaster.is_active ? 'Deactivate' : 'Reactivate';
    if (!confirm(`${verb} the rate for "${feeMaster.service_name}"?`)) return;
    const result = await toggleFeeMasterActiveAction(feeMaster.id, !feeMaster.is_active);
    if (!result.success) {
      setFeeActionError(result.error || 'Failed to update rate');
      setTimeout(() => setFeeActionError(''), 5000);
    }
  };

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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Rate Card</h2>
          {canManage && (
            <Button size="sm" variant="secondary" onClick={() => setShowCreateFeeModal(true)}>
              <Plus className="h-4 w-4" />
              Add Rate
            </Button>
          )}
        </div>

        {feeActionError && (
          <div className="rounded-lg bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] text-sm px-4 py-3 mb-3 animate-fade-in">
            {feeActionError}
          </div>
        )}

        <Card padding={allFeeMasters.length === 0 ? 'md' : 'none'} className="overflow-x-auto">
          {allFeeMasters.length === 0 ? (
            <EmptyState
              icon={<ListTree className="h-10 w-10" />}
              title="No rates yet"
              description="Build your rate card so invoices can autofill line items from it."
              action={
                canManage ? (
                  <Button onClick={() => setShowCreateFeeModal(true)} size="sm">
                    <Plus className="h-4 w-4" />
                    Add First Rate
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  <th className="px-3 py-2">Service</th>
                  <th className="px-3 py-2">Applies to</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Periodicity</th>
                  <th className="px-3 py-2">Status</th>
                  {canManage && <th className="px-3 py-2 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {allFeeMasters.map((fm) => (
                  <tr key={fm.id}>
                    <td className="px-3 py-2 font-medium text-[var(--color-text)]">
                      {fm.service_name}
                      {fm.compliance_type && (
                        <span className="block text-xs text-[var(--color-text-muted)]">{fm.compliance_type.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                      {fm.client ? fm.client.name : <span className="italic">Firm-wide</span>}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text)]">{formatINR(fm.amount)}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{PERIODICITY_LABELS[fm.periodicity]}</td>
                    <td className="px-3 py-2">
                      <Badge variant={fm.is_active ? 'success' : 'default'}>{fm.is_active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    {canManage && (
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditingFeeMaster(fm)}
                            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-accent-muted)] transition-colors"
                            title="Edit rate"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleFeeActive(fm)}
                            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors"
                            title={fm.is_active ? 'Deactivate rate' : 'Reactivate rate'}
                          >
                            {fm.is_active ? <Ban className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    )}
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

      <Modal open={showCreateFeeModal} onClose={() => setShowCreateFeeModal(false)} title="Add Rate">
        <FeeMasterForm
          clients={clients}
          complianceTypes={complianceTypes}
          onSuccess={() => setShowCreateFeeModal(false)}
          onCancel={() => setShowCreateFeeModal(false)}
        />
      </Modal>

      <Modal open={!!editingFeeMaster} onClose={() => setEditingFeeMaster(null)} title="Edit Rate">
        {editingFeeMaster && (
          <FeeMasterForm
            feeMaster={editingFeeMaster}
            clients={clients}
            complianceTypes={complianceTypes}
            onSuccess={() => setEditingFeeMaster(null)}
            onCancel={() => setEditingFeeMaster(null)}
          />
        )}
      </Modal>
    </div>
  );
}
