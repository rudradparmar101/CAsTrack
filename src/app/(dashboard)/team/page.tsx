import React from 'react';
import { UsersRound } from 'lucide-react';
import { getAuthContext } from '@/lib/auth';
import { EmptyState } from '@/components/ui/empty-state';
import { TeamPageClient } from './team-page-client';
import { MEMBERS_PAGE_SIZE } from '@/lib/pagination';
import type { DepartmentWithMembers } from '@/lib/types';

export default async function TeamPage() {
  const { supabase, userId, profile, firm } = await getAuthContext();

  const isPartner = profile.role === 'partner';
  const canView = isPartner || (await supabase.rpc('has_permission', { p_key: 'team.view' })).data === true;

  if (!canView) {
    return (
      <EmptyState
        icon={<UsersRound className="h-10 w-10" />}
        title="No access"
        description="You don't have permission to view the team page."
      />
    );
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
      currentUserIsPartner={isPartner}
      initialHasMore={(members || []).length === MEMBERS_PAGE_SIZE}
    />
  );
}


