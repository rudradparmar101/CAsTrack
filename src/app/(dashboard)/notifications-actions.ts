'use server';

import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/types';
import { friendlyDbError } from '@/lib/db-errors';

export async function markNotificationReadAction(
  notificationId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  // RLS enforces user_id = auth.uid() for UPDATE
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('user_id', user.id);

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'notifications' }) };
  }

  return { success: true };
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false);

  if (error) {
    return { success: false, error: friendlyDbError(error, { context: 'notifications' }) };
  }

  return { success: true };
}
