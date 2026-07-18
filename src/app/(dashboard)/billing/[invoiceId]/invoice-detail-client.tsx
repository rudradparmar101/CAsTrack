'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { formatINR, INVOICE_STATUS_LABELS, INVOICE_STATUS_BADGE_VARIANT } from '@/lib/format';
import { ReceiptForm } from '../receipt-form';
import { issueInvoiceAction, cancelInvoiceAction, deleteDraftInvoiceAction } from '../actions';
import type { FirmInvoice, FirmInvoiceItem, Receipt } from '@/lib/types';

interface InvoiceDetailClientProps {
  invoice: FirmInvoice & { client: { id: string; name: string; trade_name: string | null; email: string | null } };
  items: FirmInvoiceItem[];
  receipts: Receipt[];
  canManage: boolean;
}

export function InvoiceDetailClient({ invoice, items, receipts, canManage }: InvoiceDetailClientProps) {
  const router = useRouter();
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleIssue = async () => {
    setLoading(true);
    setError('');
    const result = await issueInvoiceAction(invoice.id);
    if (!result.success) setError(result.error || 'Failed to issue invoice');
    setLoading(false);
    router.refresh();
  };

  const handleDeleteDraft = async () => {
    if (!confirm('Delete this draft invoice? This cannot be undone.')) return;
    setLoading(true);
    const result = await deleteDraftInvoiceAction(invoice.id);
    if (result.success) {
      router.push('/billing');
    } else {
      setError(result.error || 'Failed to delete draft');
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    const reason = prompt('Reason for cancellation (required):');
    if (!reason) return;
    setLoading(true);
    setError('');
    const result = await cancelInvoiceAction(invoice.id, reason);
    if (!result.success) setError(result.error || 'Failed to cancel invoice');
    setLoading(false);
    router.refresh();
  };

  const canIssue = canManage && invoice.status === 'draft';
  const canDeleteDraft = canManage && invoice.status === 'draft';
  const canCancel = canManage && invoice.status !== 'draft' && invoice.status !== 'cancelled' && invoice.status !== 'paid';
  const canReceipt = canManage && ['issued', 'partially_paid'].includes(invoice.status);

  return (
    <div className="space-y-6 animate-fade-in">
      <Link href="/billing" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
        <ArrowLeft className="h-4 w-4" />
        Back to Billing
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{invoice.invoice_number || 'Draft Invoice'}</h1>
            <Badge variant={INVOICE_STATUS_BADGE_VARIANT[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            <Link href={`/clients/${invoice.client.id}`} className="hover:text-[var(--color-accent)]">
              {invoice.client.name}
            </Link>
            {' · '}FY {invoice.financial_year}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canIssue && (
            <Button onClick={handleIssue} loading={loading}>
              Issue Invoice
            </Button>
          )}
          {canReceipt && (
            <Button variant="secondary" onClick={() => setShowReceiptModal(true)}>
              <Plus className="h-4 w-4" />
              Record Receipt
            </Button>
          )}
          {canCancel && (
            <Button variant="danger" onClick={handleCancel} loading={loading}>
              Cancel Invoice
            </Button>
          )}
          {canDeleteDraft && (
            <Button variant="danger" onClick={handleDeleteDraft} loading={loading}>
              Delete Draft
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      {invoice.status === 'cancelled' && invoice.cancellation_reason && (
        <div className="rounded-lg bg-[var(--color-muted)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          Cancelled: {invoice.cancellation_reason}
        </div>
      )}

      <Card padding="none" className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">SAC</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Rate</th>
              <th className="px-3 py-2">GST %</th>
              <th className="px-3 py-2">Taxable Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2 text-[var(--color-text)]">{item.description}</td>
                <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.sac_code}</td>
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
          <span>{formatINR(invoice.subtotal)}</span>
        </div>
        {invoice.is_interstate ? (
          <div className="flex justify-between text-[var(--color-text-secondary)]">
            <span>IGST</span>
            <span>{formatINR(invoice.igst_amount)}</span>
          </div>
        ) : (
          <>
            <div className="flex justify-between text-[var(--color-text-secondary)]">
              <span>CGST</span>
              <span>{formatINR(invoice.cgst_amount)}</span>
            </div>
            <div className="flex justify-between text-[var(--color-text-secondary)]">
              <span>SGST</span>
              <span>{formatINR(invoice.sgst_amount)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between text-[var(--color-text-secondary)]">
          <span>Round off</span>
          <span>{formatINR(invoice.round_off)}</span>
        </div>
        <div className="flex justify-between font-semibold text-[var(--color-text)] border-t border-[var(--color-border)] pt-1.5">
          <span>Total</span>
          <span>{formatINR(invoice.total_amount)}</span>
        </div>
        <div className="flex justify-between text-[var(--color-success-text)]">
          <span>Received</span>
          <span>{formatINR(invoice.amount_received)}</span>
        </div>
        <div className="flex justify-between text-[var(--color-text-secondary)]">
          <span>TDS Received</span>
          <span>{formatINR(invoice.tds_received)}</span>
        </div>
        <div className="flex justify-between font-semibold text-[var(--color-danger-text)]">
          <span>Outstanding</span>
          <span>{formatINR(invoice.total_amount - invoice.amount_received - invoice.tds_received)}</span>
        </div>
      </Card>

      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-3">Receipts</h2>
        <Card padding={receipts.length === 0 ? 'md' : 'none'}>
          {receipts.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] px-1">No receipts recorded yet.</p>
          ) : (
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">TDS</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{r.receipt_date}</td>
                    <td className="px-3 py-2 text-[var(--color-text)]">{formatINR(r.amount)}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{formatINR(r.tds_amount)}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)] capitalize">{r.mode.replace('_', ' ')}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{r.reference_no || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Modal open={showReceiptModal} onClose={() => setShowReceiptModal(false)} title="Record Receipt">
        <ReceiptForm
          invoiceId={invoice.id}
          clientId={invoice.client.id}
          onSuccess={() => {
            setShowReceiptModal(false);
            router.refresh();
          }}
          onCancel={() => setShowReceiptModal(false)}
        />
      </Modal>
    </div>
  );
}
