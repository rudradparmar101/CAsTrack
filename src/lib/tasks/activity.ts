import { createClient } from '@/lib/supabase/server';
import type { NotificationType, TaskActivityAction } from '@/lib/types';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * CA-schema replacements for the legacy lib/activity.ts / lib/notifications.ts
 * helpers (which still write organization_id and are kept only for unported
 * pages). Both helpers are fire-and-forget: audit/notification failures must
 * never block the main mutation.
 */

export async function logTaskActivity(params: {
  supabase: Supabase;
  firmId: string;
  taskId: string;
  actorId: string;
  action: TaskActivityAction;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}): Promise<void> {
  const { supabase, firmId, taskId, actorId, action, oldValue = null, newValue = null } = params;
  try {
    // RLS: "Task participants can log their own activity" — covers staff on
    // accessible tasks AND client_users on their visible tasks.
    const { error } = await supabase.from('task_activities').insert({
      firm_id: firmId,
      task_id: taskId,
      actor_id: actorId,
      action_type: action,
      old_value: oldValue,
      new_value: newValue,
    });
    if (error) console.error('Failed to log task activity:', error.message);
  } catch {
    console.error('Failed to log task activity');
  }
}

/**
 * Notify a firm member via the create_notification() SECURITY DEFINER RPC.
 * The RPC validates the recipient is in the caller's firm, and is the ONLY
 * insert path that works for client_users (they have no INSERT policy on
 * notifications) — so we use it for staff too and keep one code path.
 */
export async function notifyUser(params: {
  supabase: Supabase;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  referenceId?: string;
  referenceType?: string;
}): Promise<void> {
  const { supabase, userId, type, title, message, referenceId, referenceType } = params;
  try {
    const { error } = await supabase.rpc('create_notification', {
      p_user_id: userId,
      p_type: type,
      p_title: title,
      p_message: message,
      p_reference_id: referenceId ?? null,
      p_reference_type: referenceType ?? null,
    });
    if (error) console.error('Failed to create notification:', error.message);
  } catch {
    console.error('Failed to create notification');
  }
}

/** Notify several users, skipping duplicates and the actor themselves. */
export async function notifyUsers(params: {
  supabase: Supabase;
  userIds: (string | null | undefined)[];
  excludeUserId?: string;
  type: NotificationType;
  title: string;
  message: string;
  referenceId?: string;
  referenceType?: string;
}): Promise<void> {
  const { userIds, excludeUserId, ...rest } = params;
  const recipients = new Set(
    userIds.filter((id): id is string => !!id && id !== excludeUserId)
  );
  await Promise.all(
    Array.from(recipients).map((userId) => notifyUser({ ...rest, userId }))
  );
}
