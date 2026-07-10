'use client';

import React from 'react';
import { isPast, isToday, differenceInDays } from 'date-fns';
import { ListTodo, AlertTriangle, Clock, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { TaskSummaryCard } from '@/components/task/task-summary-card';
import { EmptyState } from '@/components/ui/empty-state';
import type { FirmTaskWithRefs } from '@/lib/types';

interface MemberDashboardProps {
  tasks: FirmTaskWithRefs[];
}

export function MemberDashboard({ tasks }: MemberDashboardProps) {
  const pendingTasks = tasks.filter((t) => t.status !== 'completed');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const completionRate = tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0;

  const overdueTasks = pendingTasks.filter((t) => {
    const due = new Date(t.due_date + 'T23:59:59');
    return isPast(due) && !isToday(due);
  });

  const dueSoonTasks = pendingTasks.filter((t) => {
    const due = new Date(t.due_date + 'T23:59:59');
    if (isPast(due) && !isToday(due)) return false;
    return differenceInDays(due, new Date()) <= 3;
  });

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">My Tasks</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          {pendingTasks.length} task{pendingTasks.length !== 1 ? 's' : ''} to complete
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-[var(--color-accent-muted)] text-[var(--color-accent)] flex items-center justify-center">
              <ListTodo className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{pendingTasks.length}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">Pending</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-[var(--color-danger-bg)] text-[var(--color-danger)] flex items-center justify-center">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{overdueTasks.length}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">Overdue</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-[var(--color-warning-bg)] text-[var(--color-warning)] flex items-center justify-center">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{dueSoonTasks.length}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">Due Soon</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-[var(--color-success-bg)] text-[var(--color-success)] flex items-center justify-center">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{completionRate}%</p>
              <p className="text-xs text-[var(--color-text-secondary)]">Complete</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Overdue */}
      {overdueTasks.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-2 w-2 rounded-full bg-[var(--color-danger)]" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
            <h2 className="text-lg font-semibold text-[var(--color-danger)]">
              Overdue ({overdueTasks.length})
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overdueTasks.map((task) => (
              <TaskSummaryCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}

      {/* Pending Tasks */}
      {pendingTasks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            To Do
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pendingTasks.map((task) => (
              <TaskSummaryCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[var(--color-success)] mb-4">
            Completed ({completedTasks.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {completedTasks.map((task) => (
              <TaskSummaryCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {tasks.length === 0 && (
        <Card>
          <EmptyState
            icon={<ListTodo className="h-12 w-12" />}
            title="No tasks assigned"
            description="You don't have any tasks assigned yet."
          />
        </Card>
      )}
    </div>
  );
}
