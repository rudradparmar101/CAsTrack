import React from 'react';
import { getAuthContext } from '@/lib/auth';
import { TASKS_PAGE_SIZE } from '@/lib/pagination';
import { TasksPageClient } from './tasks-page-client';
import { TASK_LIST_SELECT, applyTaskFilters, parseTaskFilters } from './filters';
import type { FirmTaskWithRefs, FirmTaskTemplate } from '@/lib/types';

interface TasksPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const { supabase, userId, profile } = await getAuthContext();
  const filters = parseTaskFilters(await searchParams);

  const isPartner = profile.role === 'partner';

  // Row scoping is RLS's job: partners see the whole firm, employees see
  // (assigned to them) ∪ (their departments' tasks). Filters only narrow.
  let query = supabase.from('tasks').select(TASK_LIST_SELECT);
  query = applyTaskFilters(query, filters, userId);

  const [
    { data: tasks },
    { data: clients },
    { data: departments },
    { data: members },
    { data: templates },
    canCreate,
    myDepartmentIds,
  ] = await Promise.all([
    query.range(0, TASKS_PAGE_SIZE - 1),
    supabase.from('clients').select('id, name').eq('is_active', true).order('name'),
    supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('profiles')
      .select('id, name')
      .in('role', ['partner', 'employee'])
      .eq('is_active', true)
      .order('name'),
    supabase.from('task_templates').select('*').order('title'),
    isPartner
      ? true
      : supabase
          .rpc('has_permission', { p_key: 'tasks.create' })
          .then((r) => r.data === true),
    isPartner
      ? null
      : supabase
          .rpc('get_user_department_ids')
          .then((r) => (r.data as string[] | null) ?? []),
  ]);

  // The tasks INSERT policy lets employees create only inside their own
  // departments — scope the create-form options to match.
  const allDepartments = departments || [];
  const createDepartments = isPartner
    ? allDepartments
    : allDepartments.filter((d) => (myDepartmentIds ?? []).includes(d.id));

  return (
    <TasksPageClient
      tasks={(tasks as unknown as FirmTaskWithRefs[]) || []}
      initialHasMore={(tasks || []).length === TASKS_PAGE_SIZE}
      filters={filters}
      clients={clients || []}
      departments={allDepartments}
      createDepartments={createDepartments}
      members={members || []}
      templates={(templates as FirmTaskTemplate[]) || []}
      canCreate={canCreate === true}
    />
  );
}
