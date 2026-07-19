import React from 'react';
import { format, isPast, isToday } from 'date-fns';
import { Calendar, Landmark, Repeat, Info, BadgeCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PriorityBadge } from '@/components/priority-badge';
import type { FirmTaskDetail } from '@/lib/types';

interface TaskMetadataProps {
  task: FirmTaskDetail;
}

/** Read-only metadata sidebar card (server-renderable — no interactivity). */
export function TaskMetadata({ task }: TaskMetadataProps) {
  const isOpen = task.status === 'pending';
  const due = new Date(task.due_date + 'T23:59:59');
  const overdue = isOpen && isPast(due) && !isToday(due);

  return (
    <Card>
      <h2 className="text-base font-semibold text-[var(--color-text)] flex items-center gap-2 mb-3">
        <Info className="h-4 w-4 text-[var(--color-accent)]" />
        Details
      </h2>
      <dl className="space-y-2.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--color-text-muted)] flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            Due date
          </dt>
          <dd className={`text-right font-medium ${overdue ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]'}`}>
            {format(new Date(task.due_date), 'MMM d, yyyy')}
            {overdue && <span className="block text-[11px] font-normal">Overdue</span>}
            {isOpen && isToday(due) && (
              <span className="block text-[11px] font-normal text-[var(--color-warning)]">Due today</span>
            )}
          </dd>
        </div>
        {task.statutory_due_date && (
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--color-text-muted)] flex items-center gap-1.5">
              <Landmark className="h-3.5 w-3.5" />
              Statutory due
            </dt>
            <dd className="text-right text-[var(--color-text)]">
              {format(new Date(task.statutory_due_date), 'MMM d, yyyy')}
            </dd>
          </div>
        )}
        {task.period_label && (
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--color-text-muted)]">Period</dt>
            <dd className="text-right text-[var(--color-text)]">{task.period_label}</dd>
          </div>
        )}
        {(task.arn || task.filed_date) && (
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--color-text-muted)] flex items-center gap-1.5">
              <BadgeCheck className="h-3.5 w-3.5" />
              Filing outcome
            </dt>
            <dd className="text-right text-[var(--color-text)]">
              {task.arn && <span className="block font-mono text-xs">ARN {task.arn}</span>}
              {task.filed_date && (
                <span className="block text-[11px] text-[var(--color-text-muted)]">
                  Filed {format(new Date(task.filed_date), 'MMM d, yyyy')}
                </span>
              )}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3 items-center">
          <dt className="text-[var(--color-text-muted)]">Priority</dt>
          <dd>
            <PriorityBadge priority={task.priority} size="sm" />
          </dd>
        </div>
        {task.recurring_rule !== 'none' && (
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--color-text-muted)] flex items-center gap-1.5">
              <Repeat className="h-3.5 w-3.5" />
              Recurs
            </dt>
            <dd className="text-right text-[var(--color-text)] capitalize">{task.recurring_rule}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--color-text-muted)]">Created</dt>
          <dd className="text-right text-[var(--color-text)]">
            {format(new Date(task.created_at), 'MMM d, yyyy')}
            {task.creator?.name && (
              <span className="block text-[11px] text-[var(--color-text-muted)]">
                by {task.creator.name}
              </span>
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
