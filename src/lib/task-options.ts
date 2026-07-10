import type { TaskStage, TaskPriority, RecurrenceRule } from '@/lib/types';

/**
 * Shared task constants: the stage machine map, display labels, and option
 * lists. Plain constants (like lib/ca-options.ts) so both server actions and
 * client components can import them.
 *
 * EMPLOYEE_STAGE_TRANSITIONS mirrors the handle_task_stage() trigger in
 * supabase/ca-firm/schema.sql EXACTLY — the DB is the authority; this map only
 * exists so the UI offers valid moves and server actions fail with friendly
 * messages instead of raw trigger exceptions. Partners (and the service role)
 * may force any transition, which the trigger also allows.
 */

export const TASK_STAGES: TaskStage[] = [
  'created',
  'assigned',
  'in_progress',
  'waiting_client',
  'under_review',
  'completed',
  'archived',
];

export const STAGE_META: Record<
  TaskStage,
  {
    label: string;
    /** Softer wording shown to client_users in the portal. */
    clientLabel: string;
    badge: 'default' | 'info' | 'warning' | 'success' | 'danger';
  }
> = {
  created: { label: 'Created', clientLabel: 'Being set up', badge: 'default' },
  assigned: { label: 'Assigned', clientLabel: 'Queued', badge: 'info' },
  in_progress: { label: 'In Progress', clientLabel: 'In progress', badge: 'info' },
  waiting_client: { label: 'Waiting Client', clientLabel: 'Waiting on you', badge: 'warning' },
  under_review: { label: 'Under Review', clientLabel: 'Being reviewed', badge: 'info' },
  completed: { label: 'Completed', clientLabel: 'Completed', badge: 'success' },
  archived: { label: 'Archived', clientLabel: 'Archived', badge: 'default' },
};

export function stageLabel(stage: TaskStage): string {
  return STAGE_META[stage]?.label ?? stage;
}

/** Transitions the DB trigger allows EMPLOYEES to make from each stage.
 *  in_progress -> completed carries the extra trigger condition "only when no
 *  reviewer is set" — pass hasReviewer to allowedTransitions() for that. */
export const EMPLOYEE_STAGE_TRANSITIONS: Record<TaskStage, TaskStage[]> = {
  created: ['assigned'],
  assigned: ['in_progress'],
  in_progress: ['waiting_client', 'under_review', 'completed'],
  waiting_client: ['in_progress'],
  under_review: ['completed', 'in_progress'],
  completed: ['archived'],
  archived: [],
};

/** The moves an employee may offer/attempt from `stage`. */
export function allowedTransitions(stage: TaskStage, hasReviewer: boolean): TaskStage[] {
  const next = EMPLOYEE_STAGE_TRANSITIONS[stage] ?? [];
  if (stage === 'in_progress' && hasReviewer) {
    // The trigger blocks in_progress -> completed when a reviewer is set:
    // reviewed work must go through under_review.
    return next.filter((s) => s !== 'completed');
  }
  return next;
}

/** Human labels for each valid transition button. */
export const TRANSITION_LABELS: Partial<Record<`${TaskStage}->${TaskStage}`, string>> = {
  'created->assigned': 'Mark assigned',
  'assigned->in_progress': 'Start work',
  'in_progress->waiting_client': 'Waiting on client',
  'in_progress->under_review': 'Submit for review',
  'in_progress->completed': 'Mark completed',
  'waiting_client->in_progress': 'Resume work',
  'under_review->completed': 'Approve & complete',
  'under_review->in_progress': 'Send back',
  'completed->archived': 'Archive',
};

export function transitionLabel(from: TaskStage, to: TaskStage): string {
  return TRANSITION_LABELS[`${from}->${to}`] ?? `Move to ${stageLabel(to)}`;
}

export const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export const RECURRENCE_OPTIONS: { value: RecurrenceRule; label: string }[] = [
  { value: 'none', label: 'No Recurrence' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

/** Sentence fragments for the activity feed: "<Actor> <label>". */
export const ACTIVITY_LABELS: Record<string, string> = {
  task_created: 'created this task',
  stage_changed: 'moved the stage',
  assignee_changed: 'changed the assignee',
  reviewer_changed: 'changed the reviewer',
  department_changed: 'moved the task to another department',
  priority_changed: 'changed the priority',
  due_date_changed: 'changed the due date',
  details_updated: 'updated the task details',
  visibility_changed: 'changed client portal visibility',
  comment_added: 'added a comment',
  comment_edited: 'edited a comment',
  comment_deleted: 'deleted a comment',
  document_uploaded: 'uploaded a document',
  document_version_uploaded: 'uploaded a new document version',
  document_attached: 'attached an existing document',
  document_approved: 'approved a document',
  document_rejected: 'rejected a document',
  recurring_generated: 'generated this task from a recurrence',
  filing_outcome_recorded: 'recorded the filing outcome',
};
