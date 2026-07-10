'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateStatutoryTasksAction } from './actions';

export function GenerateButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleGenerate = async () => {
    setLoading(true);
    setMessage('');
    const result = await generateStatutoryTasksAction();
    if (result.data) {
      const s = result.data;
      setMessage(
        `Created ${s.created}, already existed ${s.skippedExisting}, not applicable ${s.notApplicable}` +
          (s.errors.length ? ` — ${s.errors.length} error(s)` : '')
      );
    } else if (result.error) {
      setMessage(result.error);
    }
    setLoading(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="secondary" size="sm" loading={loading} onClick={handleGenerate}>
        <RefreshCw className="h-4 w-4" />
        Generate now
      </Button>
      {message && <p className="text-xs text-[var(--color-text-secondary)] max-w-sm text-right">{message}</p>}
    </div>
  );
}
