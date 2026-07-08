import React from 'react';
import { getAuthContext } from '@/lib/auth';
import { AdminDashboard } from './admin-dashboard';
import { MemberDashboard } from './member-dashboard';

export default async function DashboardPage() {
  const { supabase, profile } = await getAuthContext();

  // Fetch tasks with joined client + assignee details
  // RLS automatically scopes: admin sees all org tasks, member sees only assigned
  const { data: tasks } = await supabase
    .from('tasks')
    .select(`
      *,
      clients:client_id(id, name),
      assigned_profile:assigned_to(id, name)
    `)
    .order('due_date', { ascending: true });

  if (profile.role === 'partner') {
    const { data: departments } = await supabase
      .from('departments')
      .select('id, name')
      .order('name');

    return <AdminDashboard tasks={tasks || []} departments={departments || []} />;
  }

  return <MemberDashboard tasks={tasks || []} />;
}

