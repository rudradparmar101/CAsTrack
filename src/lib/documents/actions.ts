'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import { logTaskActivity, notifyUsers } from '@/lib/tasks/activity';
import type { ActionResult } from '@/lib/types';

/**
 * Document + version actions, shared by the staff client-detail page and the
 * client portal (both import from here — the permission paths differ by role):
 *
 *  - staff uploads:  has_permission('documents.upload') checked explicitly
 *                    (app layer) AND enforced by the documents INSERT policy
 *  - client uploads: no permission key — access is structural; RLS pins them
 *                    to their own client, forces approval_status='pending'
 *                    and visible_to_client=true
 *  - approve/reject: has_permission('documents.approve'), both layers
 *
 * Version handling: uploading a new version only INSERTs a document_versions
 * row — the on_document_version_added trigger bumps documents.current_version
 * and resets approval_status to 'pending'. Never set those fields here.
 *
 * Storage: bucket 'client-documents', path {firm_id}/{client_id}/{document_id}/
 * {uuid}.{ext} — matches the storage RLS policies in schema.sql §12. Downloads
 * use 1-hour signed URLs generated server-side (DeadlineTracker pattern),
 * always with `{ download: <name> }` so Supabase serves Content-Disposition:
 * attachment — see the audit's M1.
 *
 * FILE TYPE IS DECIDED BY THE SERVER, FROM THE BYTES (audit finding M1).
 * `file.type` and `file.name`'s extension are attacker-controlled and are
 * never used for the storage object's content type or path — `detectFileType()`
 * in ./file-types.ts sniffs the leading bytes against an allow-list and
 * returns the canonical extension + content type used below.
 */

import { detectFileType } from './file-types';
import { MAX_DOCUMENT_SIZE, formatMaxDocumentSize } from './limits';

const DOCUMENTS_BUCKET = 'client-documents';

function storagePath(firmId: string, clientId: string, documentId: string, ext: string) {
  return `${firmId}/${clientId}/${documentId}/${crypto.randomUUID()}.${ext}`;
}

/**
 * Presence + size + CONTENT-TYPE validation, in that order. Returns the
 * server's own verdict on the file's type; callers must use `detected`, never
 * `file.type`/`file.name`.
 */
async function getValidFile(
  formData: FormData
): Promise<{ file: File; detected: { ext: string; contentType: string } } | { error: string }> {
  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) return { error: 'No file selected.' };
  if (file.size > MAX_DOCUMENT_SIZE) {
    return { error: `File exceeds the ${formatMaxDocumentSize()} size limit.` };
  }

  const detection = await detectFileType(file);
  if (!detection.ok) return { error: detection.error };

  return { file, detected: detection.type };
}

function revalidateDocumentViews(clientId: string, taskId?: string | null) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/portal');
  if (taskId) {
    revalidatePath(`/tasks/${taskId}`);
    revalidatePath(`/portal/tasks/${taskId}`);
  }
}

/**
 * Upload a brand-new document: creates the documents row (approval_status
 * 'pending'), the storage object, and the v1 document_versions row in one flow.
 */
