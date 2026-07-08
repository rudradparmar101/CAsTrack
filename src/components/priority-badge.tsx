import React from 'react';
import type { TaskPriority } from '@/lib/types';

interface PriorityBadgeProps {
  priority: TaskPriority;
  size?: 'sm' | 'md';
  className?: string;
}

const priorityConfig: Record<TaskPriority, { label: string; bg: string; text: string; dot: string }> = {
  low: {
    label: 'Low',
    bg: 'bg-[var(--color-muted)]',
    text: 'text-[var(--color-text-secondary)]',
    dot: 'bg-[var(--color-text-muted)]',
  },
  medium: {
    label: 'Medium',
    bg: 'bg-[var(--color-info-bg)]',
    text: 'text-[var(--color-info-text)]',
    dot: 'bg-[var(--color-info)]',
  },
  high: {
    label: 'High',
    bg: 'bg-[var(--color-warning-bg)]',
    text: 'text-[var(--color-warning-text)]',
    dot: 'bg-[var(--color-warning)]',
  },
  critical: {
    label: 'Critical',
    bg: 'bg-[var(--color-danger-bg)]',
    text: 'text-[var(--color-danger-text)]',
    dot: 'bg-[var(--color-danger)]',
  },
};

export function PriorityBadge({ priority, size = 'sm', className = '' }: PriorityBadgeProps) {
  const config = priorityConfig[priority] || priorityConfig['medium'];
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full font-medium
        ${config.bg} ${config.text} ${sizeClasses} ${className}
      `}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${config.dot} ${
          priority === 'critical' ? 'animate-pulse' : ''
        }`}
      />
      {config.label}
    </span>
  );
}

export { priorityConfig };
