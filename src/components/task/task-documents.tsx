'use client';

import React, { useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { DocumentsSection } from '@/components/documents-section';
import { attachDocumentToTaskAction } from '@/lib/documents/actions';
import type { ClientDocumentWithDetails } from '@/lib/types';

interface TaskDocumentsProps {
  taskId: string;
  clientId: string;
  documents: ClientDocumentWithDetails[];
  /** Unlinked documents of the same client the viewer can see — offered in
   *  the "Attach existing" picker. Empty when the viewer cannot attach. */
  attachableDocuments: { id: string; name: string }[];
  canUpload: boolean;
  canApprove: boolean;
  /** Attaching is an UPDATE on documents — partner or documents.approve. */
  canAttach: boolean;
  currentUserId: string;
}

/**
 * Task-scoped wrapper around the shared DocumentsSection: uploads made here
 * are linked to the task, and staff with update rights can additionally
 * attach existing unlinked client documents.
 */
export function TaskDocuments({
  taskId,
  clientId,
  documents,
  attachableDocuments,
  canUpload,
  canApprove,
  canAttach,
  currentUserId,
}: TaskDocumentsProps) {
  const [showAttach, setShowAttach] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState('');

  const handleAttach = async () => {
    if (!selectedDoc) return;
    setAttaching(true);
    setError('');
    const result = await attachDocumentToTaskAction(selectedDoc, taskId);
    if (result.success) {
      setShowAttach(false);
      setSelectedDoc('');
    } else {
      setError(result.error || 'Failed to attach the document.');
    }
    setAttaching(false);
  };

  return (
    <div className="space-y-2">
      <DocumentsSection
        documents={documents}
        clientId={clientId}
        taskId={taskId}
        viewer="staff"
        canUpload={canUpload}
        canApprove={canApprove}
        currentUserId={currentUserId}
        title="Task Documents"
      />

      {canAttach && attachableDocuments.length > 0 && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setShowAttach(true)}>
            <Link2 className="h-3.5 w-3.5" />
            Attach existing document
          </Button>
        </div>
      )}

      <Modal
        open={showAttach}
        onClose={() => setShowAttach(false)}
        title="Attach existing document"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Link a document already uploaded for this client to this task.
          </p>
          <Select
            label="Document"
            options={attachableDocuments.map((d) => ({ value: d.id, label: d.name }))}
            placeholder="Select a document"
            value={selectedDoc}
            onChange={(e) => setSelectedDoc(e.target.value)}
          />
          {error && (
            <div className="rounded-lg bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowAttach(false)}>
              Cancel
            </Button>
            <Button loading={attaching} disabled={!selectedDoc} onClick={handleAttach}>
              Attach
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
