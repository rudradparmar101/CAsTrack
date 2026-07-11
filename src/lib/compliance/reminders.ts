import type { SupabaseClient } from '@supabase/supabase-js';
import { differenceInCalendarDays, format } from 'date-fns';
import { sendEmail } from '@/lib/email/resend';
import { statutoryReminderEmail, waitingClientNagEmail } from '@/lib/email/templates';

/**
 * Reminder scheduler (Phase 11) — channel-agnostic (email today, WhatsApp
 * later per docs/ROADMAP.md) escalating reminders, run by the
 * /api/cron/send-reminders route on a daily cadence. Mirrors
 * lib/compliance/generation.ts's shape: pure functions over a service-role
 * client, one per firm, safe to re-run (idempotency via task_activities
 * rather than a new table/column — same house style as Phase 10's filing
 * outcomes).
 */

const REMINDER_TIERS = [7, 3, 1] as const;
const WAITING_CLIENT_NAG_AFTER_DAYS = 3;

/** `tasks.statutory_due_date` is a plain DATE column ('YYYY-MM-DD'). Parsing
 *  that bare string with `new Date()` reads it as UTC midnight, which
 *  `differenceInCalendarDays` then buckets by LOCAL calendar day — east of
 *  UTC that silently shifts every comparison back a day. Same fix already
 *  used elsewhere in this codebase for due_date math (e.g. task-header.tsx's
 *  `+ 'T23:59:59'`): anchor to local midnight instead of parsing bare. */
function parseDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

export interface ReminderSummary {
  statutorySent: number;
  statutorySkippedNoContact: number;
  nagsSent: number;
  nagsSkippedNoContact: number;
  errors: string[];
}

interface ClientContact {
  email: string;
  name: string;
}

/** Primary authorized person's email, falling back to the client's own email
 *  — independent of whether the client has a portal login (statutory
 *  reminders should reach the firm's real-world contact either way). */