export async function uploadDocumentAction(
  clientId: string,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, userId, profile } = await getAuthProfile();

  if (!clientId) return { success: false, error: 'Missing client.' };

  const fileCheck = await getValidFile(formData);
  if ('error' in fileCheck) return { success: false, error: fileCheck.error };
  const { file, detected } = fileCheck;

  let visibleToClient = true;
  if (profile.role === 'client_user') {
    // Structural scoping: a client can only ever file under their own client.
    if (clientId !== profile.client_id) {
      return { success: false, error: 'Not allowed.' };
    }
  } else {
    // Staff path: explicit app-layer permission check on top of RLS.
    if (profile.role !== 'partner') {
      const { data: allowed } = await supabase.rpc('has_permission', {
        p_key: 'documents.upload',
      });
      if (allowed !== true) {
        return { success: false, error: 'You do not have permission to upload documents.' };
      }
    }
    // Staff may keep internal workpapers hidden from the portal.
    visibleToClient = formData.get('visible_to_client') !== 'false';
  }

  const name = ((formData.get('name') as string) || '').trim() || file.name;
  const docType = ((formData.get('doc_type') as string) || '').trim() || null;
  // Optional task linkage (Phase 4): RLS re-validates access — staff need
  // staff_can_access_task, clients client_can_access_task, for the insert.
  const taskId = ((formData.get('task_id') as string) || '').trim() || null;

  // 1. Create the logical document (RLS re-validates everything above).
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      firm_id: profile.firm_id,
      client_id: clientId,
      task_id: taskId,
      name,
      doc_type: docType,
      approval_status: 'pending',
      visible_to_client: visibleToClient,
      uploaded_by: userId,
    })
    .select('id')
    .single();

  if (docError || !doc) {
    return { success: false, error: docError?.message || 'Failed to create the document.' };
  }

  // 2. Upload the physical file. Both the path extension and the stored
  //    content type come from the SERVER's detection, never from the client.
  const filePath = storagePath(profile.firm_id, clientId, doc.id, detected.ext);
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(filePath, file, { contentType: detected.contentType });

  if (uploadError) {
    // Roll back the document row ("uploaders can delete their own pending
    // documents" policy covers every role that got this far).
    await supabase.from('documents').delete().eq('id', doc.id);
    return { success: false, error: uploadError.message };
  }

  // 3. Record version 1.
  const { error: versionError } = await supabase.from('document_versions').insert({
    firm_id: profile.firm_id,
    document_id: doc.id,
    version_number: 1,
    file_name: file.name,
    file_path: filePath,
    file_type: detected.contentType,
    file_size: file.size,
    uploaded_by: userId,
  });

  if (versionError) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([filePath]);
    await supabase.from('documents').delete().eq('id', doc.id);
    return { success: false, error: versionError.message };
  }

  // Task-linked uploads feed the task's activity stream and ping the assignee.
  if (taskId) {
    await logTaskActivity({
      supabase,
      firmId: profile.firm_id,
      taskId,
      actorId: userId,
      action: 'document_uploaded',
      newValue: { document: name },
    });

    const { data: task } = await supabase
      .from('tasks')
      .select('title, assigned_to, created_by')
      .eq('id', taskId)
      .single();
    if (task) {
      const uploaderLabel =
        profile.role === 'client_user' ? `${profile.name} (client)` : profile.name;
      await notifyUsers({
        supabase,
        userIds: [task.assigned_to, task.created_by],
        excludeUserId: userId,
        type: 'document_uploaded',
        title: 'Document uploaded',
        message: `${uploaderLabel} uploaded "${name}" on "${task.title}"`,
        referenceId: taskId,
        referenceType: 'task',
      });
    }
  }

  revalidateDocumentViews(clientId, taskId);
  return { success: true };
}

/**
 * Add a new version to an existing document ("Upload a corrected file" on the
 * client side). Only INSERTs the version row — the on_document_version_added
 * trigger resets approval_status to 'pending' and bumps current_version.
 */
export async function uploadDocumentVersionAction(
  documentId: string,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, userId, profile } = await getAuthProfile();

  if (!documentId) return { success: false, error: 'Missing document.' };

  const fileCheck = await getValidFile(formData);
  if ('error' in fileCheck) return { success: false, error: fileCheck.error };
  const { file, detected } = fileCheck;

  if (profile.role !== 'client_user' && profile.role !== 'partner') {
    const { data: allowed } = await supabase.rpc('has_permission', {
      p_key: 'documents.upload',
    });
    if (allowed !== true) {
      return { success: false, error: 'You do not have permission to upload documents.' };
    }
  }

  // RLS-scoped read: resolves only if the viewer can access this document
  // (staff via task/client visibility; clients via own-upload-or-approved).
  const { data: doc } = await supabase
    .from('documents')
    .select('id, client_id, task_id, name, current_version')
    .eq('id', documentId)
    .single();

  if (!doc) return { success: false, error: 'Document not found.' };

  const note = ((formData.get('note') as string) || '').trim() || null;
  const filePath = storagePath(profile.firm_id, doc.client_id, doc.id, detected.ext);

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(filePath, file, { contentType: detected.contentType });

  if (uploadError) {
    return { success: false, error: uploadError.message };
  }

  const { error: versionError } = await supabase.from('document_versions').insert({
    firm_id: profile.firm_id,
    document_id: doc.id,
    version_number: doc.current_version + 1,
    file_name: file.name,
    file_path: filePath,
    file_type: detected.contentType,
    file_size: file.size,
    note,
    uploaded_by: userId,
  });

  if (versionError) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([filePath]);
    if (versionError.message?.includes('duplicate') || versionError.code === '23505') {
      return {
        success: false,
        error: 'Someone else uploaded a version at the same time. Refresh and try again.',
      };
    }
    return { success: false, error: versionError.message };
  }

  if (doc.task_id) {
    await logTaskActivity({
      supabase,
      firmId: profile.firm_id,
      taskId: doc.task_id,
      actorId: userId,
      action: 'document_version_uploaded',
      newValue: { document: doc.name, version: doc.current_version + 1 },
    });
  }

  revalidateDocumentViews(doc.client_id, doc.task_id);
  return { success: true };
}

