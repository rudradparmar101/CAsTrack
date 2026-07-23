import React from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, Building2, Calendar, Hourglass } from 'lucide-react';
import { getAuthContext } from '@/lib/auth';
import { createDocumentDownloadUrl } from '@/lib/documents/signed-url';
import { Card } from '@/components/ui/card';
import { StageBadge } from '@/components/task/stage-badge';
import { TaskComments } from '@/components/task/task-comments';
import { TaskChecklist } from '@/components/task/task-checklist';
import { DocumentsSection } from '@/components/documents-section';
import { NotificationBell } from '@/components/notification-bell';
import { PortalSignOutButton } from '../../sign-out-button';
import type {
  ClientDocumentWithDetails,
  FirmTask,
  FirmTaskCommentWithAuthor,
} from '@/lib/types';


interface PortalTaskPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Client portal task view — everything on this page is curated by RLS, not by
 * query filters:
 *  - the task resolves only if it belongs to THIS client, is flagged
 *    visible_to_client, and is past 'created' / not archived
 *  - comments come back only if flagged visible_to_client
 *  - documents follow the own-upload-or-decided (approved/rejected) portal rule
 *  - staff author/uploader names resolve to null (profiles RLS) and render
 *    as "Your CA firm"
 */
export default async function PortalTaskPage({ params }: PortalTaskPageProps) {
  const { id } = await params;
  const { supabase, userId, profile, firm, clientId } = await getAuthContext();

  // Defense-in-depth mirror of the middleware guard.
  if (profile.role !== 'client_user' || !clientId) {
    redirect('/dashboard');
  }

  const { data: task } = await supabase.from('tasks').select('*').eq('id', id).single();

  if (!task) {
    notFound();
  }
  const typedTask = task as FirmTask;

  const [{ data: comments }, { data: documents }] = await Promise.all([
    supabase
      .from('task_comments')
      .select('*, author:created_by(id, name)')
      .eq('task_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('documents')
      .select(
        '*, uploader:uploaded_by(id, name), reviewer:reviewed_by(id, name), versions:document_versions(*, uploader:uploaded_by(id, name))'
      )
      .eq('task_id', id)
      .order('created_at', { ascending: false }),
  ]);

  const docsWithUrls: ClientDocumentWithDetails[] = await Promise.all(
    ((documents as ClientDocumentWithDetails[]) || []).map(async (doc) => ({
      ...doc,
      versions: await Promise.all(
        (doc.versions || []).map(async (version) => {
          const signedUrl = await createDocumentDownloadUrl(
            supabase,
            version.file_path,
            version.file_name
          );
          return { ...version, signedUrl };
        })
      ),
    }))
  );

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <header className="bg-[var(--color-surface)] border-b border-[var(--color-border)]">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-[var(--color-accent)] flex items-center justify-center">
              <Building2 className="h-5 w-5 text-[var(--color-accent-foreground)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">{firm.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Client Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell basePath="/portal/tasks" />
            <PortalSignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Link
          href="/portal"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to portal
        </Link>

        <Card padding="lg">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-[var(--color-text)]">{typedTask.title}</h1>
              {typedTask.period_label && (
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                  {typedTask.period_label}
                </p>
              )}
            </div>
            <StageBadge stage={typedTask.stage} viewer="client" />
          </div>

          <div className="flex items-center gap-2 mt-3 text-sm text-[var(--color-text-secondary)]">
            <Calendar className="h-4 w-4 text-[var(--color-text-muted)]" />
            Due {format(new Date(typedTask.due_date), 'MMMM d, yyyy')}
          </div>

          {typedTask.stage === 'waiting_client' && (
            <div className="mt-4 rounded-lg bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-4 py-3 flex items-start gap-2.5">
              <Hourglass className="h-4 w-4 text-[var(--color-warning)] mt-0.5 shrink-0" />
              <p className="text-sm text-[var(--color-warning-text)]">
                <span className="font-medium">Your CA firm is waiting on you.</span> Please check
                the messages below and upload any requested documents so work can continue.
              </p>
            </div>
          )}
        </Card>

        <TaskChecklist taskId={typedTask.id} items={typedTask.checklist_items} viewer="client" />

        <DocumentsSection
          documents={docsWithUrls}
          clientId={clientId}
          taskId={typedTask.id}
          viewer="client"
          canUpload
          canApprove={false}
        />

        <TaskComments
          taskId={typedTask.id}
          comments={(comments as FirmTaskCommentWithAuthor[]) || []}
          viewer="client"
          currentUserId={userId}
        />
      </main>
    </div>
  );
}
