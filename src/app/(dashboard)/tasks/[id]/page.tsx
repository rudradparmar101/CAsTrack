import React from 'react';
import { notFound } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import { TaskHeader } from '@/components/task/task-header';
import { TaskStagePanel } from '@/components/task/task-stage-panel';
import { TaskAssignment } from '@/components/task/task-assignment';
import { TaskMetadata } from '@/components/task/task-metadata';
import { TaskClientCard } from '@/components/task/task-client-card';
import { TaskChecklist } from '@/components/task/task-checklist';
import { TaskComments } from '@/components/task/task-comments';
import { TaskActivityFeed } from '@/components/task/task-activity-feed';
import { TaskDocuments } from '@/components/task/task-documents';
import type {
  ClientDocumentWithDetails,
  FirmTaskDetail,
  FirmTaskCommentWithAuthor,
  FirmTaskActivityWithActor,
  TaskStageHistoryWithActor,
} from '@/lib/types';

const DOCUMENTS_BUCKET = 'client-documents';

interface TaskDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { id } = await params;
  const { supabase, userId, profile } = await getAuthContext();
  // No role redirect: RLS decides visibility (partner: firm-wide; employee:
  // assigned ∪ department). If the fetch returns nothing, 404.
  // client_users are diverted to /portal by middleware + the dashboard layout.

  const { data: task } = await supabase
    .from('tasks')
    .select(
      `*,
       client:client_id(id, name, trade_name, business_type, gstin, pan, email, phone, is_active),
       department:department_id(id, name),
       assignee:assigned_to(id, name),
       reviewer:reviewer_id(id, name),
       creator:created_by(id, name)`
    )
    .eq('id', id)
    .single();

  if (!task) {
    notFound();
  }

  const typedTask = task as unknown as FirmTaskDetail;
  const isPartner = profile.role === 'partner';

  const [
    { data: comments },
    { data: activities },
    { data: stageHistory },
    { data: documents },
    { data: departments },
    { data: members },
    canAssign,
    canUpload,
    canApprove,
    canUpdateDepartmentTasks,
    myDepartmentIds,
  ] = await Promise.all([
    supabase
      .from('task_comments')
      .select('*, author:created_by(id, name)')
      .eq('task_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('task_activities')
      .select('*, actor:actor_id(id, name)')
      .eq('task_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('task_stage_history')
      .select('*, actor:changed_by(id, name)')
      .eq('task_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('documents')
      .select(
        '*, uploader:uploaded_by(id, name), reviewer:reviewed_by(id, name), versions:document_versions(*, uploader:uploaded_by(id, name))'
      )
      .eq('task_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('profiles')
      .select('id, name')
      .in('role', ['partner', 'employee'])
      .eq('is_active', true)
      .order('name'),
    isPartner
      ? true
      : supabase.rpc('has_permission', { p_key: 'tasks.assign' }).then((r) => r.data === true),
    isPartner
      ? true
      : supabase.rpc('has_permission', { p_key: 'documents.upload' }).then((r) => r.data === true),
    isPartner
      ? true
      : supabase.rpc('has_permission', { p_key: 'documents.approve' }).then((r) => r.data === true),
    isPartner
      ? true
      : supabase
          .rpc('has_permission', { p_key: 'tasks.update_department' })
          .then((r) => r.data === true),
    isPartner
      ? null
      : supabase.rpc('get_user_department_ids').then((r) => (r.data as string[] | null) ?? []),
  ]);

  // Mirrors the tasks UPDATE policies: partner anywhere; employee if assigned;
  // employee with tasks.update_department inside their departments. UI-only —
  // RLS re-enforces on every write.
  const canUpdate =
    isPartner ||
    typedTask.assigned_to === userId ||
    (canUpdateDepartmentTasks === true &&
      (myDepartmentIds ?? []).includes(typedTask.department_id));

  // Attaching an existing document is an UPDATE on documents (documents.approve).
  const canAttach = canApprove === true;

  // Signed download URLs (1h) for every version — same pattern as Phase 3.
  const docsWithUrls: ClientDocumentWithDetails[] = await Promise.all(
    ((documents as ClientDocumentWithDetails[]) || []).map(async (doc) => ({
      ...doc,
      versions: await Promise.all(
        (doc.versions || []).map(async (version) => {
          const { data: signed } = await supabase.storage
            .from(DOCUMENTS_BUCKET)
            .createSignedUrl(version.file_path, 3600);
          return { ...version, signedUrl: signed?.signedUrl ?? null };
        })
      ),
    }))
  );

  // Unlinked documents of the same client, for the attach picker.
  let attachableDocuments: { id: string; name: string }[] = [];
  if (canAttach) {
    const { data: unlinked } = await supabase
      .from('documents')
      .select('id, name')
      .eq('client_id', typedTask.client_id)
      .is('task_id', null)
      .order('created_at', { ascending: false });
    attachableDocuments = unlinked || [];
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <TaskHeader task={typedTask} canUpdate={canUpdate} isPartner={isPartner} />

      <div className="grid gap-6 lg:grid-cols-3 items-start">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          <TaskChecklist
            taskId={typedTask.id}
            items={typedTask.checklist_items}
            viewer="staff"
            canToggle={canUpdate}
          />
          <TaskDocuments
            taskId={typedTask.id}
            clientId={typedTask.client_id}
            documents={docsWithUrls}
            attachableDocuments={attachableDocuments}
            canUpload={canUpload === true}
            canApprove={canApprove === true}
            canAttach={canAttach}
          />
          <TaskComments
            taskId={typedTask.id}
            comments={(comments as FirmTaskCommentWithAuthor[]) || []}
            viewer="staff"
            currentUserId={userId}
          />
          <TaskActivityFeed activities={(activities as FirmTaskActivityWithActor[]) || []} />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <TaskStagePanel
            taskId={typedTask.id}
            stage={typedTask.stage}
            hasReviewer={!!typedTask.reviewer_id}
            isPartner={isPartner}
            canUpdate={canUpdate}
            history={(stageHistory as TaskStageHistoryWithActor[]) || []}
            source={typedTask.source}
          />
          <TaskAssignment
            taskId={typedTask.id}
            assignedTo={typedTask.assigned_to}
            reviewerId={typedTask.reviewer_id}
            departmentId={typedTask.department_id}
            assigneeName={typedTask.assignee?.name ?? null}
            reviewerName={typedTask.reviewer?.name ?? null}
            departmentName={typedTask.department?.name ?? null}
            members={members || []}
            departments={departments || []}
            canAssign={canAssign === true}
          />
          <TaskMetadata task={typedTask} />
          <TaskClientCard client={typedTask.client} />
        </div>
      </div>
    </div>
  );
}