/** Approve — staff with documents.approve only. */
export async function approveDocumentAction(documentId: string): Promise<ActionResult> {
  const { supabase, userId, profile } = await getAuthProfile();

  if (profile.role === 'client_user') return { success: false, error: 'Not allowed.' };
  if (profile.role !== 'partner') {
    const { data: allowed } = await supabase.rpc('has_permission', {
      p_key: 'documents.approve',
    });
    if (allowed !== true) {
      return { success: false, error: 'You do not have permission to approve documents.' };
    }
  }

  const { data: updated, error } = await supabase
    .from('documents')
    .update({
      approval_status: 'approved',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq('id', documentId)
    .eq('firm_id', profile.firm_id)
    .select('client_id, task_id, name, uploaded_by')
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Document not found.' };
  }

  if (updated.task_id) {
    await logTaskActivity({
      supabase,
      firmId: profile.firm_id,
      taskId: updated.task_id,
      actorId: userId,
      action: 'document_approved',
      newValue: { document: updated.name },
    });
  }
  // The uploader (staff or client — the RPC handles both) learns the outcome.
  await notifyUsers({
    supabase,
    userIds: [updated.uploaded_by],
    excludeUserId: userId,
    type: 'task_approved',
    title: 'Document approved',
    message: `"${updated.name}" was approved`,
    referenceId: updated.task_id ?? documentId,
    referenceType: updated.task_id ? 'task' : 'document',
    sendEmail: true,
  });

  revalidateDocumentViews(updated.client_id, updated.task_id);
  return { success: true };
}

/** Reject — requires a rejection_reason; the client sees it verbatim. */
export async function rejectDocumentAction(
  documentId: string,
  reason: string
): Promise<ActionResult> {
  const { supabase, userId, profile } = await getAuthProfile();

  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    return { success: false, error: 'A reason for rejection is required — the client will see it.' };
  }

  if (profile.role === 'client_user') return { success: false, error: 'Not allowed.' };
  if (profile.role !== 'partner') {
    const { data: allowed } = await supabase.rpc('has_permission', {
      p_key: 'documents.approve',
    });
    if (allowed !== true) {
      return { success: false, error: 'You do not have permission to reject documents.' };
    }
  }

  const { data: updated, error } = await supabase
    .from('documents')
    .update({
      approval_status: 'rejected',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: trimmedReason,
    })
    .eq('id', documentId)
    .eq('firm_id', profile.firm_id)
    .select('client_id, task_id, name, uploaded_by')
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Document not found.' };
  }

  if (updated.task_id) {
    await logTaskActivity({
      supabase,
      firmId: profile.firm_id,
      taskId: updated.task_id,
      actorId: userId,
      action: 'document_rejected',
      newValue: { document: updated.name, reason: trimmedReason },
    });
  }
  await notifyUsers({
    supabase,
    userIds: [updated.uploaded_by],
    excludeUserId: userId,
    type: 'task_rejected',
    title: 'Document rejected',
    message: `"${updated.name}" was rejected: ${trimmedReason}`,
    referenceId: updated.task_id ?? documentId,
    referenceType: updated.task_id ? 'task' : 'document',
    sendEmail: true,
  });

  revalidateDocumentViews(updated.client_id, updated.task_id);
  return { success: true };
}

/**
 * Attach an EXISTING unlinked client document to a task (Phase 4).
 *
 * This is an UPDATE on documents, so the DB only allows it for staff holding
 * documents.approve (or partners) — the same policy that guards approval
 * fields ("Document approvers can update documents"). The app layer mirrors
 * that check and additionally enforces client consistency: a task may only
 * carry documents of its own client (the schema does not enforce this).
 */
export async function attachDocumentToTaskAction(
  documentId: string,
  taskId: string
): Promise<ActionResult> {
  const { supabase, userId, profile } = await getAuthProfile();

  if (!documentId || !taskId) return { success: false, error: 'Missing document or task.' };
  if (profile.role === 'client_user') return { success: false, error: 'Not allowed.' };

  if (profile.role !== 'partner') {
    const { data: allowed } = await supabase.rpc('has_permission', {
      p_key: 'documents.approve',
    });
    if (allowed !== true) {
      return { success: false, error: 'You do not have permission to attach documents.' };
    }
  }

  // Both reads are RLS-scoped: they resolve only if the viewer can access them.
  const [{ data: doc }, { data: task }] = await Promise.all([
    supabase.from('documents').select('id, client_id, task_id, name').eq('id', documentId).single(),
    supabase.from('tasks').select('id, client_id, title').eq('id', taskId).single(),
  ]);

  if (!doc || !task) return { success: false, error: 'Document or task not found.' };
  if (doc.task_id) return { success: false, error: 'This document is already linked to a task.' };
  if (doc.client_id !== task.client_id) {
    return { success: false, error: 'The document belongs to a different client than the task.' };
  }

  const { error } = await supabase
    .from('documents')
    .update({ task_id: taskId })
    .eq('id', documentId)
    .eq('firm_id', profile.firm_id);

  if (error) {
    return { success: false, error: error.message };
  }

  await logTaskActivity({
    supabase,
    firmId: profile.firm_id,
    taskId,
    actorId: userId,
    action: 'document_attached',
    newValue: { document: doc.name },
  });

  revalidateDocumentViews(doc.client_id, taskId);
  return { success: true };
}
