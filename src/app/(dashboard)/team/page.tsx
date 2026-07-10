import React from 'react';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import { TeamPageClient } from './team-page-client';
import { MEMBERS_PAGE_SIZE } from '@/lib/pagination';
import type { DepartmentWithMembers } from '@/lib/types';

export default async function TeamPage() {
  const { supabase, userId, profile, firm } = await getAuthContext();

  if (profile.role !== 'partner') {
    const { data: allowed } = await supabase.rpc('has_permission', { p_key: 'team.view' });
    if (allowed !== true) {
      redirect('/dashboard');
    }
  }

  // Fetch first page of firm members (for the paginated table)
  const { data: members } = await supabase
    .from('profiles')
    .select('*')
    .eq('firm_id', profile.firm_id)
    .order('created_at', { ascending: true })
    .range(0, MEMBERS_PAGE_SIZE - 1);

  // Lightweight, unpaginated list for the member-picker dropdown
  const { data: allMembersLite } = await supabase
    .from('profiles')
    .select('id, name, email')
    .eq('firm_id', profile.firm_id)
    .order('name');

  const { data: departments } = await supabase
    .from('departments')
    .select(`
      *,
      members:department_members(
        department_id,
        user_id,
        joined_at,
        profile:user_id(id, name, email, role)
      )
    `)
    .order('name');

  return (
    <TeamPageClient
      members={members || []}
      allMembersLite={allMembersLite || []}
      departments={(departments as DepartmentWithMembers[]) || []}
      firm={{ invite_code: firm.invite_code }}
      currentUserId={userId}
      initialHasMore={(members || []).length === MEMBERS_PAGE_SIZE}
    />
  );
}


