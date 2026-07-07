'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { TaskTemplate, ActionResult } from '@/lib/types';

interface TemplateFormProps {
  template?: TaskTemplate;
  action: (formData: FormData) => Promise<ActionResult>;
  onSuccess: () => void;
  onCancel: () => void;
}

export function TemplateForm({ template, action, onSuccess, onCancel }: TemplateFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    if (template) formData.set('id', template.id);

    const result = await action(formData);
    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Something went wrong');
    }
    setLoading(false);
  };

  const checklistDefault = (template?.checklist_items || []).map((item) => item.text).join('\n');

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Template Title"
        name="title"
        placeholder="e.g., Quarterly VAT Filing"
        defaultValue={template?.title}
        required
      />

      <Textarea
        label="Description"
        name="description"
        placeholder="Default instructions or notes for tasks created from this template..."
        defaultValue={template?.description}
        rows={3}
      />

      <Select
        label="Default Priority"
        name="default_priority"
        options={[
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'critical', label: 'Critical' },
        ]}
        defaultValue={template?.default_priority || 'medium'}
      />

      <Select
        label="Default Recurrence"
        name="recurring_rule"
        options={[
          { value: 'none', label: 'No Recurrence' },
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' },
          { value: 'quarterly', label: 'Quarterly' },
          { value: 'yearly', label: 'Yearly' },
        ]}
        defaultValue={template?.recurring_rule || 'none'}
      />

      <Textarea
        label="Checklist Items"
        name="checklist_items"
        placeholder={'One item per line, e.g.:\nGather statements\nCalculate VAT\nSubmit return'}
        defaultValue={checklistDefault}
        rows={4}
        hint="Each line becomes a checklist item on tasks created from this template."
      />

      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {template ? 'Update Template' : 'Create Template'}
        </Button>
      </div>
    </form>
  );
}
