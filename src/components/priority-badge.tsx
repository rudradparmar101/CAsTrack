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
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    dot: 'bg-slate-400',
  },
  medium: {
    label: 'Medium',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    dot: 'bg-blue-500',
  },
  high: {
    label: 'High',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
  },
  critical: {
    label: 'Critical',
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-500',
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
