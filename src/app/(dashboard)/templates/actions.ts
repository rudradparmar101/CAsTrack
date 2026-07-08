'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import type { ActionResult, ChecklistItem } from '@/lib/types';

function parseChecklistItems(raw: string): ChecklistItem[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ id: crypto.randomUUID(), text, completed: false }));
}

/**
 * Mirrors requireClientsManage in clients/actions.ts: partners always pass,
 * employees need the templates.manage permission (checked via the same
 * has_permission SECURITY DEFINER RPC the RLS policies use).
 */
async function requireTemplatesManage(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof getAuthProfile>>['supabase']; firmId: string }
  | { ok: false; error: string }
> {
  const { supabase, profile } = await getAuthProfile();

  if (profile.role !== 'partner') {
    const { data: allowed } = await supabase.rpc('has_permission', {
      p_key: 'templates.manage',
    });
    if (allowed !== true) {
      return { ok: false, error: 'You do not have permission to manage task templates.' };
    }
  }
  return { ok: true, supabase, firmId: profile.firm_id };
}

export async function createTemplateAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireTemplatesManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const title = formData.get('title') as string;
  const description = (formData.get('description') as string) || '';
  const defaultPriority = (formData.get('default_priority') as string) || 'medium';
  const recurringRule = (formData.get('recurring_rule') as string) || 'none';
  const checklistRaw = (formData.get('checklist_items') as string) || '';
  const departmentId = (formData.get('department_id') as string) || null;

  if (!title?.trim()) {
    return { success: false, error: 'Template title is required' };
  }

  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from('task_templates').insert({
    firm_id: firmId,
    department_id: departmentId,
    title: title.trim(),
    description: description.trim(),
    default_priority: defaultPriority,
    recurring_rule: recurringRule,
    checklist_items: parseChecklistItems(checklistRaw),
    created_by: user!.id,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/templates');
  return { success: true };
}

export async function updateTemplateAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireTemplatesManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const id = formData.get('id') as string;
  const title = formData.get('title') as string;
  const description = (formData.get('description') as string) || '';
  const defaultPriority = (formData.get('default_priority') as string) || 'medium';
  const recurringRule = (formData.get('recurring_rule') as string) || 'none';
  const checklistRaw = (formData.get('checklist_items') as string) || '';
  const departmentId = (formData.get('department_id') as string) || null;

  if (!title?.trim()) {
    return { success: false, error: 'Template title is required' };
  }

  const { error } = await supabase
    .from('task_templates')
    .update({
      title: title.trim(),
      description: description.trim(),
      default_priority: defaultPriority,
      recurring_rule: recurringRule,
      checklist_items: parseChecklistItems(checklistRaw),
      department_id: departmentId,
    })
    .eq('id', id)
    .eq('firm_id', firmId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/templates');
  return { success: true };
}

export async function deleteTemplateAction(templateId: string): Promise<ActionResult> {
  const guard = await requireTemplatesManage();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, firmId } = guard;

  const { error } = await supabase
    .from('task_templates')
    .delete()
    .eq('id', templateId)
    .eq('firm_id', firmId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/templates');
  return { success: true };
}
