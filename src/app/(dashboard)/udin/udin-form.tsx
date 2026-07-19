'use client';

import React, { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { createUdinEntryAction, updateUdinEntryAction } from './actions';
import type { Client, Profile, UdinRegisterEntryWithRefs } from '@/lib/types';

interface UdinFormProps {
  entry?: UdinRegisterEntryWithRefs;
  clients: Pick<Client, 'id' | 'name'>[];
  partners: Pick<Profile, 'id' | 'name'>[];
  tasksLite: { id: string; title: string; client_id: string }[];
  documentsLite: { id: string; name: string; client_id: string }[];
  onSuccess: () => void;
  onCancel: () => void;
}

export function UdinForm({ entry, clients, partners, tasksLite, documentsLite, onSuccess, onCancel }: UdinFormProps) {
  const [clientId, setClientId] = useState(entry?.client_id || '');
  const [udin, setUdin] = useState(entry?.udin || '');
  const [documentType, setDocumentType] = useState(entry?.document_type || '');
  const [generatedOn, setGeneratedOn] = useState(entry?.generated_on || new Date().toISOString().slice(0, 10));
  const [signingPartnerId, setSigningPartnerId] = useState(entry?.signing_partner_id || '');
  const [taskId, setTaskId] = useState(entry?.task_id || '');
  const [documentId, setDocumentId] = useState(entry?.document_id || '');
  const [notes, setNotes] = useState(entry?.notes || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const tasksForClient = useMemo(
    () => tasksLite.filter((t) => t.client_id === clientId),
    [tasksLite, clientId]
  );
  const documentsForClient = useMemo(
    () => documentsLite.filter((d) => d.client_id === clientId),
    [documentsLite, clientId]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const input = {
      id: entry?.id,
      client_id: clientId,
      udin,
      document_type: documentType,
      generated_on: generatedOn,
      signing_partner_id: signingPartnerId,
      task_id: taskId || null,
      document_id: documentId || null,
      notes: notes || null,
    };

    const result = entry ? await updateUdinEntryAction(input) : await createUdinEntryAction(input);
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
        onChange={(e) => {
          setClientId(e.target.value);
          setTaskId('');
          setDocumentId('');
        }}
        required
      />

      <Input
        label="UDIN"
        value={udin}
        onChange={(e) => setUdin(e.target.value.toUpperCase())}
        placeholder="18-character UDIN from the ICAI portal"
        maxLength={18}
        required
      />

      <Input
        label="Document type"
        value={documentType}
        onChange={(e) => setDocumentType(e.target.value)}
        placeholder="e.g. Tax Audit Report, Net Worth Certificate"
        required
      />

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Generated on"
          type="date"
          value={generatedOn}
          onChange={(e) => setGeneratedOn(e.target.value)}
          required
        />
        <Select
          label="Signing partner"
          options={[{ value: '', label: 'Select a partner' }, ...partners.map((p) => ({ value: p.id, label: p.name }))]}
          value={signingPartnerId}
          onChange={(e) => setSigningPartnerId(e.target.value)}
          required
        />
      </div>

      <Select
        label="Linked task (optional)"
        options={[
          { value: '', label: tasksForClient.length ? 'None' : 'Select a client first' },
          ...tasksForClient.map((t) => ({ value: t.id, label: t.title })),
        ]}
        value={taskId}
        onChange={(e) => setTaskId(e.target.value)}
        disabled={!clientId}
      />

      <Select
        label="Linked document (optional)"
        options={[
          { value: '', label: documentsForClient.length ? 'None' : 'Select a client first' },
          ...documentsForClient.map((d) => ({ value: d.id, label: d.name })),
        ]}
        value={documentId}
        onChange={(e) => setDocumentId(e.target.value)}
        disabled={!clientId}
      />

      <Textarea
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Internal notes about this UDIN"
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
          {entry ? 'Save Changes' : 'Add UDIN'}
        </Button>
      </div>
    </form>
  );
}
