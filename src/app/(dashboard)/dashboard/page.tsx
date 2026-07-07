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

  if (profile.role === 'admin') {
    // Fetch teams for workload analytics (may not exist if migration not applied)
    let teams: { id: string; name: string }[] = [];
    try {
      const { data } = await supabase
        .from('teams')
        .select('id, name')
        .order('name');
      teams = data || [];
    } catch {
      // teams table may not exist
    }

    return <AdminDashboard tasks={tasks || []} teams={teams} />;
  }

  return <MemberDashboard tasks={tasks || []} />;
}

