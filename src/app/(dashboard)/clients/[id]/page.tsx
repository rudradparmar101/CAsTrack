import React from 'react';
import { notFound } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import { ClientDetailClient } from './client-detail-client';
import type { ClientDocumentWithDetails, Profile } from '@/lib/types';

interface ClientDetailPageProps {
  params: Promise<{ id: string }>;
}

const DOCUMENTS_BUCKET = 'client-documents';

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
    { data: documents },
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
      .from('documents')
      .select(
        '*, uploader:uploaded_by(id, name), reviewer:reviewed_by(id, name), versions:document_versions(*, uploader:uploaded_by(id, name))'
      )
      .eq('client_id', id)
      .order('created_at', { ascending: false }),
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
          const { data: signed } = await supabase.storage
            .from(DOCUMENTS_BUCKET)
            .createSignedUrl(version.file_path, 3600);
          return { ...version, signedUrl: signed?.signedUrl ?? null };
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
      documents={docsWithUrls}
      canManage={canManage}
      canUploadDocs={canUpload}
      canApproveDocs={canApprove}
    />
  );
}
