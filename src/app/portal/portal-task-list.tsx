'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Calendar, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StageBadge } from '@/components/task/stage-badge';
import { fetchMorePortalTasksAction } from './actions';
import { PORTAL_TASKS_PAGE_SIZE } from '@/lib/pagination';
import type { FirmTask } from '@/lib/types';

interface PortalTaskListProps {
  initialTasks: FirmTask[];
  initialHasMore: boolean;
}

export function PortalTaskList({ initialTasks, initialHasMore }: PortalTaskListProps) {
  const [tasks, setTasks] = useState(initialTasks);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);

  const handleLoadMore = async () => {
    setLoading(true);
    const result = await fetchMorePortalTasksAction(tasks.length);
    if (result.success && result.data) {
      setTasks((prev) => [...prev, ...result.data!]);
      setHasMore(result.data.length === PORTAL_TASKS_PAGE_SIZE);
    } else {
      setHasMore(false);
    }
    setLoading(false);
  };

  return (
    <>
      <div className="divide-y divide-[var(--color-border)]">
        {tasks.map((task) => (
          <Link
            key={task.id}
            href={`/portal/tasks/${task.id}`}
            className={`flex items-center gap-3 py-3.5 first:pt-0 last:pb-0 group ${
              task.stage === 'waiting_client' ? 'bg-[var(--color-warning-bg)]/40 -mx-2 px-2 rounded-lg' : ''
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--color-text)] group-hover:text-[var(--color-accent)] transition-colors truncate">
                {task.title}
              </p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5 flex items-center gap-2 flex-wrap">
                {task.period_label && <span>{task.period_label}</span>}
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Due {format(new Date(task.due_date), 'MMM d, yyyy')}
                </span>
              </p>
            </div>
            <StageBadge stage={task.stage} viewer="client" />
            <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
          </Link>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-4">
          <Button variant="secondary" size="sm" loading={loading} onClick={handleLoadMore}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}
