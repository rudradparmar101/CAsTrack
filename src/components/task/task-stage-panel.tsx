'use client';

import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, GitBranch, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { StageBadge } from '@/components/task/stage-badge';
import { changeTaskStageAction } from '@/app/(dashboard)/tasks/actions';
import {
  TASK_STAGES,
  allowedTransitions,
  transitionLabel,
  stageLabel,
} from '@/lib/task-options';
import type { TaskSource, TaskStage, TaskStageHistoryWithActor } from '@/lib/types';

interface TaskStagePanelProps {
  taskId: string;
  stage: TaskStage;
  hasReviewer: boolean;
  isPartner: boolean;
  /** Whether the viewer holds an UPDATE path on this task (assigned to them,
   *  partner, or department + tasks.update_department). Controls the buttons
   *  only — RLS and the DB trigger remain the enforcement. */
  canUpdate: boolean;
  history: TaskStageHistoryWithActor[];
  /** Statutory tasks (Phase 9/10) get an ARN/filed-date prompt on completion. */
  source: TaskSource;
}

/**
 * The stage machine UI. Employees get exactly the transitions the DB trigger
 * allows from the current stage; partners additionally get a collapsed
 * "force stage" override (which the trigger also permits for their role).
 */
export function TaskStagePanel({
  taskId,
  stage,
  hasReviewer,
  isPartner,
  canUpdate,
  history,
  source,
}: TaskStagePanelProps) {
  const [note, setNote] = useState('');
  const [arn, setArn] = useState('');
  const [filedDate, setFiledDate] = useState('');
  const [pendingStage, setPendingStage] = useState<TaskStage | null>(null);
  const [error, setError] = useState('');
  const [showForce, setShowForce] = useState(false);
  const [forceStage, setForceStage] = useState<TaskStage | ''>('');

  const transitions = allowedTransitions(stage, hasReviewer);
  const isStatutory = source === 'statutory';

  const handleTransition = async (toStage: TaskStage) => {
    setError('');
    setPendingStage(toStage);
    const result = await changeTaskStageAction(
      taskId,
      toStage,
      note.trim() || undefined,
      isStatutory && toStage === 'completed'
        ? { arn: arn.trim() || undefined, filedDate: filedDate || undefined }
        : undefined
    );
    if (!result.success) {
      setError(result.error || 'Failed to change the stage.');
    } else {
      setNote('');
      setArn('');
      setFiledDate('');
      setForceStage('');
    }
    setPendingStage(null);
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-[var(--color-text)] flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-[var(--color-accent)]" />
          Stage
        </h2>
        <StageBadge stage={stage} />
      </div>

      {canUpdate && transitions.length > 0 && (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (e.g. what needs rework)..."
            rows={2}
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-input-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent resize-y"
          />
          {isStatutory && transitions.includes('completed') && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={arn}
                onChange={(e) => setArn(e.target.value)}
                placeholder="ARN / Ack. No. (optional)"
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-input-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
              />
              <input
                type="date"
                value={filedDate}
                onChange={(e) => setFiledDate(e.target.value)}
                aria-label="Filed date"
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-input-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            {transitions.map((toStage) => (
              <Button
                key={toStage}
                size="sm"
                variant={toStage === 'completed' ? 'primary' : 'secondary'}
                loading={pendingStage === toStage}
                disabled={pendingStage !== null}
                onClick={() => handleTransition(toStage)}
                className="justify-between"
              >
                {transitionLabel(stage, toStage)}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ))}
          </div>
          {stage === 'in_progress' && hasReviewer && (
            <p className="text-[11px] text-[var(--color-text-muted)]">
              This task has a reviewer — it must pass review before completion.
            </p>
          )}
        </div>
      )}

      {canUpdate && transitions.length === 0 && !isPartner && (
        <p className="text-sm text-[var(--color-text-muted)]">
          No further transitions from {stageLabel(stage)}.
        </p>
      )}

      {!canUpdate && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Only the assignee, their department (with permission), or a partner can move this task.
        </p>
      )}

      {/* Partner override — the DB trigger exempts partners from the arrows. */}
      {isPartner && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
          <button
            onClick={() => setShowForce(!showForce)}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Partner override
          </button>
          {showForce && (
            <div className="mt-2 flex items-end gap-2">
              <div className="flex-1">
                <Select
                  options={TASK_STAGES.filter((s) => s !== stage).map((s) => ({
                    value: s,
                    label: stageLabel(s),
                  }))}
                  placeholder="Force stage to..."
                  value={forceStage}
                  onChange={(e) => setForceStage(e.target.value as TaskStage)}
                />
              </div>
              <Button
                size="sm"
                variant="danger"
                disabled={!forceStage || pendingStage !== null}
                loading={!!forceStage && pendingStage === forceStage}
                onClick={() => forceStage && handleTransition(forceStage)}
              >
                Force
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      {/* Stage history — written exclusively by the DB trigger (staff-only read). */}
      {history.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
          <p className="text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
            Stage history
          </p>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {history.map((entry) => (
              <div key={entry.id} className="text-xs text-[var(--color-text-secondary)]">
                <span className="font-medium text-[var(--color-text)]">
                  {entry.actor?.name || 'System'}
                </span>{' '}
                {entry.from_stage ? (
                  <>
                    moved {stageLabel(entry.from_stage)} → {stageLabel(entry.to_stage)}
                  </>
                ) : (
                  <>created in {stageLabel(entry.to_stage)}</>
                )}
                <span className="text-[var(--color-text-muted)]">
                  {' · '}
                  {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
