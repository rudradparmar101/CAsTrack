'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { format, isPast, isToday, differenceInDays } from 'date-fns';
import { Calendar, User, Users, CheckCircle2, Trash2, Edit, ChevronDown, Repeat, ShieldCheck } from 'lucide-react';
import { PriorityBadge } from '@/components/priority-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { TaskWithDetails } from '@/lib/types';
import { markTaskCompleteAction, deleteTaskAction } from '@/app/(dashboard)/tasks/actions';

interface TaskCardProps {
  task: TaskWithDetails;
  isAdmin: boolean;
  onEdit?: (task: TaskWithDetails) => void;
}

function getTaskUrgency(task: TaskWithDetails) {
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

export function TaskCard({ task, isAdmin, onEdit }: TaskCardProps) {
  const [loading, setLoading] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const urgency = getTaskUrgency(task);
  const config = urgencyConfig[urgency];
  const hasDescription = task.description && task.description.trim().length > 0;

  const handleComplete = async () => {
    setLoading(true);
    await markTaskCompleteAction(task.id);
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    await deleteTaskAction(task.id);
  };

  return (
    <div
      className={`
        group bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]
        p-4 transition-all duration-200
        hover:shadow-md hover:border-[var(--color-text-muted)]
        animate-fade-in
        ${task.status === 'completed' ? 'opacity-75' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h4
            className={`text-sm font-semibold text-[var(--color-text)] truncate ${
              task.status === 'completed' ? 'line-through' : ''
            }`}
          >
            <Link
              href={`/tasks/${task.id}`}
              className="hover:text-[var(--color-primary)] transition-colors"
            >
              {task.title}
            </Link>
          </h4>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            {task.clients?.name}
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
        {task.assigned_profile && (
          <span className="inline-flex items-center gap-1">
            <User className="h-3.5 w-3.5" />
            {task.assigned_profile.name}
          </span>
        )}
        {task.assigned_team && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {task.assigned_team.name}
          </span>
        )}
        {task.recurring_rule && task.recurring_rule !== 'none' && (
          <span className="inline-flex items-center gap-1 text-[var(--color-primary)]">
            <Repeat className="h-3.5 w-3.5" />
            {task.recurring_rule.charAt(0).toUpperCase() + task.recurring_rule.slice(1)}
          </span>
        )}
        {task.review_status && task.review_status !== 'none' && (
          <Badge
            variant={
              task.review_status === 'approved' ? 'success' :
              task.review_status === 'rejected' ? 'danger' :
              'info'
            }
          >
            <ShieldCheck className="h-3 w-3" />
            {task.review_status === 'pending_approval' ? 'Review' :
             task.review_status.charAt(0).toUpperCase() + task.review_status.slice(1)}
          </Badge>
        )}
      </div>

      {/* Expandable Description */}
      {hasDescription && (
        <div className="mt-3">
          <button
            onClick={() => setDescExpanded(!descExpanded)}
            className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors w-full text-left"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${
                descExpanded ? 'rotate-180' : ''
              }`}
            />
            Description
          </button>
          <div
            className={`overflow-hidden transition-all duration-200 ${
              descExpanded ? 'max-h-40 opacity-100 mt-1.5' : 'max-h-0 opacity-0'
            }`}
          >
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap pl-5">
              {task.description}
            </p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--color-border)]">
        {task.status === 'pending' && (
          <Button
            variant="ghost"
            size="sm"
            loading={loading}
            onClick={handleComplete}
            className="text-[var(--color-success)] hover:bg-[var(--color-success-bg)]"
          >
            <CheckCircle2 className="h-4 w-4" />
            Complete
          </Button>
        )}
        {task.status === 'completed' && (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-success)] font-medium px-2">
            <CheckCircle2 className="h-4 w-4" />
            Done
          </span>
        )}
        <div className="flex-1" />
        {isAdmin && (
          <>
            {onEdit && (
              <button
                onClick={() => onEdit(task)}
                className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-primary-light)] transition-colors opacity-0 group-hover:opacity-100"
              >
                <Edit className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors opacity-0 group-hover:opacity-100"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
