import { createClient } from '@/lib/supabase/server';
import type { NotificationType } from '@/lib/types';

interface CreateNotificationParams {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  organizationId: string;
  type: NotificationType;
  title: string;
  message?: string;
  referenceId?: string;
  referenceType?: string;
}

/**
 * Creates a notification record in the database.
 * Call this from server actions after mutations.
 * Failures are silently ignored to not block the main action.
 */
export async function createNotification({
  supabase,
  userId,
  organizationId,
  type,
  title,
  message = '',
  referenceId,
  referenceType,
}: CreateNotificationParams): Promise<void> {
  try {
    await supabase.from('notifications').insert({
      user_id: userId,
      organization_id: organizationId,
      type,
      title,
      message,
      reference_id: referenceId || null,
      reference_type: referenceType || null,
    });
  } catch {
    // Silently ignore — notification failure should never block the main action
    console.error('Failed to create notification');
  }
}

/**
 * Creates notifications for multiple users at once.
 */
export async function createNotifications(
  supabase: Awaited<ReturnType<typeof createClient>>,
  notifications: Omit<CreateNotificationParams, 'supabase'>[]
): Promise<void> {
  if (notifications.length === 0) return;

  try {
    await supabase.from('notifications').insert(
      notifications.map((n) => ({
        user_id: n.userId,
        organization_id: n.organizationId,
        type: n.type,
        title: n.title,
        message: n.message || '',
        reference_id: n.referenceId || null,
        reference_type: n.referenceType || null,
      }))
    );
  } catch {
    console.error('Failed to create notifications');
  }
}
