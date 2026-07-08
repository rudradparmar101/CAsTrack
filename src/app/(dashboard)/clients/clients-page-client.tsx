'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Plus, Users, Pencil, Archive, ArchiveRestore } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { ClientForm } from '@/components/client-form';
import {
  createClientAction,
  setClientActiveAction,
  fetchMoreClientsAction,
} from './actions';
import { CLIENTS_PAGE_SIZE } from '@/lib/pagination';
import { businessTypeLabel } from '@/lib/ca-options';
import type { ClientWithCreator } from '@/lib/types';

interface ClientsPageClientProps {
  clients: ClientWithCreator[];
  initialHasMore: boolean;
  canManage: boolean;
}

export function ClientsPageClient({
  clients,
  initialHasMore,
  canManage,
}: ClientsPageClientProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [clientList, setClientList] = useState(clients);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [prevClients, setPrevClients] = useState(clients);

  if (clients !== prevClients) {
    setPrevClients(clients);
    setClientList(clients);
    setHasMore(initialHasMore);
  }

  // No delete anywhere — clients are statutory records. Deactivate only.
  const handleToggleActive = async (client: ClientWithCreator) => {
    if (
      client.is_active &&
      !confirm(
        `Deactivate ${client.name}? They will be marked inactive, but all records are preserved.`
      )
    ) {
      return;
    }
    setTogglingId(client.id);
    await setClientActiveAction(client.id, !client.is_active);
    setTogglingId(null);
  };

  const handleLoadMore = async () => {
    setLoadingMore(true);
    const result = await fetchMoreClientsAction(clientList.length);
    if (result.success && result.data) {
      setClientList((prev) => [...prev, ...result.data!]);
      setHasMore(result.data.length === CLIENTS_PAGE_SIZE);
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Clients</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {clientList.length}
            {hasMore ? '+' : ''} client{clientList.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4" />
            Add Client
          </Button>
        )}
      </div>

      {/* Client List */}
      {clientList.length > 0 ? (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider px-6 py-3">
                    Name
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider px-6 py-3 hidden sm:table-cell">
                    Type
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider px-6 py-3 hidden md:table-cell">
                    GSTIN
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider px-6 py-3">
                    Status
                  </th>
                  <th className="text-right text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider px-6 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {clientList.map((client) => (
                  <tr
                    key={client.id}
                    className="hover:bg-[var(--color-accent-muted)] transition-colors"
                  >
                    <td className="px-6 py-4">
                      <Link
                        href={`/clients/${client.id}`}
                        className="text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors"
                      >
                        {client.name}
                      </Link>
                      {client.trade_name && (
                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                          {client.trade_name}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 hidden sm:table-cell">
                      <span className="text-sm text-[var(--color-text-secondary)]">
                        {businessTypeLabel(client.business_type)}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell">
                      <span className="text-sm text-[var(--color-text-muted)] font-mono">
                        {client.gstin || '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={client.is_active ? 'success' : 'default'}>
                        {client.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          <Link
                            href={`/clients/${client.id}`}
                            className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-accent-muted)] transition-colors"
                            title="View & edit client"
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
                          <button
                            onClick={() => handleToggleActive(client)}
                            disabled={togglingId === client.id}
                            className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-warning)] hover:bg-[var(--color-warning-bg)] transition-colors disabled:opacity-50"
                            title={client.is_active ? 'Deactivate client' : 'Reactivate client'}
                          >
                            {client.is_active ? (
                              <Archive className="h-4 w-4" />
                            ) : (
                              <ArchiveRestore className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={loadingMore} onClick={handleLoadMore}>
            Load More
          </Button>
        </div>
      )}

      {clientList.length === 0 && (
        <Card>
          <EmptyState
            icon={<Users className="h-12 w-12" />}
            title="No clients yet"
            description={
              canManage
                ? 'Add your first client to start tracking their compliance work.'
                : 'Clients you are given access to will appear here.'
            }
            action={
              canManage ? (
                <Button onClick={() => setShowCreateModal(true)}>
                  <Plus className="h-4 w-4" />
                  Add Client
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      {/* Create Modal — editing happens on the client detail page, where the
          address/person sub-forms are preloaded (the update action uses
          replace-all semantics and must receive the full current set). */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Add New Client"
        maxWidth="lg"
      >
        <ClientForm
          action={createClientAction}
          onSuccess={() => setShowCreateModal(false)}
          onCancel={() => setShowCreateModal(false)}
        />
      </Modal>
    </div>
  );
}
