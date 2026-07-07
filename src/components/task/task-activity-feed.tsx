import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Activity } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ACTIVITY_LABELS } from '@/lib/task-options';
import type { FirmTaskActivityWithActor } from '@/lib/types';

interface TaskActivityFeedProps {
  activities: FirmTaskActivityWithActor[];
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** Chronological audit feed from task_activities (server-renderable).
 *  Staff-only: the SELECT policy on task_activities excludes client_users. */
export function TaskActivityFeed({ activities }: TaskActivityFeedProps) {
  return (
    <Card padding="lg">
      <div className="flex items-center gap-2 mb-5">
        <Activity className="h-5 w-5 text-[var(--color-text-muted)]" />
        <h2 className="text-base font-semibold text-[var(--color-text)]">Activity</h2>
        {activities.length > 0 && (
          <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-primary-light)] rounded-full px-2 py-0.5">
            {activities.length}
          </span>
        )}
      </div>

      {activities.length > 0 ? (
        <div className="relative">
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-[var(--color-border)]" />
          <div className="space-y-4">
            {activities.map((activity) => {
              const label = ACTIVITY_LABELS[activity.action_type] || activity.action_type;
              const newValue = activity.new_value || {};
              const oldValue = activity.old_value;

              return (
                <div key={activity.id} className="flex gap-3 relative">
                  <div className="h-[22px] w-[22px] rounded-full bg-[var(--color-background)] border-2 border-[var(--color-surface)] flex items-center justify-center shrink-0 z-10">
                    <div className="h-2 w-2 rounded-full bg-[var(--color-text-muted)]" />
                  </div>

                  <div className="flex-1 min-w-0 pb-1">
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      <span className="font-medium text-[var(--color-text)]">
                        {activity.actor?.name || 'Unknown'}
                      </span>{' '}
                      {label}
                    </p>

                    {/* old → new pairs where both sides exist; plain values otherwise */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                      {Object.keys(newValue).map((key) => {
                        const next = formatValue(newValue[key]);
                        const prev = oldValue ? formatValue(oldValue[key]) : null;
                        if (prev !== null && prev !== next) {
                          return (
                            <span key={key} className="inline-flex items-center gap-1.5 text-xs">
                              <span className="text-[var(--color-text-muted)] line-through">{prev}</span>
                              <span className="text-[var(--color-text-muted)]">→</span>
                              <span className="text-[var(--color-text)] font-medium">{next}</span>
                            </span>
                          );
                        }
                        return (
                          <span key={key} className="text-xs text-[var(--color-text-muted)]">
                            {key === 'note' ? `“${next}”` : next}
                          </span>
                        );
                      })}
                    </div>

                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Activity className="h-10 w-10" />}
          title="No activity recorded"
          description="Task activity and changes will be tracked here."
        />
      )}
    </Card>
  );
}
