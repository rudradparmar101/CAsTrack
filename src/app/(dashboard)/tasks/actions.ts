'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import { logTaskActivity, notifyUser, notifyUsers } from '@/lib/tasks/activity';
import { getNextDueDate } from '@/lib/recurrence';
import { TASKS_PAGE_SIZE } from '@/lib/pagination';
import {
  TASK_STAGES,
  allowedTransitions,
  stageLabel,
  PRIORITY_OPTIONS,
  RECURRENCE_OPTIONS,
} from '@/lib/task-options';
import { TASK_LIST_SELECT, applyTaskFilters, parseTaskFilters } from './filters';
import type { TaskFilters } from './filters';
import type {
  ActionResult,
  ActionResultWithData,
  FirmTaskWithRefs,
  Profile,
  TaskStage,
} from '@/lib/types';

/**
 * Task server actions for the CA schema (Phase 4).
 *
 * Every mutation re-checks permissions at the APP layer (same has_permission
 * RPC the RLS policies call) on top of RLS — the DeadlineTracker §8.4 pattern
 * fixed in Phase 3 is kept here. The stage machine itself is enforced by the
 * handle_task_stage() DB trigger; the app-layer transition check below only
 * exists to produce friendly errors and hide invalid buttons, never to
 * replace the trigger.
 */

type Supabase = Awaited<ReturnType<typeof getAuthProfile>>['supabase'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function requireStaff(): Promise<
  | { ok: true; supabase: Supabase; userId: string; profile: Profile }
  | { ok: false; error: string }
> {
  const { supabase, userId, profile } = await getAuthProfile();
  if (profile.role === 'client_user') {
    return { ok: false, error: 'Not allowed.' };
  }
  return { ok: true, supabase, userId, profile };
}

/** Partner ⇒ always true; employee ⇒ resolved by the has_permission RPC. */
async function hasPerm(supabase: Supabase, profile: Profile, key: string): Promise<boolean> {
  if (profile.role === 'partner') return true;
  const { data } = await supabase.rpc('has_permission', { p_key: key });
  return data === true;
}

function opt(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s === '' ? null : s;
}

/** PostgREST returns PGRST116 when an update matched no row — with RLS in
 *  play that means "you can see this task but cannot modify it". */
function rlsFriendly(message?: string): string {
  if (!message || message.includes('0 rows') || message.includes('multiple (or no) rows')) {
    return 'You do not have permission to modify this task.';
  }
  return message;
}

function revalidateTaskViews(taskId?: string) {
  revalidatePath('/tasks');
  revalidatePath('/dashboard');
  revalidatePath('/portal');
  if (taskId) {
    revalidatePath(`/tasks/${taskId}`);
    revalidatePath(`/portal/tasks/${taskId}`);
  }
}

// ---- list pagination -----------------------------------------------------

export async function fetchMoreTasksAction(
  rawFilters: TaskFilters,
  offset: number
): Promise<ActionResultWithData<FirmTaskWithRefs[]>> {
  const { supabase, userId } = await getAuthProfile();

  // Round-trip through the whitelist parser: the filters object crossed the
  // client boundary and must not be trusted verbatim.
  const filters = parseTaskFilters(rawFilters as unknown as Record<string, string>);

  let query = supabase.from('tasks').select(TASK_LIST_SELECT);
  query = applyTaskFilters(query, filters, userId);

  const { data, error } = await query.range(offset, offset + TASKS_PAGE_SIZE - 1);

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, data: (data as unknown as FirmTaskWithRefs[]) || [] };
}

// ---- create / update -----------------------------------------------------