async function resolveClientContact(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientContact | null> {
  const [{ data: client }, { data: primaryPerson }] = await Promise.all([
    supabase.from('clients').select('name, email').eq('id', clientId).single(),
    supabase
      .from('client_authorized_persons')
      .select('name, email')
      .eq('client_id', clientId)
      .eq('is_primary', true)
      .maybeSingle(),
  ]);

  if (primaryPerson?.email) return { email: primaryPerson.email, name: primaryPerson.name };
  if (client?.email) return { email: client.email, name: client.name };
  return null;
}

async function findClientPortalUserId(
  supabase: SupabaseClient,
  clientId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('client_id', clientId)
    .eq('role', 'client_user')
    .maybeSingle();
  return data?.id ?? null;
}

/** Idempotency check: has a reminder with this exact tier already been
 *  logged for this task at/after `since` (defaults to "ever")? */
async function reminderAlreadySent(
  supabase: SupabaseClient,
  taskId: string,
  tier: string,
  since?: string
): Promise<boolean> {
  let query = supabase
    .from('task_activities')
    .select('id')
    .eq('task_id', taskId)
    .eq('action_type', 'reminder_sent')
    .contains('new_value', { tier });
  if (since) query = query.gte('created_at', since);
  const { data } = await query.limit(1);
  return (data?.length ?? 0) > 0;
}

async function logReminderSent(
  supabase: SupabaseClient,
  firmId: string,
  taskId: string,
  actorId: string,
  tier: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await supabase.from('task_activities').insert({
    firm_id: firmId,
    task_id: taskId,
    actor_id: actorId,
    action_type: 'reminder_sent',
    new_value: { tier, ...extra },
  });
}

async function notifyPortalUser(
  supabase: SupabaseClient,
  firmId: string,
  userId: string,
  title: string,
  message: string,
  taskId: string
): Promise<void> {
  // Service-role client: insert directly rather than the create_notification
  // RPC (which is for RLS-scoped callers; the cron route already bypasses RLS).
  await supabase.from('notifications').insert({
    firm_id: firmId,
    user_id: userId,
    type: 'due_date_approaching',
    title,
    message,
    reference_id: taskId,
    reference_type: 'task',
  });
}

/** T-7/T-3/T-1 statutory due-date reminders, one firm at a time. */
export async function sendStatutoryReminders(
  supabase: SupabaseClient,
  firmId: string,
  actorId: string,
  firmName: string,
  siteUrl: string,
  referenceDate: Date = new Date()
): Promise<Pick<ReminderSummary, 'statutorySent' | 'statutorySkippedNoContact' | 'errors'>> {
  const summary = { statutorySent: 0, statutorySkippedNoContact: 0, errors: [] as string[] };

  const maxTier = Math.max(...REMINDER_TIERS);
  const rangeEnd = new Date(referenceDate);
  rangeEnd.setDate(rangeEnd.getDate() + maxTier);

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, client_id, period_label, statutory_due_date, stage')
    .eq('firm_id', firmId)
    .not('statutory_due_date', 'is', null)
    .not('stage', 'in', '(completed,archived)')
    .gte('statutory_due_date', format(referenceDate, 'yyyy-MM-dd'))
    .lte('statutory_due_date', format(rangeEnd, 'yyyy-MM-dd'));

  for (const task of tasks || []) {
    const daysRemaining = differenceInCalendarDays(parseDateOnly(task.statutory_due_date), referenceDate);
    if (!(REMINDER_TIERS as readonly number[]).includes(daysRemaining)) continue;

    const tier = `T-${daysRemaining}`;
    try {
      if (await reminderAlreadySent(supabase, task.id, tier)) continue;

      const contact = await resolveClientContact(supabase, task.client_id);
      if (!contact) {
        summary.statutorySkippedNoContact += 1;
        continue;
      }

      const portalUserId = await findClientPortalUserId(supabase, task.client_id);
      const portalUrl = portalUserId ? `${siteUrl}/portal/tasks/${task.id}` : undefined;

      await sendEmail({
        to: contact.email,
        subject: `Reminder: ${task.title} is due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`,
        html: statutoryReminderEmail({
          clientName: contact.name,
          firmName,
          taskTitle: task.title,
          periodLabel: task.period_label,
          dueDate: format(parseDateOnly(task.statutory_due_date), 'd MMM yyyy'),
          daysRemaining,
          portalUrl,
        }),
      });

      if (portalUserId) {
        await notifyPortalUser(
          supabase,
          firmId,
          portalUserId,
          `${task.title} is due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`,
          `Due ${format(parseDateOnly(task.statutory_due_date), 'd MMM yyyy')}`,
          task.id
        );
      }

      await logReminderSent(supabase, firmId, task.id, actorId, tier, {
        due_date: task.statutory_due_date,
      });
      summary.statutorySent += 1;
    } catch (err) {
      summary.errors.push(`statutory reminder for task ${task.id}: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  return summary;
}

/** Nags the client on tasks stuck in waiting_client for
 *  WAITING_CLIENT_NAG_AFTER_DAYS+ days, re-nagging if the wait continues
 *  past the last nag (each nag is scoped to the CURRENT waiting_client
 *  entry via `since`, so resolving and re-entering the stage resets it). */
export async function sendWaitingClientNags(
  supabase: SupabaseClient,
  firmId: string,
  actorId: string,
  firmName: string,
  siteUrl: string,
  referenceDate: Date = new Date()
): Promise<Pick<ReminderSummary, 'nagsSent' | 'nagsSkippedNoContact' | 'errors'>> {
  const summary = { nagsSent: 0, nagsSkippedNoContact: 0, errors: [] as string[] };

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, client_id')
    .eq('firm_id', firmId)
    .eq('stage', 'waiting_client');

  for (const task of tasks || []) {
    try {
      const { data: lastEntry } = await supabase
        .from('task_stage_history')
        .select('created_at')
        .eq('task_id', task.id)
        .eq('to_stage', 'waiting_client')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lastEntry) continue;

      const daysWaiting = differenceInCalendarDays(referenceDate, new Date(lastEntry.created_at));
      if (daysWaiting < WAITING_CLIENT_NAG_AFTER_DAYS) continue;

      if (await reminderAlreadySent(supabase, task.id, 'waiting_client_nag', lastEntry.created_at)) {
        continue;
      }

      const contact = await resolveClientContact(supabase, task.client_id);
      if (!contact) {
        summary.nagsSkippedNoContact += 1;
        continue;
      }

      const portalUserId = await findClientPortalUserId(supabase, task.client_id);
      const portalUrl = portalUserId ? `${siteUrl}/portal/tasks/${task.id}` : undefined;

      await sendEmail({
        to: contact.email,
        subject: `Action needed: ${task.title}`,
        html: waitingClientNagEmail({
          clientName: contact.name,
          firmName,
          taskTitle: task.title,
          daysWaiting,
          portalUrl,
        }),
      });

      if (portalUserId) {
        await notifyPortalUser(
          supabase,
          firmId,
          portalUserId,
          `Still waiting on you: ${task.title}`,
          `It's been ${daysWaiting} days — please check what's needed.`,
          task.id
        );
      }

      await logReminderSent(supabase, firmId, task.id, actorId, 'waiting_client_nag', {
        entered_waiting_at: lastEntry.created_at,
        days_waiting: daysWaiting,
      });
      summary.nagsSent += 1;
    } catch (err) {
      summary.errors.push(`waiting_client nag for task ${task.id}: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  return summary;
}
