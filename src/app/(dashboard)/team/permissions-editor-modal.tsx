'use client';

import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  fetchEmployeePermissionsAction,
  grantPermissionAction,
  revokePermissionAction,
  resetPermissionToDefaultAction,
} from './permissions-actions';
import type { ResolvedPermissionRow } from '@/lib/types';

interface PermissionsEditorModalProps {
  employee: { id: string; name: string };
  onClose: () => void;
}

export function PermissionsEditorModal({ employee, onClose }: PermissionsEditorModalProps) {
  const [rows, setRows] = useState<ResolvedPermissionRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEmployeePermissionsAction(employee.id).then((result) => {
      if (cancelled) return;
      if (result.success && result.data) {
        setRows(result.data);
      } else {
        setLoadError(result.error || 'Failed to load permissions.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [employee.id]);

  const runAction = async (
    key: string,
    action: (userId: string, key: string) => Promise<{ success: boolean; error?: string }>
  ) => {
    setPendingKey(key);
    setActionError('');
    const result = await action(employee.id, key);
    if (result.success) {
      const refreshed = await fetchEmployeePermissionsAction(employee.id);
      if (refreshed.success && refreshed.data) setRows(refreshed.data);
    } else {
      setActionError(result.error || 'Failed to update permission.');
    }
    setPendingKey(null);
  };

  if (loadError) {
    return <p className="text-sm text-[var(--color-danger)]">{loadError}</p>;
  }

  if (!rows) {
    return <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>;
  }

  const byCategory = new Map<string, ResolvedPermissionRow[]>();
  for (const row of rows) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category)!.push(row);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Effective access for <span className="font-medium text-[var(--color-text)]">{employee.name}</span>.
        A permission is either following the employee role default, or explicitly overridden for this person.
      </p>

      {actionError && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] text-[var(--color-danger)] text-sm px-4 py-3">
          {actionError}
        </div>
      )}

      {Array.from(byCategory.entries()).map(([category, categoryRows]) => (
        <div key={category}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
            {category}
          </h3>
          <div className="space-y-2">
            {categoryRows.map((row) => {
              const isPending = pendingKey === row.key;
              return (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[var(--color-text)]">{row.key}</span>
                      <Badge variant={row.effective ? 'success' : 'default'}>
                        {row.effective ? 'On' : 'Off'}
                      </Badge>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {row.override === null
                          ? `(role default — ${row.roleDefault ? 'on' : 'off'})`
                          : row.override
                            ? 'explicitly granted'
                            : 'explicitly revoked'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{row.description}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant={row.override === true ? 'secondary' : 'ghost'}
                      size="sm"
                      loading={isPending}
                      disabled={row.effective && row.override === true}
                      onClick={() => runAction(row.key, grantPermissionAction)}
                      title="Grant"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant={row.override === false ? 'secondary' : 'ghost'}
                      size="sm"
                      loading={isPending}
                      disabled={!row.effective && row.override === false}
                      onClick={() => runAction(row.key, revokePermissionAction)}
                      title="Revoke"
                    >
                      <ShieldOff className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={isPending}
                      disabled={row.override === null}
                      onClick={() => runAction(row.key, resetPermissionToDefaultAction)}
                      title="Reset to role default"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex justify-end pt-2 border-t border-[var(--color-border)] sticky bottom-0 bg-[var(--color-surface)]">
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
