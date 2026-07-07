'use client';

import React, { useState } from 'react';
import { UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { updateTaskAssignmentAction } from '@/app/(dashboard)/tasks/actions';

interface TaskAssignmentProps {
  taskId: string;
  assignedTo: string | null;
  reviewerId: string | null;
  departmentId: string;
  /** Display names from the RLS-scoped joins (for the read-only view). */
  assigneeName: string | null;
  reviewerName: string | null;
  departmentName: string | null;
  members: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  /** partner or tasks.assign — mirrors the app-layer check in the action. */
  canAssign: boolean;
}

export function TaskAssignment({
  taskId,
  assignedTo,
  reviewerId,
  departmentId,
  assigneeName,
  reviewerName,
  departmentName,
  members,
  departments,
  canAssign,
}: TaskAssignmentProps) {
  const [values, setValues] = useState({
    assigned_to: assignedTo || '',
    reviewer_id: reviewerId || '',
    department_id: departmentId,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const dirty =
    values.assigned_to !== (assignedTo || '') ||
    values.reviewer_id !== (reviewerId || '') ||
    values.department_id !== departmentId;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    const formData = new FormData();
    formData.set('assigned_to', values.assigned_to);
    formData.set('reviewer_id', values.reviewer_id);
    formData.set('department_id', values.department_id);
    const result = await updateTaskAssignmentAction(taskId, formData);
    if (!result.success) {
      setError(result.error || 'Failed to update the assignment.');
    } else {
      setSaved(true);
    }
    setSaving(false);
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
    <Card>
      <h2 className="text-base font-semibold text-[var(--color-text)] flex items-center gap-2 mb-3">
        <UserCog className="h-4 w-4 text-[var(--color-primary)]" />
        Assignment
      </h2>

      {canAssign ? (
        <div className="space-y-3">
          <Select
            label="Assigned To"
            options={memberOptions}
            value={values.assigned_to}
            onChange={(e) => setValues((v) => ({ ...v, assigned_to: e.target.value }))}
          />
          <Select
            label="Reviewer"
            options={reviewerOptions}
            value={values.reviewer_id}
            onChange={(e) => setValues((v) => ({ ...v, reviewer_id: e.target.value }))}
          />
          <Select
            label="Department"
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
            value={values.department_id}
            onChange={(e) => setValues((v) => ({ ...v, department_id: e.target.value }))}
          />

          {error && (
            <div className="rounded-lg bg-[var(--color-danger-bg)] border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" loading={saving} disabled={!dirty} onClick={handleSave}>
              Save assignment
            </Button>
            {saved && !dirty && (
              <span className="text-xs text-[var(--color-success)]">Saved</span>
            )}
          </div>
        </div>
      ) : (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--color-text-muted)]">Assigned to</dt>
            <dd className="text-[var(--color-text)] text-right">
              {assigneeName || <span className="italic text-[var(--color-text-muted)]">Unassigned</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--color-text-muted)]">Reviewer</dt>
            <dd className="text-[var(--color-text)] text-right">
              {reviewerName || <span className="italic text-[var(--color-text-muted)]">None</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--color-text-muted)]">Department</dt>
            <dd className="text-[var(--color-text)] text-right">{departmentName || '—'}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
