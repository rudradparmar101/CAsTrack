'use client';

import React, { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { toggleTaskChecklistItemAction } from '@/app/(dashboard)/tasks/actions';
import type { ChecklistItem } from '@/lib/types';

interface TaskChecklistProps {
  taskId: string;
  items: ChecklistItem[];
  /** 'staff' with canToggle renders checkboxes; everyone else (including
   *  staff without update rights, and the client portal) gets a read-only
   *  received/pending list — "client sees what's missing" per the roadmap. */
  viewer: 'staff' | 'client';
  canToggle?: boolean;
}

/** Renders nothing when there's no checklist — not every task comes from a
 *  template, so an empty section would just be noise. */
export function TaskChecklist({ taskId, items, viewer, canToggle = false }: TaskChecklistProps) {
  const [checklist, setChecklist] = useState(items);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (checklist.length === 0) return null;

  const receivedCount = checklist.filter((item) => item.completed).length;
  const interactive = viewer === 'staff' && canToggle;

  const handleToggle = async (itemId: string) => {
    if (!interactive) return;
    setPendingId(itemId);
    setChecklist((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, completed: !item.completed } : item))
    );
    const result = await toggleTaskChecklistItemAction(taskId, itemId);
    if (!result.success) {
      // Revert on failure (e.g. RLS denial, or the item changed elsewhere).
      setChecklist(items);
    }
    setPendingId(null);
  };

  return (
    <Card>
      <h2 className="text-base font-semibold text-[var(--color-text)] flex items-center gap-2 mb-3">
        <ListChecks className="h-4 w-4 text-[var(--color-accent)]" />
        Checklist
        <span className="text-sm font-normal text-[var(--color-text-muted)]">
          ({receivedCount}/{checklist.length})
        </span>
      </h2>
      <ul className="space-y-2">
        {checklist.map((item) => (
          <li key={item.id} className="flex items-start gap-2.5">
            <button
              type="button"
              disabled={!interactive || pendingId === item.id}
              onClick={() => handleToggle(item.id)}
              aria-label={item.completed ? 'Mark as pending' : 'Mark as received'}
              className={`mt-0.5 h-4.5 w-4.5 shrink-0 rounded border flex items-center justify-center transition-colors ${
                item.completed
                  ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-[var(--color-accent-foreground)]'
                  : 'border-[var(--color-border)]'
              } ${interactive ? 'cursor-pointer' : 'cursor-default'} disabled:opacity-50`}
            >
              {item.completed && (
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none">
                  <path
                    d="M3.5 8.5L6.5 11.5L12.5 4.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
            <span
              className={`text-sm ${
                item.completed
                  ? 'text-[var(--color-text-muted)] line-through'
                  : 'text-[var(--color-text)]'
              }`}
            >
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
