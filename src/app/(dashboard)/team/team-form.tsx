'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { Team, ActionResult } from '@/lib/types';

interface TeamFormProps {
  team?: Team;
  members: { id: string; name: string }[];
  action: (formData: FormData) => Promise<ActionResult>;
  onSuccess: () => void;
  onCancel: () => void;
}

export function TeamForm({
  team,
  members,
  action,
  onSuccess,
  onCancel,
}: TeamFormProps) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const leadOptions = [
    { value: '', label: 'No Lead' },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ];

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    if (team) {
      formData.set('id', team.id);
    }

    const result = await action(formData);
    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Something went wrong');
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] text-[var(--color-danger)] text-sm px-4 py-3">
          {error}
        </div>
      )}

      <Input
        label="Team Name"
        name="name"
        placeholder="e.g. Tax Department"
        defaultValue={team?.name || ''}
        required
      />

      <Textarea
        label="Description"
        name="description"
        placeholder="What does this team handle?"
        defaultValue={team?.description || ''}
        rows={3}
      />

      <Select
        label="Team Lead"
        name="lead_id"
        options={leadOptions}
        defaultValue={team?.lead_id || ''}
      />

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {team ? 'Update Team' : 'Create Team'}
        </Button>
      </div>
    </form>
  );
}
