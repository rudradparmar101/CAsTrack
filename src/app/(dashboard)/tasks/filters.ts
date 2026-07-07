import { TASK_STAGES } from '@/lib/task-options';
import type { TaskPriority, TaskStage } from '@/lib/types';

/**
 * URL-driven filter model for the task list. Shared by:
 *  - page.tsx           (parses searchParams, builds the first-page query)
 *  - actions.ts         (re-parses filters for "Load More" pagination)
 *  - tasks-page-client  (writes filter state back into the URL)
 *
 * Plain module — no 'use server', no supabase imports — so it is safe in both
 * server and client bundles.
 */

export type TaskView = 'all' | 'open' | 'waiting_client' | 'overdue' | 'completed';
export type TaskSortKey = 'due_asc' | 'due_desc' | 'priority' | 'newest' | 'title';

export const TASK_VIEWS: { value: TaskView; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'waiting_client', label: 'Waiting Client' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
];

export const TASK_SORT_OPTIONS: { value: TaskSortKey; label: string }[] = [
  { value: 'due_asc', label: 'Due date (earliest first)' },
  { value: 'due_desc', label: 'Due date (latest first)' },
  { value: 'priority', label: 'Priority (critical first)' },
  { value: 'newest', label: 'Newest first' },
  { value: 'title', label: 'Title (A–Z)' },
];

export interface TaskFilters {
  q: string;
  view: TaskView;
  stage: TaskStage | '';
  department: string;
  client: string;
  /** Profile id, or the special values 'me' / 'unassigned'. */
  assignee: string;
  priority: TaskPriority | '';
  dueFrom: string;
  dueTo: string;
  sort: TaskSortKey;
}

export const DEFAULT_TASK_FILTERS: TaskFilters = {
  q: '',
  view: 'all',
  stage: '',
  department: '',
  client: '',
  assignee: '',
  priority: '',
  dueFrom: '',
  dueTo: '',
  sort: 'due_asc',
};

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'critical'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** Whitelist-validates raw search params (or a round-tripped filter object)
 *  into a safe TaskFilters. Unknown values fall back to defaults. */
export function parseTaskFilters(
  raw: Record<string, string | string[] | undefined>
): TaskFilters {
  const view = first(raw.view) as TaskView;
  const stage = first(raw.stage) as TaskStage;
  const priority = first(raw.priority) as TaskPriority;
  const sort = first(raw.sort) as TaskSortKey;
  const dueFrom = first(raw.dueFrom);
  const dueTo = first(raw.dueTo);

  return {
    q: first(raw.q).slice(0, 200),
    view: TASK_VIEWS.some((v) => v.value === view) ? view : 'all',
    stage: TASK_STAGES.includes(stage) ? stage : '',
    department: first(raw.department),
    client: first(raw.client),
    assignee: first(raw.assignee),
    priority: PRIORITIES.includes(priority) ? priority : '',
    dueFrom: DATE_RE.test(dueFrom) ? dueFrom : '',
    dueTo: DATE_RE.test(dueTo) ? dueTo : '',
    sort: TASK_SORT_OPTIONS.some((s) => s.value === sort) ? sort : 'due_asc',
  };
}

/** Serializes filters into search params, omitting defaults for clean URLs. */
export function taskFiltersToParams(filters: TaskFilters): URLSearchParams {
  const params = new URLSearchParams();
  (Object.keys(filters) as (keyof TaskFilters)[]).forEach((key) => {
    const value = filters[key];
    if (value && value !== DEFAULT_TASK_FILTERS[key]) params.set(key, value);
  });
  return params;
}

/** The embedded select used by every task-list query. */
export const TASK_LIST_SELECT =
  '*, client:client_id(id, name), department:department_id(id, name), assignee:assigned_to(id, name)';

/** Minimal structural view of the PostgREST builder — every method returns
 *  `this` in supabase-js v2, so the concrete builder satisfies it directly. */
interface FilterableQuery {
  eq(column: string, value: unknown): this;
  lt(column: string, value: unknown): this;
  gte(column: string, value: unknown): this;
  lte(column: string, value: unknown): this;
  is(column: string, value: null): this;
  or(filters: string): this;
  order(column: string, options?: { ascending?: boolean }): this;
}

/** Local calendar date (the DB column is DATE; "overdue" means before today). */
export function todayISODate(): string {
  const now = new Date();
  const tzAdjusted = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return tzAdjusted.toISOString().slice(0, 10);
}

/**
 * Applies filters + sort to a task query. Row-level scoping (firm, role,
 * departments) is entirely RLS's job — nothing here widens or narrows it.
 */
export function applyTaskFilters<Q extends FilterableQuery>(
  query: Q,
  filters: TaskFilters,
  currentUserId: string
): Q {
  const today = todayISODate();

  switch (filters.view) {
    case 'open':
      query = query.eq('status', 'pending');
      break;
    case 'waiting_client':
      query = query.eq('stage', 'waiting_client');
      break;
    case 'overdue':
      query = query.eq('status', 'pending').lt('due_date', today);
      break;
    case 'completed':
      query = query.eq('status', 'completed');
      break;
  }

  if (filters.stage) query = query.eq('stage', filters.stage);
  if (filters.department) query = query.eq('department_id', filters.department);
  if (filters.client) query = query.eq('client_id', filters.client);
  if (filters.priority) query = query.eq('priority', filters.priority);
  if (filters.dueFrom) query = query.gte('due_date', filters.dueFrom);
  if (filters.dueTo) query = query.lte('due_date', filters.dueTo);

  if (filters.assignee === 'me') {
    query = query.eq('assigned_to', currentUserId);
  } else if (filters.assignee === 'unassigned') {
    query = query.is('assigned_to', null);
  } else if (filters.assignee) {
    query = query.eq('assigned_to', filters.assignee);
  }

  if (filters.q) {
    // Strip PostgREST or() syntax characters so user input can't break the
    // filter expression; ilike itself is safe.
    const sanitized = filters.q.replace(/[%_,()]/g, ' ').trim();
    if (sanitized) {
      query = query.or(
        `title.ilike.%${sanitized}%,description.ilike.%${sanitized}%,period_label.ilike.%${sanitized}%`
      );
    }
  }

  switch (filters.sort) {
    case 'due_desc':
      query = query.order('due_date', { ascending: false });
      break;
    case 'priority':
      // task_priority enum is declared low→critical, so descending = critical first.
      query = query.order('priority', { ascending: false }).order('due_date', { ascending: true });
      break;
    case 'newest':
      query = query.order('created_at', { ascending: false });
      break;
    case 'title':
      query = query.order('title', { ascending: true });
      break;
    default:
      query = query.order('due_date', { ascending: true });
  }

  return query;
}