function parseTaskFields(formData: FormData):
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: string } {
  const title = opt(formData.get('title'));
  if (!title) return { ok: false, error: 'Task title is required.' };

  const dueDate = opt(formData.get('due_date'));
  if (!dueDate || !DATE_RE.test(dueDate)) {
    return { ok: false, error: 'A valid due date is required.' };
  }
  const statutoryDueDate = opt(formData.get('statutory_due_date'));
  if (statutoryDueDate && !DATE_RE.test(statutoryDueDate)) {
    return { ok: false, error: 'Statutory due date must be a valid date.' };
  }

  const priority = opt(formData.get('priority')) || 'medium';
  if (!PRIORITY_OPTIONS.some((o) => o.value === priority)) {
    return { ok: false, error: 'Please choose a valid priority.' };
  }
  const recurringRule = opt(formData.get('recurring_rule')) || 'none';
  if (!RECURRENCE_OPTIONS.some((o) => o.value === recurringRule)) {
    return { ok: false, error: 'Please choose a valid recurrence.' };
  }

  return {
    ok: true,
    values: {
      title,
      description: (formData.get('description') as string | null)?.trim() ?? '',
      due_date: dueDate,
      statutory_due_date: statutoryDueDate,
      period_label: opt(formData.get('period_label')),
      priority,
      recurring_rule: recurringRule,
      // Unchecked checkboxes don't submit; the form mirrors 'false' explicitly.
      visible_to_client: formData.get('visible_to_client') !== 'false',
    },
  };
}

export async function createTaskAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireStaff();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, profile } = guard;

  if (!(await hasPerm(supabase, profile, 'tasks.create'))) {
    return { success: false, error: 'You do not have permission to create tasks.' };
  }

  const fields = parseTaskFields(formData);
  if (!fields.ok) return { success: false, error: fields.error };

  const clientId = opt(formData.get('client_id'));
  if (!clientId) return { success: false, error: 'Please choose a client.' };
  const departmentId = opt(formData.get('department_id'));
  if (!departmentId) return { success: false, error: 'Please choose a department.' };

  const assignedTo = opt(formData.get('assigned_to'));
  const reviewerId = opt(formData.get('reviewer_id'));

  // Stage is deliberately not set: it defaults to 'created', and the DB
  // trigger auto-advances to 'assigned' when assigned_to is present.
  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      ...fields.values,
      firm_id: profile.firm_id,
      client_id: clientId,
      department_id: departmentId,
      assigned_to: assignedTo,
      reviewer_id: reviewerId,
      created_by: userId,
    })
    .select('id, title')
    .single();

  if (error || !task) {
    return { success: false, error: error?.message || 'Failed to create the task.' };
  }

  await logTaskActivity({
    supabase,
    firmId: profile.firm_id,
    taskId: task.id,
    actorId: userId,
    action: 'task_created',
    newValue: {
      title: fields.values.title,
      priority: fields.values.priority,
      due_date: fields.values.due_date,
    },
  });

  if (assignedTo && assignedTo !== userId) {
    await notifyUser({
      supabase,
      userId: assignedTo,
      type: 'task_assigned',
      title: 'New task assigned to you',
      message: `You have been assigned: ${task.title}`,
      referenceId: task.id,
      referenceType: 'task',
    });
  }

  revalidateTaskViews();
  return { success: true };
}

export async function updateTaskAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireStaff();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, profile } = guard;

  const id = opt(formData.get('id'));
  if (!id) return { success: false, error: 'Missing task id.' };

  const fields = parseTaskFields(formData);
  if (!fields.ok) return { success: false, error: fields.error };

  // RLS-scoped read: resolves only if the viewer can see the task. Update
  // rights (assigned / department+permission / partner) are enforced by the
  // UPDATE policies — a read-only viewer gets a clean error below.
  const { data: oldTask } = await supabase
    .from('tasks')
    .select('id, title, description, due_date, statutory_due_date, period_label, priority, recurring_rule, visible_to_client')
    .eq('id', id)
    .single();

  if (!oldTask) return { success: false, error: 'Task not found or access denied.' };

  // .select().single() so an RLS-denied update (zero rows) fails loudly
  // instead of silently reporting success.
  const { data: updatedRow, error } = await supabase
    .from('tasks')
    .update(fields.values)
    .eq('id', id)
    .eq('firm_id', profile.firm_id)
    .select('id')
    .single();

  if (error || !updatedRow) {
    return { success: false, error: rlsFriendly(error?.message) };
  }

  const v = fields.values;
  const log = (
    action: 'priority_changed' | 'due_date_changed' | 'visibility_changed' | 'details_updated',
    oldValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null
  ) =>
    logTaskActivity({
      supabase, firmId: profile.firm_id, taskId: id, actorId: userId,
      action, oldValue, newValue,
    });

  if (v.priority !== oldTask.priority) {
    await log('priority_changed', { priority: oldTask.priority }, { priority: v.priority });
  }
  if (v.due_date !== oldTask.due_date) {
    await log('due_date_changed', { due_date: oldTask.due_date }, { due_date: v.due_date });
  }
  if (v.visible_to_client !== oldTask.visible_to_client) {
    await log(
      'visibility_changed',
      { visible_to_client: oldTask.visible_to_client },
      { visible_to_client: v.visible_to_client }
    );
  }
  if (
    v.title !== oldTask.title ||
    v.description !== oldTask.description ||
    v.period_label !== oldTask.period_label ||
    v.recurring_rule !== oldTask.recurring_rule ||
    v.statutory_due_date !== oldTask.statutory_due_date
  ) {
    await log('details_updated', null, null);
  }

  revalidateTaskViews(id);
  return { success: true };
}

