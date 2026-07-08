// ============================================
// Core Types for DeadlineTracker
// ============================================

// ---- Enums ----

// 'admin' | 'member' are legacy DeadlineTracker roles, kept in the union only so
// not-yet-ported dashboard code still type-checks. The CA schema uses the first three;
// super_admin is NOT a profile role (it's membership in platform_admins).
export type UserRole = 'partner' | 'employee' | 'client_user' | 'admin' | 'member';
export type TaskStatus = 'pending' | 'completed' | 'pending_approval' | 'approved' | 'rejected';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type RecurrenceRule = 'none' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type ReviewStatus = 'none' | 'pending_approval' | 'approved' | 'rejected';

export type NotificationType =
  | 'task_assigned'
  | 'comment_added'
  | 'mentioned_in_comment'
  | 'due_date_approaching'
  | 'task_overdue'
  | 'task_completed'
  | 'approval_requested'
  | 'task_approved'
  | 'task_rejected'
  | 'document_uploaded';

export type ActivityType =
  | 'task_created'
  | 'assignment_changed'
  | 'status_changed'
  | 'priority_changed'
  | 'due_date_changed'
  | 'comment_added'
  | 'comment_edited'
  | 'comment_deleted'
  | 'attachment_uploaded'
  | 'attachment_deleted'
  | 'task_completed'
  | 'task_approved'
  | 'task_rejected'
  | 'reviewer_changed'
  | 'team_assigned'
  | 'recurring_generated';

// ---- Database Row Types ----

export interface Firm {
  id: string;
  name: string;
  invite_code: string;
  frn: string | null;
  gstin: string | null;
  pan: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: Record<string, unknown> | null;
  storage_used_bytes: number;
  created_at: string;
  updated_at: string;
}

