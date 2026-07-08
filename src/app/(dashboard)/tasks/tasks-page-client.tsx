'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { format, isPast, isToday } from 'date-fns';
import { Plus, CheckSquare, Search, X, SlidersHorizontal, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { PriorityBadge } from '@/components/priority-badge';
import { StageBadge } from '@/components/task/stage-badge';
import { TaskForm } from '@/components/task/task-form';
import { createTaskAction, fetchMoreTasksAction } from './actions';
import { TASKS_PAGE_SIZE } from '@/lib/pagination';
import { TASK_STAGES, PRIORITY_OPTIONS, stageLabel } from '@/lib/task-options';
import { TASK_SORT_OPTIONS, TASK_VIEWS, taskFiltersToParams } from './filters';
import type { TaskFilters, TaskView, TaskSortKey } from './filters';
import type { FirmTaskWithRefs, FirmTaskTemplate, TaskPriority, TaskStage } from '@/lib/types';

interface TasksPageClientProps {
  tasks: FirmTaskWithRefs[];
  initialHasMore: boolean;
  filters: TaskFilters;
  clients: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  /** Departments the viewer may create tasks in (INSERT policy scoped). */
  createDepartments: { id: string; name: string }[];
  members: { id: string; name: string }[];
  templates: FirmTaskTemplate[];
  canCreate: boolean;
}

const selectClass =
  "px-3 py-1.5 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-input-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";

function dueMeta(task: FirmTaskWithRefs): { label: string; className: string } {
  const formatted = format(new Date(task.due_date), 'MMM d, yyyy');
  if (task.status === 'completed') {
    return { label: formatted, className: 'text-[var(--color-text-muted)]' };
  }
  const due = new Date(task.due_date + 'T23:59:59');
  if (isPast(due) && !isToday(due)) {
    return { label: formatted, className: 'text-[var(--color-danger)] font-medium' };
  }
  if (isToday(due)) {
    return { label: 'Today', className: 'text-[var(--color-warning)] font-medium' };
  }
  return { label: formatted, className: 'text-[var(--color-text)]' };
}

export function TasksPageClient({
  tasks,
  initialHasMore,
  filters,
  clients,
  departments,
  createDepartments,
  members,
  templates,
  canCreate,
}: TasksPageClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showFilters, setShowFilters] = useState(
    !!(
      filters.stage ||
      filters.department ||
      filters.client ||
      filters.assignee ||
      filters.priority ||
      filters.dueFrom ||
      filters.dueTo
    )
  );

  // Pagination — reset when the server hands us a fresh first page
  // (filter change or revalidatePath after a mutation).
  const [taskList, setTaskList] = useState(tasks);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [prevTasks, setPrevTasks] = useState(tasks);
  if (tasks !== prevTasks) {
    setPrevTasks(tasks);
    setTaskList(tasks);
    setHasMore(initialHasMore);
  }

  // Search box: local echo + debounced URL write.
  const [searchText, setSearchText] = useState(filters.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyFilters = (next: Partial<TaskFilters>) => {
    const merged = { ...filters, ...next };
    const qs = taskFiltersToParams(merged).toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  const handleSearchChange = (value: string) => {
    setSearchText(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => applyFilters({ q: value.trim() }), 400);
  };
  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const clearFilters = () => {
    setSearchText('');
    startTransition(() => router.replace(pathname, { scroll: false }));
  };

  const activeFilterCount = [
    filters.stage,
    filters.department,
    filters.client,
    filters.assignee,
    filters.priority,
    filters.dueFrom,
    filters.dueTo,
  ].filter(Boolean).length;
  const hasActiveFilters =
    activeFilterCount > 0 || !!filters.q || filters.view !== 'all' || filters.sort !== 'due_asc';

  const handleLoadMore = async () => {
    setLoadingMore(true);
    const result = await fetchMoreTasksAction(filters, taskList.length);
    if (result.success && result.data) {
      setTaskList((prev) => [...prev, ...result.data!]);
      setHasMore(result.data.length === TASKS_PAGE_SIZE);
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
            Tasks
            {isPending && (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-muted)]" />
            )}
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {taskList.length}
            {hasMore ? '+' : ''} task{taskList.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4" />
            New Task
          </Button>
        )}
      </div>

      {/* Search + filter bar */}
      <Card padding="md">
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search title, description, period..."
                className="w-full pl-9 pr-9 py-2.5 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-input-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition-colors"
              />
              {searchText && (
                <button
                  onClick={() => handleSearchChange('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* View tabs */}
            <div className="flex items-center rounded-lg border border-[var(--color-border)] p-1 bg-[var(--color-muted)] shrink-0 overflow-x-auto">
              {TASK_VIEWS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => applyFilters({ view: opt.value as TaskView })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                    filters.view === opt.value
                      ? 'bg-[var(--color-surface)] shadow-sm text-[var(--color-text)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Advanced filters toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-all shrink-0 ${
                showFilters || activeFilterCount > 0
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="h-4.5 min-w-[18px] px-1 flex items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-foreground)] text-[10px] font-bold leading-none">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* Advanced filters */}
          {showFilters && (
            <div className="flex flex-wrap gap-3 pt-2 border-t border-[var(--color-border)] animate-fade-in">
              <FilterField label="Department">
                <select
                  value={filters.department}
                  onChange={(e) => applyFilters({ department: e.target.value })}
                  className={selectClass}
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Stage">
                <select
                  value={filters.stage}
                  onChange={(e) => applyFilters({ stage: e.target.value as TaskStage | '' })}
                  className={selectClass}
                >
                  <option value="">All Stages</option>
                  {TASK_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {stageLabel(s)}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Client">
                <select
                  value={filters.client}
                  onChange={(e) => applyFilters({ client: e.target.value })}
                  className={selectClass}
                >
                  <option value="">All Clients</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Assignee">
                <select
                  value={filters.assignee}
                  onChange={(e) => applyFilters({ assignee: e.target.value })}
                  className={selectClass}
                >
                  <option value="">Anyone</option>
                  <option value="me">Assigned to me</option>
                  <option value="unassigned">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Priority">
                <select
                  value={filters.priority}
                  onChange={(e) => applyFilters({ priority: e.target.value as TaskPriority | '' })}
                  className={selectClass}
                >
                  <option value="">All Priorities</option>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Due between">
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={filters.dueFrom}
                    onChange={(e) => applyFilters({ dueFrom: e.target.value })}
                    className={selectClass}
                  />
                  <span className="text-xs text-[var(--color-text-muted)]">–</span>
                  <input
                    type="date"
                    value={filters.dueTo}
                    onChange={(e) => applyFilters({ dueTo: e.target.value })}
                    className={selectClass}
                  />
                </div>
              </FilterField>

              <FilterField label="Sort by">
                <select
                  value={filters.sort}
                  onChange={(e) => applyFilters({ sort: e.target.value as TaskSortKey })}
                  className={selectClass}
                >
                  {TASK_SORT_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </FilterField>

              {hasActiveFilters && (
                <div className="flex items-end">
                  <button
                    onClick={clearFilters}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] rounded-md transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Task table */}
      {taskList.length > 0 ? (
        <>
          <Card padding="none">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <Th>Task</Th>
                    <Th className="hidden md:table-cell">Client</Th>
                    <Th className="hidden lg:table-cell">Department</Th>
                    <Th className="hidden sm:table-cell">Assignee</Th>
                    <Th>Due</Th>
                    <Th className="hidden sm:table-cell">Priority</Th>
                    <Th>Stage</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {taskList.map((task) => {
                    const due = dueMeta(task);
                    return (
                      <tr
                        key={task.id}
                        className="hover:bg-[var(--color-accent-muted)] transition-colors"
                      >
                        <td className="px-4 py-3.5">
                          <Link
                            href={`/tasks/${task.id}`}
                            className="text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors inline-flex items-center gap-1.5"
                          >
                            {task.title}
                            {!task.visible_to_client && (
                              <EyeOff
                                className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0"
                                aria-label="Hidden from the client portal"
                              />
                            )}
                          </Link>
                          {task.period_label && (
                            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                              {task.period_label}
                            </p>
                          )}
                          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 md:hidden">
                            {task.client?.name}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 hidden md:table-cell">
                          <span className="text-sm text-[var(--color-text-secondary)]">
                            {task.client?.name || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 hidden lg:table-cell">
                          <span className="text-sm text-[var(--color-text-secondary)]">
                            {task.department?.name || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 hidden sm:table-cell">
                          <span className="text-sm text-[var(--color-text-secondary)]">
                            {task.assignee?.name || (
                              <span className="italic text-[var(--color-text-muted)]">
                                Unassigned
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`text-sm ${due.className}`}>{due.label}</span>
                        </td>
                        <td className="px-4 py-3.5 hidden sm:table-cell">
                          <PriorityBadge priority={task.priority} size="sm" />
                        </td>
                        <td className="px-4 py-3.5">
                          <StageBadge stage={task.stage} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="secondary" loading={loadingMore} onClick={handleLoadMore}>
                Load More
              </Button>
            </div>
          )}
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<CheckSquare className="h-12 w-12" />}
            title={hasActiveFilters ? 'No matching tasks' : 'No tasks yet'}
            description={
              hasActiveFilters
                ? 'Try adjusting your search or filters.'
                : canCreate
                ? 'Create your first task to start tracking compliance work.'
                : 'Tasks assigned to you or your departments will appear here.'
            }
            action={
              hasActiveFilters ? (
                <Button variant="secondary" onClick={clearFilters} size="sm">
                  <X className="h-4 w-4" />
                  Clear Filters
                </Button>
              ) : canCreate ? (
                <Button onClick={() => setShowCreateModal(true)}>
                  <Plus className="h-4 w-4" />
                  New Task
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      {/* Create modal */}
      {canCreate && (
        <Modal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Create New Task"
          maxWidth="lg"
        >
          <TaskForm
            clients={clients}
            departments={createDepartments}
            members={members}
            templates={templates}
            action={createTaskAction}
            onSuccess={() => setShowCreateModal(false)}
            onCancel={() => setShowCreateModal(false)}
          />
        </Modal>
      )}
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider px-4 py-3 ${className}`}
    >
      {children}
    </th>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider block">
        {label}
      </label>
      {children}
    </div>
  );
}
