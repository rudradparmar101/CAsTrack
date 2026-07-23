import React from 'react';
import { notFound } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import { createDocumentDownloadUrl } from '@/lib/documents/signed-url';
import { ClientDetailClient } from './client-detail-client';
import { TASK_LIST_SELECT } from '../../tasks/filters';
import type { ClientDocumentWithDetails, FirmTaskWithRefs, Profile } from '@/lib/types';

interface ClientDetailPageProps {
  params: Promise<{ id: string }>;
}


export default async function ClientDetailPage({ params }: ClientDetailPageProps) {
  const { id } = await params;
  const { supabase, profile } = await getAuthContext();
  // No role redirect: employees reach this page if RLS lets them see the
  // client (clients.view or a task against it); otherwise the fetch below
  // returns nothing and we 404. client_users are diverted by the layout.

  const { data: client } = await supabase
    .from('clients')
    .select('*, creator:created_by(id, name)')
    .eq('id', id)
    .single();

  if (!client) {
    notFound();
  }

  const isPartner = profile.role === 'partner';

  const [
    { data: addresses },
    { data: persons },
    { data: registrations },
    { data: documents },
    { data: tasks },
    canManage,
    canUpload,
    canApprove,
  ] = await Promise.all([
    supabase
      .from('client_addresses')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('client_authorized_persons')
      .select('*')
      .eq('client_id', id)
      .order('is_primary', { ascending: false }),
    supabase
      .from('client_registrations')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('documents')
      .select(
        '*, uploader:uploaded_by(id, name), reviewer:reviewed_by(id, name), versions:document_versions(*, uploader:uploaded_by(id, name))'
      )
      .eq('client_id', id)
      .order('created_at', { ascending: false }),
    // Same source + RLS scoping as the main /tasks list, filtered to this
    // client — partners see all, employees see (assigned to them) ∪ (their
    // departments'), same as everywhere else task rows are read.
    supabase
      .from('tasks')
      .select(TASK_LIST_SELECT)
      .eq('client_id', id)
      .order('due_date', { ascending: true }),
    isPartner
      ? true
      : supabase
          .rpc('has_permission', { p_key: 'clients.manage' })
          .then((r) => r.data === true),
    isPartner
      ? true
      : supabase
          .rpc('has_permission', { p_key: 'documents.upload' })
          .then((r) => r.data === true),
    isPartner
      ? true
      : supabase
          .rpc('has_permission', { p_key: 'documents.approve' })
          .then((r) => r.data === true),
  ]);

  // Signed download URLs for every version, generated server-side (1hr expiry —
  // same pattern as DeadlineTracker's task attachments).
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
    <ClientDetailClient
      client={client}
      creator={(client.creator as Pick<Profile, 'id' | 'name'>) || null}
      addresses={addresses || []}
      authorizedPersons={persons || []}
      registrations={registrations || []}
      documents={docsWithUrls}
      tasks={(tasks as unknown as FirmTaskWithRefs[]) || []}
      canManage={canManage}
      canUploadDocs={canUpload}
      canApproveDocs={canApprove}
    />
  );
}
