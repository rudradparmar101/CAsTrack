import React from 'react';
import Link from 'next/link';
import { format, isPast, isToday, differenceInDays } from 'date-fns';
import { Calendar, User, Building2 } from 'lucide-react';
import { PriorityBadge } from '@/components/priority-badge';
import { StageBadge } from '@/components/task/stage-badge';
import { Badge } from '@/components/ui/badge';
import type { FirmTaskWithRefs } from '@/lib/types';

interface TaskSummaryCardProps {
  task: FirmTaskWithRefs;
}

function getTaskUrgency(task: FirmTaskWithRefs) {
  if (task.status === 'completed') return 'completed';
  const dueDate = new Date(task.due_date + 'T23:59:59');
  if (isPast(dueDate) && !isToday(dueDate)) return 'overdue';
  const daysUntil = differenceInDays(dueDate, new Date());
  if (daysUntil <= 7) return 'due-soon';
  return 'upcoming';
}

const urgencyConfig = {
  overdue: { variant: 'danger' as const, label: 'Overdue', dot: true },
  'due-soon': { variant: 'warning' as const, label: 'Due Soon', dot: true },
  upcoming: { variant: 'default' as const, label: 'Upcoming', dot: false },
  completed: { variant: 'success' as const, label: 'Completed', dot: false },
};

/** Dashboard summary card for a FirmTask — informational only, click through
 *  to /tasks/[id] for stage changes, assignment, or delete (the stage
 *  machine's own affordances, not duplicated here). */
export function TaskSummaryCard({ task }: TaskSummaryCardProps) {
  const urgency = getTaskUrgency(task);
  const config = urgencyConfig[urgency];

  return (
    <Link
      href={`/tasks/${task.id}`}
      className={`
        group block bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]
        p-4 transition-all duration-200
        hover:shadow-md hover:border-[var(--color-text-muted)]
        animate-fade-in
        ${task.status === 'completed' ? 'opacity-75' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h4
            className={`text-sm font-semibold text-[var(--color-text)] truncate group-hover:text-[var(--color-accent)] transition-colors ${
              task.status === 'completed' ? 'line-through' : ''
            }`}
          >
            {task.title}
          </h4>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            {task.client?.name}
          </p>
        </div>
        <Badge variant={config.variant} dot={config.dot}>
          {config.label}
        </Badge>
      </div>

      <div className="flex items-center flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" />
          {format(new Date(task.due_date), 'MMM d, yyyy')}
        </span>
        <PriorityBadge priority={task.priority} size="sm" />
        {task.assignee && (
          <span className="inline-flex items-center gap-1">
            <User className="h-3.5 w-3.5" />
            {task.assignee.name}
          </span>
        )}
        {task.department && (
          <span className="inline-flex items-center gap-1">
            <Building2 className="h-3.5 w-3.5" />
            {task.department.name}
          </span>
        )}
        <StageBadge stage={task.stage} />
      </div>
    </Link>
  );
}
