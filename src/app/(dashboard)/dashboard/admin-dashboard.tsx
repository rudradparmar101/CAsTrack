'use client';

import React from 'react';
import { isPast, isToday, differenceInDays, format } from 'date-fns';
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  ListTodo,
  TrendingUp,
  Users,
  BarChart3,
  Briefcase,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TaskCard } from '@/components/task-card';
import { EmptyState } from '@/components/ui/empty-state';
import type { TaskWithDetails, TaskPriority } from '@/lib/types';

interface AdminDashboardProps {
  tasks: TaskWithDetails[];
  departments: { id: string; name: string }[];
}

const priorityConfig: Record<TaskPriority, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: 'text-[var(--color-danger)]', bg: 'bg-[var(--color-danger)]' },
  high: { label: 'High', color: 'text-[var(--color-warning)]', bg: 'bg-[var(--color-warning)]' },
  medium: { label: 'Medium', color: 'text-[var(--color-info)]', bg: 'bg-[var(--color-info)]' },
  low: { label: 'Low', color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--color-text-muted)]' },
};

export function AdminDashboard({ tasks, departments }: AdminDashboardProps) {
  const overdueTasks = tasks.filter((t) => {
    if (t.status === 'completed') return false;
    const due = new Date(t.due_date + 'T23:59:59');
    return isPast(due) && !isToday(due);
  });

  const dueSoonTasks = tasks.filter((t) => {
    if (t.status === 'completed') return false;
    const due = new Date(t.due_date + 'T23:59:59');
    if (isPast(due) && !isToday(due)) return false;
    return differenceInDays(due, new Date()) <= 7;
  });

  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const pendingTasks = tasks.filter((t) => t.status !== 'completed');
  const completionRate = tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0;

  // Priority breakdown (pending only)
  const priorityBreakdown = (['critical', 'high', 'medium', 'low'] as TaskPriority[]).map((p) => {
    const count = pendingTasks.filter((t) => t.priority === p).length;
    return { priority: p, count, pct: pendingTasks.length > 0 ? Math.round((count / pendingTasks.length) * 100) : 0 };
  });

  // Department workload
  const departmentWorkload = departments.map((department) => {
    const deptTasks = pendingTasks.filter((t) => t.department_id === department.id);
    const deptCompleted = completedTasks.filter((t) => t.department_id === department.id);
    return { ...department, pending: deptTasks.length, completed: deptCompleted.length, total: deptTasks.length + deptCompleted.length };
  }).filter((d) => d.total > 0).sort((a, b) => b.pending - a.pending);

  // Unassigned tasks
  const unassignedTasks = pendingTasks.filter((t) => !t.assigned_to);

  // Client workload (top 5 by pending tasks)
  const clientMap = new Map<string, { name: string; pending: number; completed: number }>();
  for (const t of tasks) {
    const cName = t.clients?.name || 'Unknown';
    const cId = t.client_id;
    if (!clientMap.has(cId)) {
      clientMap.set(cId, { name: cName, pending: 0, completed: 0 });
    }
    const entry = clientMap.get(cId)!;
    if (t.status === 'completed') entry.completed++;
    else entry.pending++;
  }
  const topClients = Array.from(clientMap.values())
    .sort((a, b) => b.pending - a.pending)
    .slice(0, 5);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Dashboard</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Overview of all deadlines across your team.
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<ListTodo className="h-5 w-5" />}
          label="Total Tasks"
          value={tasks.length}
          color="text-[var(--color-accent)]"
          bg="bg-[var(--color-accent-muted)]"
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Overdue"
          value={overdueTasks.length}
          color="text-[var(--color-danger)]"
          bg="bg-[var(--color-danger-bg)]"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Due This Week"
          value={dueSoonTasks.length}
          color="text-[var(--color-warning)]"
          bg="bg-[var(--color-warning-bg)]"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Completed"
          value={completedTasks.length}
          color="text-[var(--color-success)]"
          bg="bg-[var(--color-success-bg)]"
        />
      </div>

      {/* Analytics Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Completion Rate */}
        <Card padding="lg">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-[var(--color-text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Completion Rate</h3>
          </div>
          <div className="flex items-end gap-3 mb-3">
            <span className="text-3xl font-bold text-[var(--color-text)]">{completionRate}%</span>
            <span className="text-xs text-[var(--color-text-muted)] pb-1">
              {completedTasks.length} of {tasks.length} tasks
            </span>
          </div>
          <div className="h-2.5 bg-[var(--color-muted)] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-success)] rounded-full transition-all duration-700 ease-out"
              style={{ width: `${completionRate}%` }}
            />
          </div>
        </Card>

        {/* Priority Breakdown */}
        <Card padding="lg">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-4 w-4 text-[var(--color-text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--color-text)]">By Priority</h3>
            <span className="text-xs text-[var(--color-text-muted)] ml-auto">{pendingTasks.length} pending</span>
          </div>
          <div className="space-y-3">
            {priorityBreakdown.map(({ priority, count, pct }) => {
              const cfg = priorityConfig[priority];
              return (
                <div key={priority} className="flex items-center gap-3">
                  <span className={`text-xs font-medium w-14 ${cfg.color}`}>{cfg.label}</span>
                  <div className="flex-1 h-2 bg-[var(--color-muted)] rounded-full overflow-hidden">
                    <div
                      className={`h-full ${cfg.bg} rounded-full transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)] w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Top Clients */}
        <Card padding="lg">
          <div className="flex items-center gap-2 mb-4">
            <Briefcase className="h-4 w-4 text-[var(--color-text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Client Workload</h3>
          </div>
          {topClients.length > 0 ? (
            <div className="space-y-2.5">
              {topClients.map((client) => (
                <div key={client.name} className="flex items-center justify-between">
                  <span className="text-sm text-[var(--color-text)] truncate flex-1 mr-3">
                    {client.name}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {client.pending > 0 && (
                      <Badge variant="warning">{client.pending} pending</Badge>
                    )}
                    {client.completed > 0 && (
                      <Badge variant="success">{client.completed} done</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)] text-center py-3">No tasks yet</p>
          )}
        </Card>
      </div>

      {/* Department Workload */}
      {departmentWorkload.length > 0 && (
        <Card padding="lg">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-[var(--color-text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Department Workload</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {departmentWorkload.map((department) => (
              <div
                key={department.id}
                className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] px-4 py-3"
              >
                <div className="h-9 w-9 rounded-lg bg-[var(--color-accent-muted)] text-[var(--color-accent)] flex items-center justify-center text-xs font-bold">
                  {department.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)] truncate">{department.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-[var(--color-warning)]">{department.pending} pending</span>
                    <span className="text-xs text-[var(--color-text-muted)]">·</span>
                    <span className="text-xs text-[var(--color-success)]">{department.completed} done</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Overdue Section */}
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
              <TaskCard key={task.id} task={task} isAdmin />
            ))}
          </div>
        </section>
      )}

      {/* Due This Week */}
      {dueSoonTasks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[var(--color-warning)] mb-4">
            Due This Week ({dueSoonTasks.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dueSoonTasks.map((task) => (
              <TaskCard key={task.id} task={task} isAdmin />
            ))}
          </div>
        </section>
      )}

      {/* Unassigned */}
      {unassignedTasks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[var(--color-text-muted)] mb-4">
            Unassigned ({unassignedTasks.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {unassignedTasks.map((task) => (
              <TaskCard key={task.id} task={task} isAdmin />
            ))}
          </div>
        </section>
      )}

      {/* Completed */}
      {completedTasks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[var(--color-success)] mb-4">
            Completed ({completedTasks.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {completedTasks.slice(0, 6).map((task) => (
              <TaskCard key={task.id} task={task} isAdmin />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {tasks.length === 0 && (
        <Card>
          <EmptyState
            icon={<ListTodo className="h-12 w-12" />}
            title="No tasks yet"
            description="Create your first task to start tracking deadlines for your clients."
          />
        </Card>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg ${bg} ${color} flex items-center justify-center`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-[var(--color-text)]">{value}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
        </div>
      </div>
    </Card>
  );
}