// ---- stage machine ---------------------------------------------------------

/** Core transition, used by changeTaskStageAction. The DB trigger is the
 *  authority; the app-layer check only produces friendly errors for
 *  employees. */
async function changeStageCore(
  supabase: Supabase,
  userId: string,
  profile: Profile,
  taskId: string,
  toStage: TaskStage,
  note?: string
): Promise<ActionResult> {
  if (!TASK_STAGES.includes(toStage)) {
    return { success: false, error: 'Invalid stage.' };
  }

  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (!task) return { success: false, error: 'Task not found or access denied.' };
  const current = task.stage as TaskStage;

  if (current === toStage) {
    return { success: false, error: `The task is already in ${stageLabel(toStage)}.` };
  }

  // Employees are held to the arrows; partners may force any transition
  // (mirrors handle_task_stage() exactly — the trigger still re-validates).
  if (profile.role !== 'partner') {
    const allowed = allowedTransitions(current, !!task.reviewer_id);
    if (!allowed.includes(toStage)) {
      return {
        success: false,
        error: `Moving from ${stageLabel(current)} to ${stageLabel(toStage)} is not allowed. Ask a partner if this needs a manual override.`,
      };
    }
  }

  const { data: updatedRow, error } = await supabase
    .from('tasks')
    .update({ stage: toStage })
    .eq('id', taskId)
    .eq('firm_id', profile.firm_id)
    .select('id')
    .single();

  if (error || !updatedRow) {
    // Surface the trigger's message in a readable form.
    if (error?.message.includes('Invalid stage transition')) {
      return {
        success: false,
        error: `The database rejected this transition (${stageLabel(current)} → ${stageLabel(toStage)}).`,
      };
    }
    return { success: false, error: rlsFriendly(error?.message) };
  }

  // The stage-history row is written by the DB trigger; this feeds the
  // human-readable activity stream (and carries the optional note).
  await logTaskActivity({
    supabase,
    firmId: profile.firm_id,
    taskId,
    actorId: userId,
    action: 'stage_changed',
    oldValue: { stage: stageLabel(current) },
    newValue: { stage: stageLabel(toStage), ...(note ? { note } : {}) },
  });

  // Stage-specific notifications.
  if (toStage === 'under_review' && task.reviewer_id) {
    await notifyUsers({
      supabase,
      userIds: [task.reviewer_id],
      excludeUserId: userId,
      type: 'approval_requested',
      title: 'Task submitted for review',
      message: `${profile.name} submitted "${task.title}" for your review`,
      referenceId: taskId,
      referenceType: 'task',
    });
  }
  if (current === 'under_review' && toStage === 'in_progress') {
    await notifyUsers({
      supabase,
      userIds: [task.assigned_to],
      excludeUserId: userId,
      type: 'task_rejected',
      title: 'Task sent back',
      message: `"${task.title}" was sent back for rework${note ? `: ${note}` : ''}`,
      referenceId: taskId,
      referenceType: 'task',
    });
  }
  if (toStage === 'completed') {
    await notifyUsers({
      supabase,
      userIds: [task.created_by],
      excludeUserId: userId,
      type: 'task_completed',
      title: 'Task completed',
      message: `"${task.title}" has been marked as complete`,
      referenceId: taskId,
      referenceType: 'task',
    });
    if (current === 'under_review') {
      await notifyUsers({
        supabase,
        userIds: [task.assigned_to],
        excludeUserId: userId,
        type: 'task_approved',
        title: 'Task approved',
        message: `"${task.title}" was approved by ${profile.name}`,
        referenceId: taskId,
        referenceType: 'task',
      });
    }

    // Recurring compliance work: completing one occurrence spawns the next.
    // Best-effort — RLS (tasks.create + department membership for employees)
    // may legitimately deny the insert; that must not fail the completion.
    // Statutory tasks (source='statutory', Phase 9+) are excluded: those are
    // calendar-generated by the Phase 10 engine, not completion-chained — a
    // stalled cycle must not silently lose its next occurrence.
    if (task.recurring_rule && task.recurring_rule !== 'none' && task.source !== 'statutory') {
      const nextDue = getNextDueDate(task.due_date, task.recurring_rule);
      if (nextDue) {
        const nextStatutory = task.statutory_due_date
          ? getNextDueDate(task.statutory_due_date, task.recurring_rule)
          : null;
        const { data: nextTask, error: recurError } = await supabase
          .from('tasks')
          .insert({
            firm_id: profile.firm_id,
            client_id: task.client_id,
            department_id: task.department_id,
            title: task.title,
            description: task.description || '',
            priority: task.priority,
            recurring_rule: task.recurring_rule,
            parent_task_id: task.parent_task_id || taskId,
            due_date: nextDue,
            statutory_due_date: nextStatutory,
            period_label: null, // periods differ each cycle; staff relabel
            assigned_to: task.assigned_to,
            reviewer_id: task.reviewer_id,
            visible_to_client: task.visible_to_client,
            created_by: userId,
          })
          .select('id')
          .single();

        if (nextTask) {
          await logTaskActivity({
            supabase,
            firmId: profile.firm_id,
            taskId: nextTask.id,
            actorId: userId,
            action: 'recurring_generated',
            newValue: { from_task: taskId, due_date: nextDue, rule: task.recurring_rule },
          });
          await notifyUsers({
            supabase,
            userIds: [task.assigned_to],
            excludeUserId: userId,
            type: 'task_assigned',
            title: 'Recurring task created',
            message: `Next occurrence of "${task.title}" is due ${nextDue}`,
            referenceId: nextTask.id,
            referenceType: 'task',
          });
        } else if (recurError) {
          console.error('Failed to generate recurring task:', recurError.message);
        }
      }
    }
  }

  revalidateTaskViews(taskId);
  return { success: true };
}

