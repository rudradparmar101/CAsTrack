'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { PRIORITY_OPTIONS, RECURRENCE_OPTIONS } from '@/lib/task-options';
import type {
  ActionResult,
  FirmTask,
  FirmTaskTemplate,
  TaskPriority,
  RecurrenceRule,
} from '@/lib/types';

interface TaskFormProps {
  /** Present = edit mode (metadata only — assignment and stage have their own
   *  panels on the detail page). Absent = create mode. */
  task?: FirmTask;
  clients: { id: string; name: string }[];
  /** Departments the current user may create into (all for partners;
   *  own departments for employees — mirrors the tasks INSERT policy). */
  departments: { id: string; name: string }[];
  members: { id: string; name: string }[];
  templates?: FirmTaskTemplate[];
  action: (formData: FormData) => Promise<ActionResult>;
  onSuccess: () => void;
  onCancel: () => void;
}

export function TaskForm({
  task,
  clients,
  departments,
  members,
  templates,
  action,
  onSuccess,
  onCancel,
}: TaskFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visibleToClient, setVisibleToClient] = useState(task ? task.visible_to_client : true);
  const [templateId, setTemplateId] = useState('');
  const [formValues, setFormValues] = useState({
    title: task?.title || '',
    description: task?.description || '',
    priority: (task?.priority || 'medium') as TaskPriority,
    recurring_rule: (task?.recurring_rule || 'none') as RecurrenceRule,
    department_id: task?.department_id || '',
  });

  const isEdit = !!task;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    if (task) formData.set('id', task.id);

    const result = await action(formData);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Something went wrong.');
    }
    setLoading(false);
  };

  const handleTemplateSelect = (selectedTemplateId: string) => {
    setTemplateId(selectedTemplateId);
    const template = templates?.find((t) => t.id === selectedTemplateId);
    if (!template) return;
    setFormValues((v) => ({
      ...v,
      title: template.title,
      description: template.description || '',
      priority: template.default_priority,
      recurring_rule: template.recurring_rule,
      department_id:
        template.department_id && departments.some((d) => d.id === template.department_id)
          ? template.department_id
          : v.department_id,
    }));
  };

  const memberOptions = [
    { value: '', label: 'Unassigned' },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ];
  const reviewerOptions = [
    { value: '', label: 'No Reviewer' },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!isEdit && templates && templates.length > 0 && (
        <>
          <input type="hidden" name="template_id" value={templateId} />
          <Select
            label="Create from Template"
            options={templates.map((t) => ({ value: t.id, label: t.title }))}
            placeholder="Select a template (optional)"
            defaultValue=""
            onChange={(e) => handleTemplateSelect(e.target.value)}
          />
        </>
      )}

      <Input
        label="Task Title"
        name="title"
        placeholder="e.g., GSTR-3B Filing"
        value={formValues.title}
        onChange={(e) => setFormValues((v) => ({ ...v, title: e.target.value }))}
        required
      />

      <Textarea
        label="Description"
        name="description"
        placeholder="Add details, notes, or instructions..."
        value={formValues.description}
        onChange={(e) => setFormValues((v) => ({ ...v, description: e.target.value }))}
        rows={3}
      />

      {/* Client and department are fixed after creation: reassignment across
          clients would corrupt statutory records, and department moves go
          through the assignment panel (permission-gated). */}
      {!isEdit && (
        <>
          <Select
            label="Client"
            name="client_id"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select a client"
            defaultValue=""
            required
          />
          <Select
            label="Department"
            name="department_id"
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
            placeholder="Select a department"
            value={formValues.department_id}
            onChange={(e) => setFormValues((v) => ({ ...v, department_id: e.target.value }))}
            required
          />
        </>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Due Date"
          name="due_date"
          type="date"
          defaultValue={task?.due_date || ''}
          hint="Internal working deadline."
          required
        />
        <Input
          label="Statutory Due Date"
          name="statutory_due_date"
          type="date"
          defaultValue={task?.statutory_due_date || ''}
          hint="Government deadline, if different."
        />
      </div>

      <Input
        label="Period"
        name="period_label"
        placeholder="e.g., May 2026 GSTR-3B, FY 2025-26"
        defaultValue={task?.period_label || ''}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          label="Priority"
          name="priority"
          options={PRIORITY_OPTIONS}
          value={formValues.priority}
          onChange={(e) =>
            setFormValues((v) => ({ ...v, priority: e.target.value as TaskPriority }))
          }
        />
        <Select
          label="Recurrence"
          name="recurring_rule"
          options={RECURRENCE_OPTIONS}
          value={formValues.recurring_rule}
          onChange={(e) =>
            setFormValues((v) => ({ ...v, recurring_rule: e.target.value as RecurrenceRule }))
          }
        />
      </div>

      {!isEdit && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Assign To" name="assigned_to" options={memberOptions} defaultValue="" />
          <Select label="Reviewer" name="reviewer_id" options={reviewerOptions} defaultValue="" />
        </div>
      )}

      {/* Hidden mirror: unchecked checkboxes never submit, so the value rides
          a hidden input that always does. */}
      <input type="hidden" name="visible_to_client" value={visibleToClient ? 'true' : 'false'} />
      <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
        <input
          type="checkbox"
          checked={visibleToClient}
          onChange={(e) => setVisibleToClient(e.target.checked)}
          className="h-4 w-4 rounded border-[var(--color-border)]"
        />
        Visible in the client portal
      </label>

      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      <div className="flex gap-3 justify-end pt-4 sticky bottom-0 -mx-6 px-6 pb-2 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {isEdit ? 'Update Task' : 'Create Task'}
        </Button>
      </div>
    </form>
  );
}
