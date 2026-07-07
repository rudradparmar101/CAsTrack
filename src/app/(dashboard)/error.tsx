'use client';

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Error boundary for dashboard pages.
 * Catches runtime errors in Server Components and displays
 * a user-friendly error screen with retry functionality.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[50vh] animate-fade-in">
      <div className="text-center max-w-md mx-auto px-4">
        <div className="h-14 w-14 rounded-2xl bg-[var(--color-danger-bg)] flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="h-7 w-7 text-[var(--color-danger)]" />
        </div>

        <h2 className="text-xl font-bold text-[var(--color-text)] mb-2">
          Something went wrong
        </h2>

        <p className="text-sm text-[var(--color-text-secondary)] mb-6">
          {error.message || 'An unexpected error occurred while loading this page.'}
        </p>

        <div className="flex justify-center gap-3">
          <Button onClick={reset} variant="primary">
            <RotateCcw className="h-4 w-4" />
            Try Again
          </Button>
          <Button
            onClick={() => (window.location.href = '/dashboard')}
            variant="secondary"
          >
            Go to Dashboard
          </Button>
        </div>

        {error.digest && (
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
