'use client';

import React, { useState } from 'react';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { recordDscMovementAction } from './actions';
import type { DscRegisterEntryWithRefs, Profile } from '@/lib/types';

interface MovementFormProps {
  entry: DscRegisterEntryWithRefs;
  staff: Pick<Profile, 'id' | 'name'>[];
  currentUserId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

/** Check a DSC out to a staff custodian, or check it back in — both go
 *  through record_dsc_movement() (actions.ts), never a direct UPDATE. */
export function MovementForm({ entry, staff, currentUserId, onSuccess, onCancel }: MovementFormProps) {
  const isCheckedOut = !!entry.current_custodian_id;
  const [custodianId, setCustodianId] = useState(isCheckedOut ? '' : currentUserId);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await recordDscMovementAction(entry.id, isCheckedOut ? null : custodianId, note || null);
    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Something went wrong');
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {isCheckedOut ? (
        <div className="rounded-lg bg-[var(--color-muted)] px-4 py-3 text-sm text-[var(--color-text)]">
          Currently with <strong>{entry.custodian?.name || 'a staff member'}</strong>. Checking in returns it to the
          register (not currently checked out to anyone).
        </div>
      ) : (
        <Select
          label="Check out to"
          options={staff.map((s) => ({ value: s.id, label: s.id === currentUserId ? `${s.name} (me)` : s.name }))}
          value={custodianId}
          onChange={(e) => setCustodianId(e.target.value)}
          required
        />
      )}

      <Textarea
        label="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={isCheckedOut ? 'e.g. Returned to office safe, drawer 3' : 'e.g. Collected in person for GSTR-9 filing'}
      />

      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {isCheckedOut ? 'Check in' : 'Check out'}
        </Button>
      </div>
    </form>
  );
}
