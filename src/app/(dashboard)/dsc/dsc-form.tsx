'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { createDscAction, updateDscAction } from './actions';
import type { Client, DscRegisterEntryWithRefs } from '@/lib/types';

interface DscFormProps {
  entry?: DscRegisterEntryWithRefs;
  clients: Pick<Client, 'id' | 'name'>[];
  onSuccess: () => void;
  onCancel: () => void;
}

export function DscForm({ entry, clients, onSuccess, onCancel }: DscFormProps) {
  const [clientId, setClientId] = useState(entry?.client_id || '');
  const [holderName, setHolderName] = useState(entry?.holder_name || '');
  const [holderDesignation, setHolderDesignation] = useState(entry?.holder_designation || '');
  const [issuingAuthority, setIssuingAuthority] = useState(entry?.issuing_authority || '');
  const [dscClass, setDscClass] = useState(entry?.dsc_class || 'Class 3');
  const [serialNumber, setSerialNumber] = useState(entry?.serial_number || '');
  const [issuedOn, setIssuedOn] = useState(entry?.issued_on || '');
  const [expiresOn, setExpiresOn] = useState(entry?.expires_on || '');
  const [storageLocation, setStorageLocation] = useState(entry?.physical_storage_location || '');
  const [notes, setNotes] = useState(entry?.notes || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const input = {
      id: entry?.id,
      client_id: clientId,
      holder_name: holderName,
      holder_designation: holderDesignation || null,
      issuing_authority: issuingAuthority,
      dsc_class: dscClass,
      serial_number: serialNumber,
      issued_on: issuedOn || null,
      expires_on: expiresOn,
      physical_storage_location: storageLocation || null,
      notes: notes || null,
    };

    const result = entry ? await updateDscAction(input) : await createDscAction(input);
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
        label="Client"
        options={[{ value: '', label: 'Select a client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        required
      />

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Holder name"
          value={holderName}
          onChange={(e) => setHolderName(e.target.value)}
          placeholder="The signatory the token belongs to"
          hint="Not necessarily the client entity itself"
          required
        />
        <Input
          label="Designation (optional)"
          value={holderDesignation}
          onChange={(e) => setHolderDesignation(e.target.value)}
          placeholder="Director, Proprietor, ..."
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Issuing authority"
          value={issuingAuthority}
          onChange={(e) => setIssuingAuthority(e.target.value)}
          placeholder="eMudhra, Sify, nCode, Capricorn, ..."
          required
        />
        <Input
          label="DSC class"
          value={dscClass}
          onChange={(e) => setDscClass(e.target.value)}
          placeholder="Class 3"
          required
        />
      </div>

      <Input
        label="Serial / reference number"
        value={serialNumber}
        onChange={(e) => setSerialNumber(e.target.value)}
        placeholder="Printed on the token/certificate"
        required
      />

      <div className="grid grid-cols-2 gap-3">
        <Input label="Issued on (optional)" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        <Input label="Expires on" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} required />
      </div>

      <Input
        label="Physical storage location (optional)"
        value={storageLocation}
        onChange={(e) => setStorageLocation(e.target.value)}
        placeholder="e.g. Office safe, drawer 3 — or 'with client'"
      />

      <Textarea
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Internal notes about this DSC"
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
          {entry ? 'Save Changes' : 'Add DSC'}
        </Button>
      </div>
    </form>
  );
}