export async function changeTaskStageAction(
  taskId: string,
  toStage: TaskStage,
  note?: string
): Promise<ActionResult> {
  const guard = await requireStaff();
  if (!guard.ok) return { success: false, error: guard.error };
  return changeStageCore(
    guard.supabase,
    guard.userId,
    guard.profile,
    taskId,
    toStage,
    note?.trim() || undefined
  );
}

// ---- assignment ------------------------------------------------------------

export async function updateTaskAssignmentAction(
  taskId: string,
  formData: FormData
): Promise<ActionResult> {
  const guard = await requireStaff();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, profile } = guard;

  if (!(await hasPerm(supabase, profile, 'tasks.assign'))) {
    return { success: false, error: 'You do not have permission to assign tasks.' };
  }

  const { data: oldTask } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, reviewer_id, department_id')
    .eq('id', taskId)
    .single();

  if (!oldTask) return { success: false, error: 'Task not found or access denied.' };

  const assignedTo = opt(formData.get('assigned_to'));
  const reviewerId = opt(formData.get('reviewer_id'));
  const departmentId = opt(formData.get('department_id'));
  if (!departmentId) return { success: false, error: 'A task must belong to a department.' };

  const assigneeChanged = assignedTo !== oldTask.assigned_to;
  const reviewerChanged = reviewerId !== oldTask.reviewer_id;
  const departmentChanged = departmentId !== oldTask.department_id;

  if (!assigneeChanged && !reviewerChanged && !departmentChanged) {
    return { success: true };
  }

  // Note: RLS decides who may perform this update (partner anywhere; employee
  // only per the task UPDATE policies) — the tasks.assign check above is the
  // app-layer gate. The 'created' → 'assigned' auto-advance happens in the DB.
  const { data: updatedRow, error } = await supabase
    .from('tasks')
    .update({ assigned_to: assignedTo, reviewer_id: reviewerId, department_id: departmentId })
    .eq('id', taskId)
    .eq('firm_id', profile.firm_id)
    .select('id')
    .single();

  if (error || !updatedRow) {
    return { success: false, error: rlsFriendly(error?.message) };
  }

  // Resolve names so the activity feed reads well without extra lookups.
  const profileIds = [oldTask.assigned_to, assignedTo, oldTask.reviewer_id, reviewerId].filter(
    (id): id is string => !!id
  );
  const [{ data: people }, { data: departments }] = await Promise.all([
    profileIds.length
      ? supabase.from('profiles').select('id, name').in('id', profileIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    departmentChanged
      ? supabase.from('departments').select('id, name').in('id', [oldTask.department_id, departmentId])
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const personName = (id: string | null) =>
    (id && people?.find((p) => p.id === id)?.name) || (id ? 'Unknown' : 'Unassigned');
  const departmentName = (id: string) => departments?.find((d) => d.id === id)?.name || 'Unknown';

  if (assigneeChanged) {
    await logTaskActivity({
      supabase, firmId: profile.firm_id, taskId, actorId: userId,
      action: 'assignee_changed',
      oldValue: { assignee: personName(oldTask.assigned_to) },
      newValue: { assignee: personName(assignedTo) },
    });
    if (assignedTo && assignedTo !== userId) {
      await notifyUser({
        supabase,
        userId: assignedTo,
        type: 'task_assigned',
        title: 'Task assigned to you',
        message: `You have been assigned: ${oldTask.title}`,
        referenceId: taskId,
        referenceType: 'task',
      });
    }
  }
  if (reviewerChanged) {
    await logTaskActivity({
      supabase, firmId: profile.firm_id, taskId, actorId: userId,
      action: 'reviewer_changed',
      oldValue: { reviewer: personName(oldTask.reviewer_id) },
      newValue: { reviewer: personName(reviewerId) },
    });
  }
  if (departmentChanged) {
    await logTaskActivity({
      supabase, firmId: profile.firm_id, taskId, actorId: userId,
      action: 'department_changed',
      oldValue: { department: departmentName(oldTask.department_id) },
      newValue: { department: departmentName(departmentId) },
    });
  }

  revalidateTaskViews(taskId);
  return { success: true };
}

// ---- visibility ------------------------------------------------------------

export async function toggleTaskVisibilityAction(
  taskId: string,
  visible: boolean
): Promise<ActionResult> {
  const guard = await requireStaff();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, userId, profile } = guard;

  const { data: updated, error } = await supabase
    .from('tasks')
    .update({ visible_to_client: visible })
    .eq('id', taskId)
    .eq('firm_id', profile.firm_id)
    .select('id')
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Task not found or access denied.' };
  }

  await logTaskActivity({
    supabase, firmId: profile.firm_id, taskId, actorId: userId,
    action: 'visibility_changed',
    oldValue: { visible_to_client: !visible },
    newValue: { visible_to_client: visible },
  });

  revalidateTaskViews(taskId);
  return { success: true };
}

// ---- delete ----------------------------------------------------------------

export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  const guard = await requireStaff();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase, profile } = guard;

  // Partner-only, matching the single DELETE policy on tasks. Documents
  // survive deletion (documents.task_id is ON DELETE SET NULL).
  if (profile.role !== 'partner') {
    return { success: false, error: 'Only partners can delete tasks.' };
  }

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .eq('firm_id', profile.firm_id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidateTaskViews();
  return { success: true };
}
