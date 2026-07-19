'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Plus, Pencil, BadgeCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { UdinForm } from './udin-form';
import type { Client, Profile, UdinRegisterEntryWithRefs } from '@/lib/types';

interface UdinPageClientProps {
  entries: UdinRegisterEntryWithRefs[];
  clients: Pick<Client, 'id' | 'name'>[];
  partners: Pick<Profile, 'id' | 'name'>[];
  tasksLite: { id: string; title: string; client_id: string }[];
  documentsLite: { id: string; name: string; client_id: string }[];
  canManage: boolean;
}

export function UdinPageClient({
  entries,
  clients,
  partners,
  tasksLite,
  documentsLite,
  canManage,
}: UdinPageClientProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<UdinRegisterEntryWithRefs | null>(null);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">UDIN Register</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            A firm-side record of UDINs generated on the ICAI portal — capture only, not a generator.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4" />
            Add UDIN
          </Button>
        )}
      </div>

      <Card padding={entries.length === 0 ? 'md' : 'none'} className="overflow-x-auto">
        {entries.length === 0 ? (
          <EmptyState
            icon={<BadgeCheck className="h-10 w-10" />}
            title="No UDINs recorded yet"
            description="Record a UDIN after generating it on the ICAI portal."
            action={
              canManage ? (
                <Button onClick={() => setShowCreateModal(true)} size="sm">
                  <Plus className="h-4 w-4" />
                  Add First UDIN
                </Button>
              ) : undefined
            }
          />
        ) : (
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                <th className="px-3 py-2">UDIN</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Document type</th>
                <th className="px-3 py-2">Generated</th>
                <th className="px-3 py-2">Signing partner</th>
                <th className="px-3 py-2">Linked task</th>
                {canManage && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-2 font-mono text-xs font-medium text-[var(--color-text)]">{entry.udin}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{entry.client?.name || '—'}</td>
                  <td className="px-3 py-2 text-[var(--color-text)]">{entry.document_type}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                    {format(new Date(entry.generated_on), 'MMM d, yyyy')}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{entry.signing_partner?.name || '—'}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                    {entry.task ? (
                      <Link href={`/tasks/${entry.task.id}`} className="hover:text-[var(--color-accent)]">
                        {entry.task.title}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end">
                        <button
                          onClick={() => setEditingEntry(entry)}
                          className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-accent-muted)] transition-colors"
                          title="Edit UDIN entry"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Add UDIN">
        <UdinForm
          clients={clients}
          partners={partners}
          tasksLite={tasksLite}
          documentsLite={documentsLite}
          onSuccess={() => setShowCreateModal(false)}
          onCancel={() => setShowCreateModal(false)}
        />
      </Modal>

      <Modal open={!!editingEntry} onClose={() => setEditingEntry(null)} title="Edit UDIN">
        {editingEntry && (
          <UdinForm
            entry={editingEntry}
            clients={clients}
            partners={partners}
            tasksLite={tasksLite}
            documentsLite={documentsLite}
            onSuccess={() => setEditingEntry(null)}
            onCancel={() => setEditingEntry(null)}
          />
        )}
      </Modal>
    </div>
  );
}
