'use client';

import React, { useState } from 'react';
import { Copy, Check, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { regenerateInviteCodeAction } from './actions';

export function TeamInviteCode({ inviteCode }: { inviteCode: string }) {
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for clipboard API not available
      const textArea = document.createElement('textarea');
      textArea.value = inviteCode;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRegenerate = async () => {
    if (!confirm('Regenerate invite code? The old code will stop working immediately. Anyone who has it will no longer be able to join.')) return;
    setRegenerating(true);
    setError('');
    const result = await regenerateInviteCodeAction();
    if (!result.success) {
      setError(result.error || 'Failed to regenerate');
    }
    setRegenerating(false);
  };

  return (
    <Card className="bg-[var(--color-accent-muted)] border-[var(--color-border)]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            Invite Code
          </h3>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Share this code with new employees so they can join your firm.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm font-mono font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)] transition-colors"
          >
            {inviteCode}
            {copied ? (
              <Check className="h-4 w-4 text-[var(--color-success)]" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
          <Button
            variant="ghost"
            size="sm"
            loading={regenerating}
            onClick={handleRegenerate}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-danger)]"
            title="Regenerate invite code"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {error && (
        <p className="text-xs text-[var(--color-danger)] mt-2">{error}</p>
      )}
    </Card>
  );
}
