'use client';

import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Plus, Pencil, KeyRound, ArrowRightLeft, History, Ban, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { DscForm } from './dsc-form';
import { MovementForm } from './movement-form';
import { toggleDscActiveAction } from './actions';
import { getDscExpiryStatus, DSC_EXPIRY_STATUS_LABEL, type DscExpiryStatus } from '@/lib/dsc';
import type { Client, Profile, DscRegisterEntryWithRefs, DscCustodyMovementWithRefs } from '@/lib/types';

interface DscPageClientProps {
  entries: DscRegisterEntryWithRefs[];
  movements: DscCustodyMovementWithRefs[];
  clients: Pick<Client, 'id' | 'name'>[];
  staff: Pick<Profile, 'id' | 'name'>[];
  currentUserId: string;
  canManage: boolean;
}

const STATUS_BADGE_VARIANT: Record<DscExpiryStatus, 'danger' | 'warning' | 'success'> = {
  expired: 'danger',
  expiring_soon: 'warning',
  valid: 'success',
};

const UNASSIGNED_FILTER_VALUE = '__unassigned__';

export function DscPageClient({ entries, movements, clients, staff, currentUserId, canManage }: DscPageClientProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DscRegisterEntryWithRefs | null>(null);
  const [movementEntry, setMovementEntry] = useState<DscRegisterEntryWithRefs | null>(null);
  const [historyEntry, setHistoryEntry] = useState<DscRegisterEntryWithRefs | null>(null);
  const [clientFilter, setClientFilter] = useState('');
  const [custodianFilter, setCustodianFilter] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);

  const custodianOptions = useMemo(() => {
    const withTokens = new Set(entries.filter((e) => e.current_custodian_id).map((e) => e.current_custodian_id as string));
    return staff.filter((s) => withTokens.has(s.id));
  }, [entries, staff]);

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (clientFilter && e.client_id !== clientFilter) return false;
      if (custodianFilter === UNASSIGNED_FILTER_VALUE && e.current_custodian_id) return false;
      if (custodianFilter && custodianFilter !== UNASSIGNED_FILTER_VALUE && e.current_custodian_id !== custodianFilter) return false;
      return true;
    });
  }, [entries, clientFilter, custodianFilter]);

  const historyMovements = useMemo(
    () => (historyEntry ? movements.filter((m) => m.dsc_id === historyEntry.id) : []),
    [movements, historyEntry]
  );

  const handleToggleActive = async (entry: DscRegisterEntryWithRefs) => {
    setToggling(entry.id);
    await toggleDscActiveAction(entry.id, !entry.is_active);
    setToggling(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">DSC Register</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Custody and expiry tracking for digital signature tokens held on behalf of clients.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4" />
            Add DSC
          </Button>
        )}
      </div>

      {entries.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <div className="w-56">
            <Select
              options={[{ value: '', label: 'All clients' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
            />
          </div>
          <div className="w-56">
            <Select
              options={[
                { value: '', label: 'All custodians' },
                { value: UNASSIGNED_FILTER_VALUE, label: 'Not checked out' },
                ...custodianOptions.map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={custodianFilter}
              onChange={(e) => setCustodianFilter(e.target.value)}
            />
          </div>
        </div>
      )}

      <Card padding={filteredEntries.length === 0 ? 'md' : 'none'} className="overflow-x-auto">
        {filteredEntries.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="h-10 w-10" />}
            title={entries.length === 0 ? 'No DSCs recorded yet' : 'No DSCs match these filters'}
            description={
              entries.length === 0
                ? 'Add a DSC to start tracking custody and expiry.'
                : 'Try a different client or custodian filter.'
            }
            action={
              entries.length === 0 && canManage ? (
                <Button onClick={() => setShowCreateModal(true)} size="sm">
                  <Plus className="h-4 w-4" />
                  Add First DSC
                </Button>
              ) : undefined
            }
          />
        ) : (
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                <th className="px-3 py-2">Holder</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Issuing authority</th>
                <th className="px-3 py-2">Expires</th>
                <th className="px-3 py-2">Custodian</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filteredEntries.map((entry) => {
                const expiryStatus = getDscExpiryStatus(entry.expires_on);
                return (
                  <tr key={entry.id} className={entry.is_active ? '' : 'opacity-60'}>
                    <td className="px-3 py-2 font-medium text-[var(--color-text)]">
                      {entry.holder_name}
                      {entry.holder_designation && (
                        <span className="block text-xs text-[var(--color-text-muted)]">{entry.holder_designation}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">{entry.client?.name || '—'}</td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                      {entry.issuing_authority}
                      <span className="block text-xs text-[var(--color-text-muted)]">{entry.dsc_class}</span>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                      {format(new Date(`${entry.expires_on}T00:00:00`), 'MMM d, yyyy')}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                      {entry.custodian?.name || <span className="text-[var(--color-text-muted)]">Not checked out</span>}
                    </td>
                    <td className="px-3 py-2">
                      {!entry.is_active ? (
                        <Badge variant="default">Inactive</Badge>
                      ) : (
                        <Badge variant={STATUS_BADGE_VARIANT[expiryStatus]}>{DSC_EXPIRY_STATUS_LABEL[expiryStatus]}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {entry.is_active && (
                          <button
                            onClick={() => setMovementEntry(entry)}
                            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-accent-muted)] transition-colors"
                            title={entry.current_custodian_id ? 'Check in' : 'Check out'}
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => setHistoryEntry(entry)}
                          className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-accent-muted)] transition-colors"
                          title="Movement history"
                        >
                          <History className="h-3.5 w-3.5" />
                        </button>
                        {canManage && (
                          <>
                            <button
                              onClick={() => setEditingEntry(entry)}
                              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-accent-muted)] transition-colors"
                              title="Edit DSC record"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleToggleActive(entry)}
                              disabled={toggling === entry.id}
                              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-accent-muted)] transition-colors disabled:opacity-50"
                              title={entry.is_active ? 'Deactivate' : 'Reactivate'}
                            >
                              {entry.is_active ? <Ban className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Add DSC">
        <DscForm clients={clients} onSuccess={() => setShowCreateModal(false)} onCancel={() => setShowCreateModal(false)} />
      </Modal>

      <Modal open={!!editingEntry} onClose={() => setEditingEntry(null)} title="Edit DSC">
        {editingEntry && (
          <DscForm
            entry={editingEntry}
            clients={clients}
            onSuccess={() => setEditingEntry(null)}
            onCancel={() => setEditingEntry(null)}
          />
        )}
      </Modal>

      <Modal
        open={!!movementEntry}
        onClose={() => setMovementEntry(null)}
        title={movementEntry?.current_custodian_id ? 'Check in DSC' : 'Check out DSC'}
      >
        {movementEntry && (
          <MovementForm
            entry={movementEntry}
            staff={staff}
            currentUserId={currentUserId}
            onSuccess={() => setMovementEntry(null)}
            onCancel={() => setMovementEntry(null)}
          />
        )}
      </Modal>

      <Modal open={!!historyEntry} onClose={() => setHistoryEntry(null)} title={`Movement history — ${historyEntry?.holder_name ?? ''}`}>
        {historyMovements.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No custody movements recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {historyMovements.map((m) => (
              <li key={m.id} className="rounded-lg border border-[var(--color-border)] px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[var(--color-text)]">
                    {m.movement_type === 'check_out'
                      ? `Checked out to ${m.to_custodian?.name || 'a staff member'}`
                      : `Checked in${m.from_custodian ? ` (from ${m.from_custodian.name})` : ''}`}
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {format(new Date(m.created_at), 'MMM d, yyyy h:mm a')}
                  </span>
                </div>
                {m.note && <p className="mt-1 text-[var(--color-text-secondary)]">{m.note}</p>}
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Recorded by {m.recorder?.name || 'unknown'}</p>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
