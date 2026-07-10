import React from 'react';
import { getAuthContext } from '@/lib/auth';
import { AdminDashboard } from './admin-dashboard';
import { MemberDashboard } from './member-dashboard';
import type { FirmTaskWithRefs } from '@/lib/types';

export default async function DashboardPage() {
  const { supabase, profile } = await getAuthContext();

  // Fetch tasks with joined client + department + assignee details.
  // RLS automatically scopes: partner sees all firm tasks, employee sees
  // only (assigned to them) ∪ (their departments).
  const { data: tasks } = await supabase
    .from('tasks')
    .select(`
      *,
      client:client_id(id, name),
      department:department_id(id, name),
      assignee:assigned_to(id, name)
    `)
    .order('due_date', { ascending: true });

  const typedTasks = (tasks as unknown as FirmTaskWithRefs[]) || [];

  if (profile.role === 'partner') {
    const { data: departments } = await supabase
      .from('departments')
      .select('id, name')
      .order('name');

    return <AdminDashboard tasks={typedTasks} departments={departments || []} />;
  }

  return <MemberDashboard tasks={typedTasks} />;
}

