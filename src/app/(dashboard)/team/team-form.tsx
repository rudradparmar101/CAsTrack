'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Department, ActionResult } from '@/lib/types';

interface TeamFormProps {
  department?: Department;
  action: (formData: FormData) => Promise<ActionResult>;
  onSuccess: () => void;
  onCancel: () => void;
}

export function TeamForm({
  department,
  action,
  onSuccess,
  onCancel,
}: TeamFormProps) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    if (department) {
      formData.set('id', department.id);
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
        label="Department Name"
        name="name"
        placeholder="e.g. International Tax"
        defaultValue={department?.name || ''}
        required
      />

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {department ? 'Update Department' : 'Create Department'}
        </Button>
      </div>
    </form>
  );
}
