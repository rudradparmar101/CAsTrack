'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { MEMBERS_PAGE_SIZE } from '@/lib/pagination';
import type { ActionResult, ActionResultWithData, Profile } from '@/lib/types';

export async function fetchMoreMembersAction(
  offset: number
): Promise<ActionResultWithData<Profile[]>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile) return { success: false, error: 'Profile not found' };

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: true })
    .range(offset, offset + MEMBERS_PAGE_SIZE - 1);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: (data as Profile[]) || [] };
}

export async function createTeamAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Only admins can create teams' };
  }

  const name = formData.get('name') as string;
  const description = (formData.get('description') as string) || '';
  const leadId = formData.get('lead_id') as string;

  if (!name?.trim()) {
    return { success: false, error: 'Team name is required' };
  }

  const { error } = await supabase.from('teams').insert({
    name: name.trim(),
    description: description.trim(),
    lead_id: leadId || null,
    organization_id: profile.organization_id,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/team');
  return { success: true };
}

export async function updateTeamAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Only admins can update teams' };
  }

  const id = formData.get('id') as string;
  const name = formData.get('name') as string;
  const description = formData.get('description') as string;
  const leadId = formData.get('lead_id') as string;

  if (!name?.trim()) {
    return { success: false, error: 'Team name is required' };
  }

  const { error } = await supabase
    .from('teams')
    .update({
      name: name.trim(),
      description: (description || '').trim(),
      lead_id: leadId || null,
    })
    .eq('id', id)
    .eq('organization_id', profile.organization_id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/team');
  return { success: true };
}

export async function deleteTeamAction(teamId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Only admins can delete teams' };
  }

  const { error } = await supabase
    .from('teams')
    .delete()
    .eq('id', teamId)
    .eq('organization_id', profile.organization_id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/team');
  return { success: true };
}

export async function addTeamMemberAction(
  teamId: string,
  userId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Only admins can manage team members' };
  }

  // Double check that the team exists in the admin's organization
  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('id', teamId)
    .eq('organization_id', profile.organization_id)
    .single();

  if (!team) {
    return { success: false, error: 'Team not found or access denied' };
  }

  // Double check that the target user belongs to the same organization
  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .eq('organization_id', profile.organization_id)
    .single();

  if (!targetProfile) {
    return { success: false, error: 'User not found or belongs to a different organization' };
  }

  const { error } = await supabase.from('team_members').insert({
    team_id: teamId,
    user_id: userId,
  });

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'User is already a member of this team' };
    }
    return { success: false, error: error.message };
  }

  revalidatePath('/team');
  return { success: true };
}

export async function removeTeamMemberAction(
  teamId: string,
  userId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Only admins can manage team members' };
  }

  // Ensure team belongs to organization
  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('id', teamId)
    .eq('organization_id', profile.organization_id)
    .single();

  if (!team) {
    return { success: false, error: 'Team not found or access denied' };
  }

  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/team');
  return { success: true };
}

export async function changeRoleAction(
  targetUserId: string,
  newRole: 'admin' | 'member'
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Only admins can change member roles' };
  }

  // Prevent self-demotion
  if (targetUserId === user.id && newRole === 'member') {
    return { success: false, error: 'You cannot demote yourself' };
  }

  // If demoting, check we're not removing the last admin
  if (newRole === 'member') {
    const { data: admins } = await supabase
      .from('profiles')
      .select('id')
      .eq('organization_id', profile.organization_id)
      .eq('role', 'admin');

    if (admins && admins.length <= 1) {
      return { success: false, error: 'Cannot demote the last admin. Promote another member first.' };
    }
  }

  // RLS policy "Admins can update profiles in their org" allows this
  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', targetUserId)
    .eq('organization_id', profile.organization_id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/team');
  revalidatePath('/settings');
  return { success: true };
}

export async function regenerateInviteCodeAction(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Only admins can regenerate invite codes' };
  }

  // Generate new invite code using SQL function
  const { error } = await supabase.rpc('regenerate_invite_code_for_org', {
    org_id: profile.organization_id,
  });

  // Fallback: direct update if RPC doesn't exist
  if (error) {
    const newCode = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const { error: updateError } = await supabase
      .from('organizations')
      .update({ invite_code: newCode })
      .eq('id', profile.organization_id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }
  }

  revalidatePath('/team');
  revalidatePath('/settings');
  return { success: true };
}
