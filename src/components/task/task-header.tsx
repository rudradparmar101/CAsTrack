'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isPast, isToday } from 'date-fns';
import { ArrowLeft, Briefcase, Edit, Eye, EyeOff, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { PriorityBadge } from '@/components/priority-badge';
import { StageBadge } from '@/components/task/stage-badge';
import { TaskForm } from '@/components/task/task-form';
import {
  updateTaskAction,
  toggleTaskVisibilityAction,
  deleteTaskAction,
} from '@/app/(dashboard)/tasks/actions';
import type { FirmTaskDetail } from '@/lib/types';

interface TaskHeaderProps {
  task: FirmTaskDetail;
  /** Viewer holds an UPDATE path on this task (RLS enforces regardless). */
  canUpdate: boolean;
  isPartner: boolean;
}

export function TaskHeader({ task, canUpdate, isPartner }: TaskHeaderProps) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [error, setError] = useState('');

  const due = new Date(task.due_date + 'T23:59:59');
  const overdue = task.status === 'pending' && isPast(due) && !isToday(due);

  const handleToggleVisibility = async () => {
    setTogglingVisibility(true);
    setError('');
    const result = await toggleTaskVisibilityAction(task.id, !task.visible_to_client);
    if (!result.success) setError(result.error || 'Failed to change visibility.');
    setTogglingVisibility(false);
  };

  const handleDelete = async () => {
    if (
      !confirm(
        'Delete this task? Comments and activity will be removed; documents are preserved on the client.'
      )
    ) {
      return;
    }
    const result = await deleteTaskAction(task.id);
    if (result.success) {
      router.push('/tasks');
    } else {
      setError(result.error || 'Failed to delete the task.');
    }
  };

  return (
    <>
      <Link
        href="/tasks"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Tasks
      </Link>

      <Card padding="lg">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-[var(--color-text)]">{task.title}</h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {task.client && (
                <Link
                  href={`/clients/${task.client.id}`}
                  className="inline-flex items-center gap-1 hover:text-[var(--color-accent)] transition-colors"
                >
                  <Briefcase className="h-3.5 w-3.5" />
                  {task.client.name}
                </Link>
              )}
              {task.department && (
                <span className="text-[var(--color-text-muted)]">{task.department.name}</span>
              )}
              {task.period_label && (
                <span className="text-[var(--color-text-muted)]">{task.period_label}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {overdue && (
              <Badge variant="danger" dot>
                Overdue
              </Badge>
            )}
            <PriorityBadge priority={task.priority} size="md" />
            <StageBadge stage={task.stage} />
          </div>
        </div>

        {task.description && task.description.trim() && (
          <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
              {task.description}
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[var(--color-border)] flex-wrap">
          {canUpdate && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setShowEdit(true)}>
                <Edit className="h-4 w-4" />
                Edit details
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={togglingVisibility}
                onClick={handleToggleVisibility}
                title={
                  task.visible_to_client
                    ? 'Shown in the client portal — click to make internal'
                    : 'Hidden from the client portal — click to share'
                }
              >
                {task.visible_to_client ? (
                  <>
                    <Eye className="h-4 w-4 text-[var(--color-accent)]" />
                    Visible to client
                  </>
                ) : (
                  <>
                    <EyeOff className="h-4 w-4" />
                    Internal only
                  </>
                )}
              </Button>
            </>
          )}
          <div className="flex-1" />
          {isPartner && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
      </Card>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Task" maxWidth="lg">
        <TaskForm
          task={task}
          clients={[]}
          departments={[]}
          members={[]}
          action={updateTaskAction}
          onSuccess={() => setShowEdit(false)}
          onCancel={() => setShowEdit(false)}
        />
      </Modal>
    </>
  );
}
