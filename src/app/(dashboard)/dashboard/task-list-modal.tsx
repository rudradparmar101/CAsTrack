'use client';

import React from 'react';
import { Modal } from '@/components/ui/modal';
import { TaskSummaryCard } from '@/components/task/task-summary-card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListTodo } from 'lucide-react';
import type { FirmTaskWithRefs } from '@/lib/types';

interface TaskListModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  tasks: FirmTaskWithRefs[];
}

/** Displays a subset of the already-fetched, RLS-scoped `tasks` prop from
 *  AdminDashboard — no independent fetch, so it can never show more than
 *  the caller was already authorized to see. */
export function TaskListModal({ open, onClose, title, tasks }: TaskListModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="lg">
      {tasks.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {tasks.map((task) => (
            <TaskSummaryCard key={task.id} task={task} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ListTodo className="h-12 w-12" />}
          title="No tasks"
          description="There are no tasks to show here."
        />
      )}
    </Modal>
  );
}
