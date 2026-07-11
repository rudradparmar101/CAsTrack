import { createClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/resend';
import { notificationEmail } from '@/lib/email/templates';
import type { NotificationType, TaskActivityAction } from '@/lib/types';

type Supabase = Awaited<ReturnType<typeof createClient>>;

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
}

/** Resolves the recipient's email + role-appropriate task URL, then sends.
 *  Best-effort: an email failure must never surface to the caller. */
async function emailForNotification(params: {
  supabase: Supabase;
  userId: string;
  title: string;
  message: string;
  referenceId?: string;
  referenceType?: string;
}): Promise<void> {
  const { supabase, userId, title, message, referenceId, referenceType } = params;
  try {
    const { data: recipient } = await supabase
      .from('profiles')
      .select('email, role')
      .eq('id', userId)
      .single();
    if (!recipient?.email) return;

    let ctaUrl: string | undefined;
    if (referenceType === 'task' && referenceId) {
      const base = recipient.role === 'client_user' ? '/portal/tasks' : '/tasks';
      ctaUrl = `${siteUrl()}${base}/${referenceId}`;
    }

    await sendEmail({
      to: recipient.email,
      subject: title,
      html: notificationEmail({ title, message, ctaUrl }),
    });
  } catch (err) {
    console.error('Failed to send notification email:', err);
  }
}

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
  /** Phase 11: also email the recipient (assignment / review / rejection /
   *  completion — the notification types the roadmap calls out; comments and
   *  routine document uploads deliberately stay in-app-only to avoid noise). */
  sendEmail?: boolean;
}): Promise<void> {
  const { supabase, userId, type, title, message, referenceId, referenceType, sendEmail: email } = params;
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

  if (email) {
    await emailForNotification({ supabase, userId, title, message, referenceId, referenceType });
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
  sendEmail?: boolean;
}): Promise<void> {
  const { userIds, excludeUserId, ...rest } = params;
  const recipients = new Set(
    userIds.filter((id): id is string => !!id && id !== excludeUserId)
  );
  await Promise.all(
    Array.from(recipients).map((userId) => notifyUser({ ...rest, userId }))
  );
}
