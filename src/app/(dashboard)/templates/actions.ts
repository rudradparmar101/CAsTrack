'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult, ChecklistItem } from '@/lib/types';

function parseChecklistItems(raw: string): ChecklistItem[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ id: crypto.randomUUID(), text, completed: false }));
}

export async function createTemplateAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Only admins can create task templates' };
  }

  const title = formData.get('title') as string;
  const description = (formData.get('description') as string) || '';
  const defaultPriority = (formData.get('default_priority') as string) || 'medium';
  const recurringRule = (formData.get('recurring_rule') as string) || 'none';
  const checklistRaw = (formData.get('checklist_items') as string) || '';

  if (!title?.trim()) {
    return { success: false, error: 'Template title is required' };
  }

  const { error } = await supabase.from('task_templates').insert({
    organization_id: profile.organization_id,
    title: title.trim(),
    description: description.trim(),
    default_priority: defaultPriority,
    recurring_rule: recurringRule,
    checklist_items: parseChecklistItems(checklistRaw),
    created_by: user.id,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/templates');
  return { success: true };
}

export async function updateTemplateAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Only admins can update task templates' };
  }

  const id = formData.get('id') as string;
  const title = formData.get('title') as string;
  const description = (formData.get('description') as string) || '';
  const defaultPriority = (formData.get('default_priority') as string) || 'medium';
  const recurringRule = (formData.get('recurring_rule') as string) || 'none';
  const checklistRaw = (formData.get('checklist_items') as string) || '';

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
    })
    .eq('id', id)
    .eq('organization_id', profile.organization_id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/templates');
  return { success: true };
}

export async function deleteTemplateAction(templateId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Only admins can delete task templates' };
  }

  const { error } = await supabase
    .from('task_templates')
    .delete()
    .eq('id', templateId)
    .eq('organization_id', profile.organization_id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/templates');
  return { success: true };
}
