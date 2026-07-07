import React from 'react';
import { Badge } from '@/components/ui/badge';
import { STAGE_META } from '@/lib/task-options';
import type { TaskStage } from '@/lib/types';

interface StageBadgeProps {
  stage: TaskStage;
  /** 'client' renders the softer portal wording (e.g. "Waiting on you"). */
  viewer?: 'staff' | 'client';
  className?: string;
}

export function StageBadge({ stage, viewer = 'staff', className }: StageBadgeProps) {
  const meta = STAGE_META[stage];
  if (!meta) return <Badge className={className}>{stage}</Badge>;
  return (
    <Badge variant={meta.badge} dot={stage === 'waiting_client'} className={className}>
      {viewer === 'client' ? meta.clientLabel : meta.label}
    </Badge>
  );
}
