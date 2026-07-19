'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { createFeeMasterAction, updateFeeMasterAction } from './actions';
import type { Client, ComplianceType, FeeMasterPeriodicity, FeeMasterWithRefs } from '@/lib/types';

const PERIODICITY_OPTIONS: { value: FeeMasterPeriodicity; label: string }[] = [
  { value: 'one_time', label: 'One-time' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
];

interface FeeMasterFormProps {
  feeMaster?: FeeMasterWithRefs;
  clients: Pick<Client, 'id' | 'name'>[];
  complianceTypes: Pick<ComplianceType, 'id' | 'code' | 'name'>[];
  onSuccess: () => void;
  onCancel: () => void;
}

export function FeeMasterForm({ feeMaster, clients, complianceTypes, onSuccess, onCancel }: FeeMasterFormProps) {
  const [clientId, setClientId] = useState(feeMaster?.client_id || '');
  const [serviceName, setServiceName] = useState(feeMaster?.service_name || '');
  const [complianceTypeId, setComplianceTypeId] = useState(feeMaster?.compliance_type_id || '');
  const [amount, setAmount] = useState(feeMaster?.amount ?? 0);
  const [periodicity, setPeriodicity] = useState<FeeMasterPeriodicity>(feeMaster?.periodicity || 'annual');
  const [notes, setNotes] = useState(feeMaster?.notes || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const input = {
      id: feeMaster?.id,
      client_id: clientId || null,
      service_name: serviceName,
      compliance_type_id: complianceTypeId || null,
      amount,
      periodicity,
      notes: notes || null,
    };

    const result = feeMaster ? await updateFeeMasterAction(input) : await createFeeMasterAction(input);
    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Something went wrong');
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select
        label="Applies to"
        options={[
          { value: '', label: 'Firm-wide (default rate for every client)' },
          ...clients.map((c) => ({ value: c.id, label: c.name })),
        ]}
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
      />

      <Input
        label="Service name"
        value={serviceName}
        onChange={(e) => setServiceName(e.target.value)}
        placeholder="e.g. GSTR-3B monthly filing"
        required
      />

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Amount (₹)"
          type="number"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
          required
        />
        <Select
          label="Periodicity"
          options={PERIODICITY_OPTIONS}
          value={periodicity}
          onChange={(e) => setPeriodicity(e.target.value as FeeMasterPeriodicity)}
        />
      </div>

      <Select
        label="Linked compliance type (optional)"
        options={[
          { value: '', label: 'None' },
          ...complianceTypes.map((ct) => ({ value: ct.id, label: ct.name })),
        ]}
        value={complianceTypeId}
        onChange={(e) => setComplianceTypeId(e.target.value)}
      />

      <Textarea
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Internal notes about this rate"
      />

      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-4 sticky bottom-0 -mx-6 px-6 pb-2 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {feeMaster ? 'Save Changes' : 'Add Rate'}
        </Button>
      </div>
    </form>
  );
}