/** @deprecated Legacy DeadlineTracker name — the CA schema calls this `firms`. Use `Firm`. */
export type Organization = Firm;

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  firm_id: string;
  /** Set ONLY for role='client_user' — the one client record this login is bound to. */
  client_id: string | null;
  designation: string | null;
  phone: string | null;
  is_active: boolean;
  /** @deprecated Legacy DeadlineTracker column; the CA schema uses `firm_id`. */
  organization_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ClientPortalInvitation {
  id: string;
  firm_id: string;
  client_id: string;
  email: string;
  token: string;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export type BusinessType =
  | 'individual'
  | 'huf'
  | 'proprietorship'
  | 'partnership'
  | 'llp'
  | 'opc'
  | 'pvt_ltd'
  | 'public_ltd'
  | 'trust'
  | 'society'
  | 'aop_boi'
  | 'government'
  | 'other';

export type AddressType = 'registered' | 'business' | 'branch' | 'warehouse' | 'other';

export type DocApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Client {
  id: string;
  firm_id: string;
  name: string;
  trade_name: string | null;
  business_type: BusinessType;
  gstin: string | null;
  pan: string | null;
  tan: string | null;
  cin: string | null;
  incorporation_date: string | null;
  gst_registration_date: string | null;
  email: string | null;
  phone: string | null;
  /** Internal notes — never exposed to client_user UI. */
  notes: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ClientAddress {
  id: string;
  firm_id: string;
  client_id: string;
  type: AddressType;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  state_code: string | null;
  pincode: string | null;
  country: string;
  created_at: string;
  updated_at: string;
}

export interface ClientAuthorizedPerson {
  id: string;
  firm_id: string;
  client_id: string;
  name: string;
  designation: string | null;
  pan: string | null;
  din: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientDocument {
  id: string;
  firm_id: string;
  client_id: string;
  task_id: string | null;
  name: string;
  doc_type: string | null;
  approval_status: DocApprovalStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  current_version: number;
  visible_to_client: boolean;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentVersion {
  id: string;
  firm_id: string;
  document_id: string;
  version_number: number;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number;
  note: string | null;
  uploaded_by: string;
  created_at: string;
}

/** Version + uploader join; uploader is null when the viewer's RLS hides the
 *  profile (e.g. a client_user looking at a staff upload). */
export interface DocumentVersionWithUploader extends DocumentVersion {
  uploader: Pick<Profile, 'id' | 'name'> | null;
  /** 1-hour signed download URL, generated server-side. */
  signedUrl?: string | null;
}

export interface ClientDocumentWithDetails extends ClientDocument {
  uploader: Pick<Profile, 'id' | 'name'> | null;
  reviewer: Pick<Profile, 'id' | 'name'> | null;
  versions: DocumentVersionWithUploader[];
}

// ============================================
// CA Task Management (Phase 4) — the new model
// ============================================

/** The compliance stage machine — mirrors public.task_stage in schema.sql. */
export type TaskStage =
  | 'created'
  | 'assigned'
  | 'in_progress'
  | 'waiting_client'
  | 'under_review'
  | 'completed'
  | 'archived';

/** Free-text action_type values written to task_activities by Phase 4 actions. */
export type TaskActivityAction =
  | 'task_created'
  | 'stage_changed'
  | 'assignee_changed'
  | 'reviewer_changed'
  | 'department_changed'
  | 'priority_changed'
  | 'due_date_changed'
  | 'details_updated'
  | 'visibility_changed'
  | 'comment_added'
  | 'comment_edited'
  | 'comment_deleted'
  | 'document_uploaded'
  | 'document_version_uploaded'
  | 'document_attached'
  | 'document_approved'
  | 'document_rejected'
  | 'recurring_generated';

export interface Department {
  id: string;
  firm_id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

/** A tasks row in the CA schema. `status` is derived from `stage` by trigger —
 *  never write it. Named FirmTask while the legacy `Task` type still exists
 *  for unported dashboard pages. */
export interface FirmTask {
  id: string;
  firm_id: string;
  client_id: string;
  department_id: string;
  title: string;
  description: string;
  stage: TaskStage;
  status: 'pending' | 'completed';
  priority: TaskPriority;
  recurring_rule: RecurrenceRule;
  parent_task_id: string | null;
  due_date: string;
  statutory_due_date: string | null;
  period_label: string | null;
  assigned_to: string | null;
  reviewer_id: string | null;
  visible_to_client: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** List-view join: refs resolve to null when the viewer's RLS hides them
 *  (e.g. a client_user cannot read departments or staff profiles). */
export interface FirmTaskWithRefs extends FirmTask {
  client: Pick<Client, 'id' | 'name'> | null;
  department: Pick<Department, 'id' | 'name'> | null;
  assignee: Pick<Profile, 'id' | 'name'> | null;
}

/** Detail-view join — carries the client summary card fields. */
export interface FirmTaskDetail extends FirmTask {
  client: Pick<
    Client,
    'id' | 'name' | 'trade_name' | 'business_type' | 'gstin' | 'pan' | 'email' | 'phone' | 'is_active'
  > | null;
  department: Pick<Department, 'id' | 'name'> | null;
  assignee: Pick<Profile, 'id' | 'name'> | null;
  reviewer: Pick<Profile, 'id' | 'name'> | null;
  creator: Pick<Profile, 'id' | 'name'> | null;
}

export interface FirmTaskComment {
  id: string;
  firm_id: string;
  task_id: string;
  content: string;
  mentions: string[];
  visible_to_client: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** author is null when profiles RLS hides it (client viewing a staff comment
 *  in the portal) — render "Your CA firm" there. */
export interface FirmTaskCommentWithAuthor extends FirmTaskComment {
  author: Pick<Profile, 'id' | 'name'> | null;
}

export interface FirmTaskActivity {
  id: string;
  firm_id: string;
  task_id: string;
  actor_id: string;
  action_type: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

export interface FirmTaskActivityWithActor extends FirmTaskActivity {
  actor: Pick<Profile, 'id' | 'name'> | null;
}

/** Immutable stage audit — written only by the DB trigger. */
export interface TaskStageHistoryEntry {
  id: string;
  firm_id: string;
  task_id: string;
  from_stage: TaskStage | null;
  to_stage: TaskStage;
  changed_by: string | null;
  note: string | null;
  created_at: string;
}

export interface TaskStageHistoryWithActor extends TaskStageHistoryEntry {
  actor: Pick<Profile, 'id' | 'name'> | null;
}

/** Task template in the CA schema (department-aware). */
export interface FirmTaskTemplate {
  id: string;
  firm_id: string;
  department_id: string | null;
  title: string;
  description: string;
  default_priority: TaskPriority;
  recurring_rule: RecurrenceRule;
  checklist_items: ChecklistItem[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ============================================
// Legacy DeadlineTracker types below — kept only so unported pages
// (dashboard, team, templates, settings) still compile. Do not use in new code.
// ============================================

/** @deprecated Legacy DeadlineTracker shape — use FirmTask for the CA schema. */
export interface Task {
  id: string;
  title: string;
  description: string;
  client_id: string;
  firm_id: string;
  due_date: string;
  status: TaskStatus;
  priority: TaskPriority;
  recurring_rule: RecurrenceRule;
  parent_task_id: string | null;
  assigned_to: string | null;
  department_id: string | null;
  review_status: ReviewStatus;
  reviewer_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  firm_id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface DepartmentMember {
  department_id: string;
  user_id: string;
  joined_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  organization_id: string;
  content: string;
  mentions: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  organization_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  created_at: string;
}

export interface TaskActivity {
  id: string;
  task_id: string;
  organization_id: string;
  actor_id: string;
  action_type: ActivityType;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  organization_id: string;
  type: NotificationType;
  title: string;
  message: string;
  reference_id: string | null;
  reference_type: string | null;
  is_read: boolean;
  created_at: string;
}

export interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  default_roles: string[];
  is_system: boolean;
  created_at: string;
}

export interface TaskTemplate {
  id: string;
  firm_id: string;
  department_id: string | null;
  title: string;
  description: string;
  default_priority: TaskPriority;
  checklist_items: ChecklistItem[];
  recurring_rule: RecurrenceRule;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

// ---- Joined / View Types ----

export interface TaskWithDetails extends Task {
  clients: Pick<Client, 'id' | 'name'>;
  assigned_profile: Pick<Profile, 'id' | 'name'> | null;
  assigned_team?: Pick<Department, 'id' | 'name'> | null;
  reviewer_profile?: Pick<Profile, 'id' | 'name'> | null;
}

export interface TaskWithFullDetails extends TaskWithDetails {
  comments: TaskCommentWithAuthor[];
  attachments: TaskAttachmentWithUploader[];
  activities: TaskActivityWithActor[];
}

export interface TaskCommentWithAuthor extends TaskComment {
  author: Pick<Profile, 'id' | 'name' | 'email'>;
}

export interface TaskAttachmentWithUploader extends TaskAttachment {
  uploader: Pick<Profile, 'id' | 'name'>;
}

export interface TaskActivityWithActor extends TaskActivity {
  actor: Pick<Profile, 'id' | 'name'>;
}

export interface DepartmentWithMembers extends Department {
  members: DepartmentMemberWithProfile[];
}

export interface DepartmentMemberWithProfile extends DepartmentMember {
  profile: Pick<Profile, 'id' | 'name' | 'email' | 'role'>;
}

export interface ClientWithCreator extends Client {
  creator: Pick<Profile, 'id' | 'name'>;
}

// Future: add joined reference details
export type NotificationWithDetails = Notification;

// ---- Analytics Types ----

export interface DashboardStats {
  totalTasks: number;
  pendingTasks: number;
  completedTasks: number;
  overdueTasks: number;
  dueThisWeek: number;
  activeClients: number;
  teamCount: number;
  employeeCount: number;
}

export interface EmployeeWorkload {
  profile: Pick<Profile, 'id' | 'name' | 'email'>;
  totalAssigned: number;
  overdue: number;
  completed: number;
  pending: number;
  completionRate: number;
}

// ---- Form / Action Types ----

export interface ActionResult {
  success: boolean;
  error?: string;
}

export interface ActionResultWithData<T> extends ActionResult {
  data?: T;
}
