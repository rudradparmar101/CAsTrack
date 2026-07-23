'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import type {
  ActionResult,
  ActionResultWithData,
  PermissionCatalogEntry,
  ResolvedPermissionRow,
  RolePermission,
  UserPermission,
} from '@/lib/types';
import { friendlyDbError } from '@/lib/db-errors';

/**
 * Per-employee permissions editor (Phase 13.3, migration 009). PARTNER-ONLY
 * for both reads and writes — a strictly stronger guard than team.manage,
 * mirrors dsc/actions.ts's requireDscManage() (get_user_role() at the RLS
 * layer, no permission-catalog key of its own).
 *
 * The RLS on user_permissions (see migration 009 + schema.sql §11.8) already
 * enforces: partner-only writes, target must be a same-firm 'employee' row
 * (never self, never another partner, never a client_user) — proven
 * empirically by scripts/verify/12-permissions-ui.mjs (25/25). The checks
 * below are the app-layer half of this codebase's dual-layer house style,
 * not the security boundary — they exist to fail fast with a friendly
 * message before the DB would reject anyway.
 */

type SupabaseClient = Awaited<ReturnType<typeof getAuthProfile>>['supabase'];

type Guard =
  | { ok: true; supabase: SupabaseClient; userId: string; firmId: string }
  | { ok: false; error: string };

async function requirePartner(): Promise<Guard> {
  const { supabase, userId, profile } = await getAuthProfile();
  if (profile.role !== 'partner') {
    return { ok: false, error: 'Only a partner can view or change permissions.' };
  }
  return { ok: true, supabase, userId, firmId: profile.firm_id };
}

/** Same-firm, role='employee' check — mirrors profile_in_my_firm(user_id,
 *  'employee') at the RLS layer. Never allows a partner (including the
 *  caller themselves) or a client_user as a target. */
async function requireEmployeeTarget(
  supabase: SupabaseClient,
  firmId: string,
  targetUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: target } = await supabase
    .from('profiles')
    .select('id, role, firm_id')
    .eq('id', targetUserId)
    .single();

  if (!target || target.firm_id !== firmId || target.role !== 'employee') {
    return { ok: false, error: 'That user is not an employee in your firm.' };
  }
  return { ok: true };
}

export async function fetchEmployeePermissionsAction(
  employeeUserId: string
): Promise<ActionResultWithData<ResolvedPermissionRow[]>> {
  const guard = await requirePartner();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const targetCheck = await requireEmployeeTarget(supabase, firmId, employeeUserId);
  if (!targetCheck.ok) return { success: false, error: targetCheck.error };

  const [{ data: catalog, error: catalogErr }, { data: defaults, error: defaultsErr }, { data: overrides, error: overridesErr }] =
    await Promise.all([
      supabase.from('permissions').select('key, description, category').order('category').order('key'),
      supabase.from('role_permissions').select('role, permission_key, allowed').eq('role', 'employee'),
      supabase.from('user_permissions').select('user_id, permission_key, granted, granted_by, created_at').eq('user_id', employeeUserId),
    ]);

  if (catalogErr || defaultsErr || overridesErr) {
    return { success: false, error: (catalogErr || defaultsErr || overridesErr)?.message || 'Failed to load permissions.' };
  }

  const defaultByKey = new Map<string, boolean>(
    ((defaults as RolePermission[]) || []).map((d) => [d.permission_key, d.allowed])
  );
  const overrideByKey = new Map<string, boolean>(
    ((overrides as UserPermission[]) || []).map((o) => [o.permission_key, o.granted])
  );

  const rows: ResolvedPermissionRow[] = ((catalog as PermissionCatalogEntry[]) || []).map((entry) => {
    const roleDefault = defaultByKey.get(entry.key) ?? false;
    const override = overrideByKey.has(entry.key) ? overrideByKey.get(entry.key)! : null;
    return {
      key: entry.key,
      description: entry.description,
      category: entry.category,
      roleDefault,
      override,
      effective: override ?? roleDefault,
    };
  });

  return { success: true, data: rows };
}

export async function grantPermissionAction(employeeUserId: string, key: string): Promise<ActionResult> {
  const guard = await requirePartner();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, firmId } = guard;

  const targetCheck = await requireEmployeeTarget(supabase, firmId, employeeUserId);
  if (!targetCheck.ok) return { success: false, error: targetCheck.error };

  const { data: existing } = await supabase
    .from('user_permissions')
    .select('user_id')
    .eq('user_id', employeeUserId)
    .eq('permission_key', key)
    .maybeSingle();

  const { data, error } = existing
    ? await supabase
        .from('user_permissions')
        .update({ granted: true, granted_by: userId })
        .eq('user_id', employeeUserId)
        .eq('permission_key', key)
        .select('user_id')
        .single()
    : await supabase
        .from('user_permissions')
        .insert({ user_id: employeeUserId, permission_key: key, granted: true, granted_by: userId })
        .select('user_id')
        .single();

  if (error || !data) {
    return { success: false, error: friendlyDbError(error, { context: 'permissions' }) };
  }

  revalidatePath('/team');
  return { success: true };
}

export async function revokePermissionAction(employeeUserId: string, key: string): Promise<ActionResult> {
  const guard = await requirePartner();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, firmId } = guard;

  const targetCheck = await requireEmployeeTarget(supabase, firmId, employeeUserId);
  if (!targetCheck.ok) return { success: false, error: targetCheck.error };

  const { data: existing } = await supabase
    .from('user_permissions')
    .select('user_id')
    .eq('user_id', employeeUserId)
    .eq('permission_key', key)
    .maybeSingle();

  const { data, error } = existing
    ? await supabase
        .from('user_permissions')
        .update({ granted: false, granted_by: userId })
        .eq('user_id', employeeUserId)
        .eq('permission_key', key)
        .select('user_id')
        .single()
    : await supabase
        .from('user_permissions')
        .insert({ user_id: employeeUserId, permission_key: key, granted: false, granted_by: userId })
        .select('user_id')
        .single();

  if (error || !data) {
    return { success: false, error: friendlyDbError(error, { context: 'permissions' }) };
  }

  revalidatePath('/team');
  return { success: true };
}

/** Distinct from revoke: removes the override row entirely, returning the
 *  key to whatever role_permissions says for 'employee' — NOT the same
 *  action as revokePermissionAction (which pins granted=false explicitly). */
export async function resetPermissionToDefaultAction(employeeUserId: string, key: string): Promise<ActionResult> {
  const guard = await requirePartner();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const targetCheck = await requireEmployeeTarget(supabase, firmId, employeeUserId);
  if (!targetCheck.ok) return { success: false, error: targetCheck.error };

  const { error } = await supabase
    .from('user_permissions')
    .delete()
    .eq('user_id', employeeUserId)
    .eq('permission_key', key);

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'permissions' }) };
  }

  revalidatePath('/team');
  return { success: true };
}
