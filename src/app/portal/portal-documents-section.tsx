'use client';

import React, { useState } from 'react';
import { DocumentsSection } from '@/components/documents-section';
import { fetchMorePortalDocumentsAction } from './actions';
import { PORTAL_DOCUMENTS_PAGE_SIZE } from '@/lib/pagination';
import type { ClientDocumentWithDetails } from '@/lib/types';

interface PortalDocumentsSectionProps {
  initialDocuments: ClientDocumentWithDetails[];
  initialHasMore: boolean;
  clientId: string;
}

/** Client-wide document list on /portal only — /portal/tasks/[id] scopes
 *  documents to one task, a naturally small set that doesn't need
 *  pagination, so it keeps using DocumentsSection directly. */
export function PortalDocumentsSection({
  initialDocuments,
  initialHasMore,
  clientId,
}: PortalDocumentsSectionProps) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);

  const handleLoadMore = async () => {
    setLoading(true);
    const result = await fetchMorePortalDocumentsAction(documents.length);
    if (result.success && result.data) {
      setDocuments((prev) => [...prev, ...result.data!]);
      setHasMore(result.data.length === PORTAL_DOCUMENTS_PAGE_SIZE);
    } else {
      setHasMore(false);
    }
    setLoading(false);
  };

  return (
    <DocumentsSection
      documents={documents}
      clientId={clientId}
      viewer="client"
      canUpload
      canApprove={false}
      hasMore={hasMore}
      onLoadMore={handleLoadMore}
      loadingMore={loading}
    />
  );
}
