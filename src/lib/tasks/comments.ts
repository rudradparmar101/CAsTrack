'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import { logTaskActivity, notifyUsers } from '@/lib/tasks/activity';
import type { ActionResult } from '@/lib/types';
import { friendlyDbError } from '@/lib/db-errors';

/**
 * Task comment actions, shared by the staff task detail page and the client
 * portal task page (same pattern as lib/documents/actions.ts).
 *
 * Visibility model (enforced by RLS, mirrored here):
 *  - staff comments default to INTERNAL; a staff member deliberately publishes
 *    one to the portal with visible_to_client=true
 *  - client_user comments are FORCED visible_to_client=true by their INSERT
 *    policy — a client can never write to a thread staff can't fully see
 *  - client_users only ever read client-visible comments on their visible
 *    tasks (SELECT policy); staff read everything on accessible tasks
 */

function revalidateTaskViews(taskId: string) {
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath(`/portal/tasks/${taskId}`);
}

export async function addTaskCommentAction(
  taskId: string,
  content: string,
  visibleToClient: boolean
): Promise<ActionResult> {
  const { supabase, userId, profile } = await getAuthProfile();

  const trimmed = content?.trim();
  if (!taskId) return { success: false, error: 'Missing task.' };
  if (!trimmed) return { success: false, error: 'Comment cannot be empty.' };

  // Clients cannot whisper: their comments are always visible to themselves
  // and staff (the INSERT policy also enforces this).
  const isClient = profile.role === 'client_user';
  const visible = isClient ? true : visibleToClient;

  const { error } = await supabase.from('task_comments').insert({
    firm_id: profile.firm_id,
    task_id: taskId,
    content: trimmed,
    visible_to_client: visible,
    created_by: userId,
  });

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'comments' }) };
  }

  // RLS-scoped read: resolves only if the commenter can see the task.
  const { data: task } = await supabase
    .from('tasks')
    .select('title, client_id, assigned_to, created_by')
    .eq('id', taskId)
    .single();

  if (task) {
    const authorLabel = isClient ? `${profile.name} (client)` : profile.name;
    await notifyUsers({
      supabase,
      userIds: [task.assigned_to, task.created_by],
      excludeUserId: userId,
      type: 'comment_added',
      title: 'New comment on task',
      message: `${authorLabel} commented on "${task.title}"`,
      referenceId: taskId,
      referenceType: 'task',
    });

    // Staff posting a client-visible comment: the client had no in-app
    // notification surface before Phase 11 — now they do, so let them know
    // (a client can never post a comment staff can't already see, so this
    // path only applies to staff-authored, deliberately-published comments).
    if (!isClient && visible) {
      const { data: clientUser } = await supabase
        .from('profiles')
        .select('id')
        .eq('client_id', task.client_id)
        .eq('role', 'client_user')
        .maybeSingle();
      if (clientUser) {
        await notifyUsers({
          supabase,
          userIds: [clientUser.id],
          type: 'comment_added',
          title: 'New message from your CA firm',
          message: `${profile.name} commented on "${task.title}"`,
          referenceId: taskId,
          referenceType: 'task',
        });
      }
    }
  }

  await logTaskActivity({
    supabase,
    firmId: profile.firm_id,
    taskId,
    actorId: userId,
    action: 'comment_added',
    newValue: { comment: trimmed.slice(0, 100), visible_to_client: visible },
  });

  revalidateTaskViews(taskId);
  return { success: true };
}

export async function updateTaskCommentAction(
  commentId: string,
  taskId: string,
  content: string
): Promise<ActionResult> {
  const { supabase, userId, profile } = await getAuthProfile();

  const trimmed = content?.trim();
  if (!trimmed) return { success: false, error: 'Comment cannot be empty.' };

  // RLS: only the author may update ("Authors can update their own comments").
  const { error } = await supabase
    .from('task_comments')
    .update({ content: trimmed })
    .eq('id', commentId)
    .eq('created_by', userId);

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'comments' }) };
  }

  await logTaskActivity({
    supabase,
    firmId: profile.firm_id,
    taskId,
    actorId: userId,
    action: 'comment_edited',
  });

  revalidateTaskViews(taskId);
  return { success: true };
}

export async function deleteTaskCommentAction(
  commentId: string,
  taskId: string
): Promise<ActionResult> {
  const { supabase, userId, profile } = await getAuthProfile();

  // RLS: only the author may delete.
  const { error } = await supabase
    .from('task_comments')
    .delete()
    .eq('id', commentId)
    .eq('created_by', userId);

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'comments' }) };
  }

  await logTaskActivity({
    supabase,
    firmId: profile.firm_id,
    taskId,
    actorId: userId,
    action: 'comment_deleted',
  });

  revalidateTaskViews(taskId);
  return { success: true };
}
