import React from 'react';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import { TeamPageClient } from './team-page-client';
import { MEMBERS_PAGE_SIZE } from '@/lib/pagination';
import type { TeamWithDetails } from '@/lib/types';

export default async function TeamPage() {
  const { supabase, userId, profile, organization } = await getAuthContext();

  if (profile.role !== 'admin') {
    redirect('/dashboard');
  }

  // Fetch first page of org members (for the paginated table)
  const { data: members } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true })
    .range(0, MEMBERS_PAGE_SIZE - 1);

  // Lightweight, unpaginated list for team lead / member-picker dropdowns
  const { data: allMembersLite } = await supabase
    .from('profiles')
    .select('id, name, email')
    .order('name');

  // Fetch teams with lead and members (may not exist if migration not applied)
  let teams: TeamWithDetails[] = [];
  try {
    const { data } = await supabase
      .from('teams')
      .select(`
        *,
        lead:lead_id(id, name, email),
        members:team_members(
          team_id,
          user_id,
          joined_at,
          profile:user_id(id, name, email, role)
        )
      `)
      .order('name');
    teams = (data as TeamWithDetails[]) || [];
  } catch {
    // teams table may not exist
  }

  return (
    <TeamPageClient
      members={members || []}
      allMembersLite={allMembersLite || []}
      teams={teams}
      organization={{ invite_code: organization.invite_code }}
      currentUserId={userId}
      initialHasMore={(members || []).length === MEMBERS_PAGE_SIZE}
    />
  );
}


