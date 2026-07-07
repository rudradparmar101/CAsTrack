import { createClient } from '@/lib/supabase/server';
import type { ActivityType } from '@/lib/types';

interface LogActivityParams {
  supabase: Awaited<ReturnType<typeof createClient>>;
  taskId: string;
  organizationId: string;
  actorId: string;
  actionType: ActivityType;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}

/**
 * Logs a task activity record in the database.
 * Call this from server actions after mutations.
 * Failures are silently ignored to not block the main action.
 */
export async function logActivity({
  supabase,
  taskId,
  organizationId,
  actorId,
  actionType,
  oldValue = null,
  newValue = null,
}: LogActivityParams): Promise<void> {
  try {
    await supabase.from('task_activities').insert({
      task_id: taskId,
      organization_id: organizationId,
      actor_id: actorId,
      action_type: actionType,
      old_value: oldValue,
      new_value: newValue,
    });
  } catch {
    console.error('Failed to log activity');
  }
}
