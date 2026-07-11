import React from 'react';
import { redirect } from 'next/navigation';
import { Building2, CheckSquare, Hourglass } from 'lucide-react';
import { getAuthContext } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { NotificationBell } from '@/components/notification-bell';
import { PortalSignOutButton } from './sign-out-button';
import { PortalTaskList } from './portal-task-list';
import { PortalDocumentsSection } from './portal-documents-section';
import { ContactCard } from './contact-card';
import { PORTAL_TASKS_PAGE_SIZE, PORTAL_DOCUMENTS_PAGE_SIZE } from '@/lib/pagination';
import type { ClientDocumentWithDetails, FirmTask } from '@/lib/types';

const DOCUMENTS_BUCKET = 'client-documents';

/**
 * Client portal — tasks + documents.
 *
 * Everything on this page is curated by RLS, not by query filters: the tasks
 * query returns only THIS client's tasks that staff flagged visible_to_client
 * (and that are past 'created' / not archived); the documents query returns
 * only rows where visible_to_client is true and the doc is either their own
 * upload or has a decided outcome (approved/rejected). Uploader names of
 * staff resolve to null (profiles RLS) and render as "Your CA firm".
 */
export default async function PortalPage() {
  const { supabase, profile, firm, clientId } = await getAuthContext();

  // Defense-in-depth mirror of the dashboard layout guard.
  if (profile.role !== 'client_user' || !clientId) {
    redirect('/dashboard');
  }

  const [{ data: client }, { data: tasks }, { data: documents }, { count: waitingCount }] =
    await Promise.all([
      supabase.from('clients').select('id, name').eq('id', clientId).single(),
      supabase
        .from('tasks')
        .select('*')
        .order('status', { ascending: false }) // 'pending' sorts before 'completed'
        .order('due_date', { ascending: true })
        .range(0, PORTAL_TASKS_PAGE_SIZE - 1),
      supabase
        .from('documents')
        .select(
          '*, uploader:uploaded_by(id, name), reviewer:reviewed_by(id, name), versions:document_versions(*, uploader:uploaded_by(id, name))'
        )
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .range(0, PORTAL_DOCUMENTS_PAGE_SIZE - 1),
      // Independent count so the "waiting on you" banner stays accurate even
      // when a waiting task falls past the first page of the (unfiltered,
      // due-date-sorted) task list above.
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('stage', 'waiting_client'),
    ]);

  const clientTasks = (tasks as FirmTask[]) || [];
  const tasksHasMore = clientTasks.length === PORTAL_TASKS_PAGE_SIZE;

  // 1-hour signed download URLs, generated server-side.
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
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">
            Welcome, {profile.name}
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {client?.name ?? 'Your account'} — track the work your CA firm shares with
            you and exchange documents below.
          </p>
        </div>

        <ContactCard supabase={supabase} clientId={clientId} />

        {!!waitingCount && waitingCount > 0 && (
          <div className="rounded-lg bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-4 py-3 flex items-start gap-2.5">
            <Hourglass className="h-4 w-4 text-[var(--color-warning)] mt-0.5 shrink-0" />
            <p className="text-sm text-[var(--color-warning-text)]">
              <span className="font-medium">
                {waitingCount} task{waitingCount !== 1 ? 's are' : ' is'} waiting on you.
              </span>{' '}
              Open them below to see what your CA firm needs.
            </p>
          </div>
        )}

        {/* Tasks — RLS-curated: only explicitly shared, active-stage tasks. */}
        <Card>
          <h2 className="text-lg font-semibold text-[var(--color-text)] flex items-center gap-2 mb-4">
            <CheckSquare className="h-5 w-5 text-[var(--color-accent)]" />
            Your Tasks
            <span className="text-sm font-normal text-[var(--color-text-muted)]">
              ({clientTasks.length}
              {tasksHasMore ? '+' : ''})
            </span>
          </h2>
          {clientTasks.length === 0 ? (
            <EmptyState
              icon={<CheckSquare className="h-10 w-10" />}
              title="No tasks shared yet"
              description="Work your CA firm shares with you will appear here."
            />
          ) : (
            <PortalTaskList initialTasks={clientTasks} initialHasMore={tasksHasMore} />
          )}
        </Card>

        <PortalDocumentsSection
          initialDocuments={docsWithUrls}
          initialHasMore={docsWithUrls.length === PORTAL_DOCUMENTS_PAGE_SIZE}
          clientId={clientId}
        />
      </main>
    </div>
  );
}
