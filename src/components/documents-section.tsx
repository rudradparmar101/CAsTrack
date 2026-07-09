'use client';

import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  FileText,
  Upload,
  ChevronDown,
  ChevronRight,
  Download,
  CheckCircle2,
  XCircle,
  History,
  EyeOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import {
  uploadDocumentAction,
  uploadDocumentVersionAction,
  approveDocumentAction,
  rejectDocumentAction,
} from '@/lib/documents/actions';
import type { ClientDocumentWithDetails } from '@/lib/types';

interface DocumentsSectionProps {
  documents: ClientDocumentWithDetails[];
  clientId: string;
  /** When set, new uploads are linked to this task (documents.task_id). */
  taskId?: string;
  /** 'staff' renders approve/reject + visibility controls; 'client' renders the
   *  curated portal view with "Upload a corrected file" on rejected docs. */
  viewer: 'staff' | 'client';
  canUpload: boolean;
  canApprove: boolean;
  /** Section heading — defaults to "Documents". */
  title?: string;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function DocumentsSection({
  documents,
  clientId,
  taskId,
  viewer,
  canUpload,
  canApprove,
  title = 'Documents',
}: DocumentsSectionProps) {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [versionTarget, setVersionTarget] = useState<ClientDocumentWithDetails | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ClientDocumentWithDetails | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');

  const uploaderName = (name?: string | null) =>
    name || (viewer === 'client' ? 'Your CA firm' : 'Unknown');

  const handleApprove = async (doc: ClientDocumentWithDetails) => {
    setRowError('');
    setApprovingId(doc.id);
    const result = await approveDocumentAction(doc.id);
    if (!result.success) setRowError(result.error || 'Failed to approve.');
    setApprovingId(null);
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
          <FileText className="h-5 w-5 text-[var(--color-accent)]" />
          {title}
          <span className="text-sm font-normal text-[var(--color-text-muted)]">
            ({documents.length})
          </span>
        </h2>
        {canUpload && (
          <Button size="sm" onClick={() => setShowUploadModal(true)}>
            <Upload className="h-4 w-4" />
            Upload document
          </Button>
        )}
      </div>

      {rowError && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)] mb-4">
          {rowError}
        </div>
      )}

      {documents.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-10 w-10" />}
          title="No documents yet"
          description={
            canUpload
              ? 'Upload the first document for this client.'
              : 'Documents shared with you will appear here.'
          }
        />
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {documents.map((doc) => {
            const currentVersion = doc.versions.find(
              (v) => v.version_number === doc.current_version
            );
            const expanded = expandedId === doc.id;
            // Correction is gated on visibility (any rejected doc the client
            // can see, not just ones they personally uploaded) — matches the
            // document_versions INSERT policy, which only requires
            // can_access_document(), not original-uploader match.
            const isRejectedForClient =
              viewer === 'client' && canUpload && doc.approval_status === 'rejected';

            return (
              <div key={doc.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => setExpandedId(expanded ? null : doc.id)}
                    className="mt-1 p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                    title="Version history"
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[var(--color-text)]">
                        {doc.name}
                      </span>
                      {doc.doc_type && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
                          {doc.doc_type}
                        </span>
                      )}
                      {doc.approval_status === 'pending' && (
                        <Badge variant="warning">Pending review</Badge>
                      )}
                      {doc.approval_status === 'approved' && (
                        <Badge variant="success">Approved</Badge>
                      )}
                      {doc.approval_status === 'rejected' && (
                        <Badge variant="danger">Rejected</Badge>
                      )}
                      {viewer === 'staff' && !doc.visible_to_client && (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]"
                          title="Not visible in the client portal"
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                          Internal
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      v{doc.current_version}
                      {currentVersion ? ` · ${formatSize(currentVersion.file_size)}` : ''}
                      {' · '}
                      {uploaderName(doc.uploader?.name)}
                      {' · '}
                      {formatDistanceToNow(new Date(doc.updated_at), { addSuffix: true })}
                    </p>

                    {doc.approval_status === 'rejected' && doc.rejection_reason && (
                      <div className="mt-2 rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
                        Rejected — &ldquo;{doc.rejection_reason}&rdquo;
                      </div>
                    )}

                    {/* Version history */}
                    {expanded && (
                      <div className="mt-3 rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                        {[...doc.versions]
                          .sort((a, b) => b.version_number - a.version_number)
                          .map((version) => (
                            <div
                              key={version.id}
                              className="flex items-center gap-3 px-3 py-2"
                            >
                              <History className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-[var(--color-text)] truncate">
                                  v{version.version_number} — {version.file_name}
                                  {version.version_number === doc.current_version && (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-[var(--color-success-bg)] text-[var(--color-success)]">
                                      Current
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-[var(--color-text-muted)]">
                                  {formatSize(version.file_size)}
                                  {' · '}
                                  {uploaderName(version.uploader?.name)}
                                  {' · '}
                                  {formatDistanceToNow(new Date(version.created_at), {
                                    addSuffix: true,
                                  })}
                                  {version.note ? ` · “${version.note}”` : ''}
                                </p>
                              </div>
                              {version.signedUrl && (
                                <a
                                  href={version.signedUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)] transition-colors"
                                  title="Download this version"
                                >
                                  <Download className="h-4 w-4" />
                                </a>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Row actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {currentVersion?.signedUrl && (
                      <a
                        href={currentVersion.signedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)] transition-colors"
                        title="Download current version"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    )}
                    {canApprove && doc.approval_status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApprove(doc)}
                          disabled={approvingId === doc.id}
                          className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-success)] hover:bg-[var(--color-success-bg)] transition-colors disabled:opacity-50"
                          title="Approve"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setRejectTarget(doc)}
                          className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors"
                          title="Reject"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* New version / corrected file. A client_user has no UPDATE
                    policy on documents — a correction IS a new version at the
                    DB layer, so that's exactly what the button says. */}
                {(viewer === 'staff' && canUpload) || isRejectedForClient ? (
                  <div className="mt-2 pl-7">
                    <Button
                      variant={isRejectedForClient ? 'primary' : 'ghost'}
                      size="sm"
                      onClick={() => setVersionTarget(doc)}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {viewer === 'client' ? 'Upload a corrected file' : 'New version'}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Upload new document */}
      <Modal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        title="Upload document"
      >
        <UploadForm
          viewer={viewer}
          onSubmit={(formData) => {
            if (taskId) formData.set('task_id', taskId);
            return uploadDocumentAction(clientId, formData);
          }}
          onDone={() => setShowUploadModal(false)}
          submitLabel="Upload"
        />
      </Modal>

      {/* Upload new version / corrected file */}
      <Modal
        open={!!versionTarget}
        onClose={() => setVersionTarget(null)}
        title={
          viewer === 'client' ? 'Upload a corrected file' : `New version — ${versionTarget?.name ?? ''}`
        }
      >
        {versionTarget && (
          <UploadForm
            viewer={viewer}
            isVersion
            onSubmit={(formData) => uploadDocumentVersionAction(versionTarget.id, formData)}
            onDone={() => setVersionTarget(null)}
            submitLabel={viewer === 'client' ? 'Upload corrected file' : 'Upload version'}
          />
        )}
      </Modal>

      {/* Reject modal */}
      <Modal
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Reject document"
      >
        {rejectTarget && (
          <RejectForm document={rejectTarget} onDone={() => setRejectTarget(null)} />
        )}
      </Modal>
    </Card>
  );
}

function UploadForm({
  viewer,
  isVersion = false,
  onSubmit,
  onDone,
  submitLabel,
}: {
  viewer: 'staff' | 'client';
  isVersion?: boolean;
  onSubmit: (formData: FormData) => Promise<{ success: boolean; error?: string }>;
  onDone: () => void;
  submitLabel: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visibleToClient, setVisibleToClient] = useState(true);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await onSubmit(new FormData(e.currentTarget));

    if (result.success) {
      onDone();
    } else {
      setError(result.error || 'Upload failed.');
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="File" name="file" type="file" required hint="Up to 10MB." />
      {!isVersion && (
        <>
          <Input
            label="Document name"
            name="name"
            placeholder="Defaults to the file name"
          />
          <Input
            label="Document type"
            name="doc_type"
            placeholder="e.g., Bank statement, GST return, ITR acknowledgment"
          />
          {viewer === 'staff' && (
            <>
              {/* Hidden mirror: unchecked checkboxes never submit, so the
                  value rides a hidden input that always does. */}
              <input
                type="hidden"
                name="visible_to_client"
                value={visibleToClient ? 'true' : 'false'}
              />
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={visibleToClient}
                  onChange={(e) => setVisibleToClient(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                Visible in the client portal
              </label>
            </>
          )}
        </>
      )}
      {isVersion && (
        <Input label="Note (optional)" name="note" placeholder="What changed in this version?" />
      )}

      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function RejectForm({
  document,
  onDone,
}: {
  document: ClientDocumentWithDetails;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await rejectDocumentAction(document.id, reason);

    if (result.success) {
      onDone();
    } else {
      setError(result.error || 'Failed to reject.');
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Textarea
        label="Reason for rejection"
        rows={3}
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g., Bank statement is missing pages for April–June."
        hint="The client will see this."
      />

      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" loading={loading}>
          Reject
        </Button>
      </div>
    </form>
  );
}
