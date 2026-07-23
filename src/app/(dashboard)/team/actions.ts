'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import { MEMBERS_PAGE_SIZE } from '@/lib/pagination';
import type { ActionResult, ActionResultWithData, Profile } from '@/lib/types';
import { friendlyDbError } from '@/lib/db-errors';

/**
 * Mirrors requireClientsManage in clients/actions.ts. `team.view`/`team.manage`
 * are seeded permissions on the CA schema (employees get team.view=true,
 * team.manage=false by default) — partners always pass both.
 */
async function requireTeamView(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof getAuthProfile>>['supabase']; firmId: string }
  | { ok: false; error: string }
> {
  const { supabase, profile } = await getAuthProfile();

  if (profile.role !== 'partner') {
    const { data: allowed } = await supabase.rpc('has_permission', { p_key: 'team.view' });
    if (allowed !== true) {
      return { ok: false, error: 'You do not have permission to view the team.' };
    }
  }
  return { ok: true, supabase, firmId: profile.firm_id };
}

async function requireTeamManage(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof getAuthProfile>>['supabase']; firmId: string }
  | { ok: false; error: string }
> {
  const { supabase, profile } = await getAuthProfile();

  if (profile.role !== 'partner') {
    const { data: allowed } = await supabase.rpc('has_permission', { p_key: 'team.manage' });
    if (allowed !== true) {
      return { ok: false, error: 'You do not have permission to manage the team.' };
    }
  }
  return { ok: true, supabase, firmId: profile.firm_id };
}

function slugifyCode(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

export async function fetchMoreMembersAction(
  offset: number
): Promise<ActionResultWithData<Profile[]>> {
  const guard = await requireTeamView();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: true })
    .range(offset, offset + MEMBERS_PAGE_SIZE - 1);

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'team' }) };
  }

  return { success: true, data: (data as Profile[]) || [] };
}

export async function createDepartmentAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireTeamManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const name = (formData.get('name') as string)?.trim();

  if (!name) {
    return { success: false, error: 'Department name is required' };
  }

  const { error } = await supabase.from('departments').insert({
    firm_id: firmId,
    code: slugifyCode(name),
    name,
  });

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'A department with a matching name already exists' };
    }
    return { success: false, error: friendlyDbError(error, { context: 'team' }) };
  }

  revalidatePath('/team');
  return { success: true };
}

export async function updateDepartmentAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireTeamManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const id = formData.get('id') as string;
  const name = (formData.get('name') as string)?.trim();

  if (!name) {
    return { success: false, error: 'Department name is required' };
  }

  const { error } = await supabase
    .from('departments')
    .update({ name })
    .eq('id', id)
    .eq('firm_id', firmId);

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'team' }) };
  }

  revalidatePath('/team');
  return { success: true };
}

export async function toggleDepartmentActiveAction(
  departmentId: string,
  isActive: boolean
): Promise<ActionResult> {
  const guard = await requireTeamManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const { error } = await supabase
    .from('departments')
    .update({ is_active: isActive })
    .eq('id', departmentId)
    .eq('firm_id', firmId);

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'team' }) };
  }

  revalidatePath('/team');
  return { success: true };
}

export async function addDepartmentMemberAction(
  departmentId: string,
  userId: string
): Promise<ActionResult> {
  const guard = await requireTeamManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const { data: department } = await supabase
    .from('departments')
    .select('id')
    .eq('id', departmentId)
    .eq('firm_id', firmId)
    .single();

  if (!department) {
    return { success: false, error: 'Department not found or access denied' };
  }

  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .eq('firm_id', firmId)
    .single();

  if (!targetProfile) {
    return { success: false, error: 'User not found or belongs to a different firm' };
  }

  const { error } = await supabase.from('department_members').insert({
    department_id: departmentId,
    user_id: userId,
  });

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'User is already a member of this department' };
    }
    return { success: false, error: friendlyDbError(error, { context: 'team' }) };
  }

  revalidatePath('/team');
  return { success: true };
}

export async function removeDepartmentMemberAction(
  departmentId: string,
  userId: string
): Promise<ActionResult> {
  const guard = await requireTeamManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const { data: department } = await supabase
    .from('departments')
    .select('id')
    .eq('id', departmentId)
    .eq('firm_id', firmId)
    .single();

  if (!department) {
    return { success: false, error: 'Department not found or access denied' };
  }

  const { error } = await supabase
    .from('department_members')
    .delete()
    .eq('department_id', departmentId)
    .eq('user_id', userId);

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'team' }) };
  }

  revalidatePath('/team');
  return { success: true };
}

export async function regenerateInviteCodeAction(): Promise<ActionResult> {
  const guard = await requireTeamManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const newCode = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const { error } = await supabase
    .from('firms')
    .update({ invite_code: newCode })
    .eq('id', firmId);

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'team' }) };
  }

  revalidatePath('/team');
  revalidatePath('/settings');
  return { success: true };
}
