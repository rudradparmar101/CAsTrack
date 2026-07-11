'use server';

import { getAuthProfile } from '@/lib/auth';
import { PORTAL_TASKS_PAGE_SIZE, PORTAL_DOCUMENTS_PAGE_SIZE } from '@/lib/pagination';
import type { ActionResultWithData, ClientDocumentWithDetails, FirmTask } from '@/lib/types';

const DOCUMENTS_BUCKET = 'client-documents';

/** Portal list pagination (Phase 11) — mirrors /tasks' fetchMoreTasksAction
 *  shape (offset-based "Load more"), scoped to the caller's own client via
 *  RLS rather than an explicit client_id filter (defense in depth: a
 *  client_user's tasks/documents SELECT policies already pin them to their
 *  own client, so there's nothing else to scope by here). */

async function requireClientUser() {
  const { supabase, clientId, profile } = await getAuthProfile();
  if (profile.role !== 'client_user' || !clientId) {
    return { ok: false as const, error: 'Not allowed.' };
  }
  return { ok: true as const, supabase };
}

export async function fetchMorePortalTasksAction(
  offset: number
): Promise<ActionResultWithData<FirmTask[]>> {
  const guard = await requireClientUser();
  if (!guard.ok) return { success: false, error: guard.error };

  const { data, error } = await guard.supabase
    .from('tasks')
    .select('*')
    .order('status', { ascending: false })
    .order('due_date', { ascending: true })
    .range(offset, offset + PORTAL_TASKS_PAGE_SIZE - 1);

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data as FirmTask[]) || [] };
}

export async function fetchMorePortalDocumentsAction(
  offset: number
): Promise<ActionResultWithData<ClientDocumentWithDetails[]>> {
  const guard = await requireClientUser();
  if (!guard.ok) return { success: false, error: guard.error };
  const { supabase } = guard;

  const { data, error } = await supabase
    .from('documents')
    .select(
      '*, uploader:uploaded_by(id, name), reviewer:reviewed_by(id, name), versions:document_versions(*, uploader:uploaded_by(id, name))'
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + PORTAL_DOCUMENTS_PAGE_SIZE - 1);

  if (error) return { success: false, error: error.message };

  const docsWithUrls: ClientDocumentWithDetails[] = await Promise.all(
    ((data as ClientDocumentWithDetails[]) || []).map(async (doc) => ({
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

  return { success: true, data: docsWithUrls };
}
