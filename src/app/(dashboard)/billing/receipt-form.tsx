'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { recordReceiptAction } from './actions';

interface ReceiptFormProps {
  invoiceId: string;
  clientId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const MODE_OPTIONS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

export function ReceiptForm({ invoiceId, clientId, onSuccess, onCancel }: ReceiptFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    const result = await recordReceiptAction({
      invoice_id: invoiceId,
      client_id: clientId,
      receipt_date: (formData.get('receipt_date') as string) || new Date().toISOString().slice(0, 10),
      amount: Number(formData.get('amount')) || 0,
      tds_amount: Number(formData.get('tds_amount')) || 0,
      mode: (formData.get('mode') as string) || 'bank_transfer',
      reference_no: (formData.get('reference_no') as string) || null,
      notes: (formData.get('notes') as string) || null,
    });

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Something went wrong');
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Receipt Date" name="receipt_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Amount Received" name="amount" type="number" min={0} step="0.01" defaultValue={0} required />
        <Input label="TDS Deducted (u/s 194J)" name="tds_amount" type="number" min={0} step="0.01" defaultValue={0} />
      </div>
      <Select label="Mode" name="mode" options={MODE_OPTIONS} defaultValue="bank_transfer" />
      <Input label="Reference No." name="reference_no" placeholder="Cheque no. / UTR / UPI ref" />
      <Textarea label="Notes" name="notes" rows={2} />

      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          Record Receipt
        </Button>
      </div>
    </form>
  );
}
