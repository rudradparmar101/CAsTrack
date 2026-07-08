import React from 'react';

export default function TasksLoading() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-32 bg-[var(--color-border)] rounded-lg" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, var(--color-border) 25%, var(--color-muted) 50%, var(--color-border) 75%)' }} />
          <div className="h-4 w-16 bg-[var(--color-muted)] rounded" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-10 w-48 bg-[var(--color-muted)] rounded-lg" />
          <div className="h-10 w-28 bg-[var(--color-border)] rounded-lg" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 space-y-3"
          >
            <div className="flex justify-between">
              <div className="space-y-1.5">
                <div className="h-4 w-32 bg-[var(--color-border)] rounded" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, var(--color-border) 25%, var(--color-muted) 50%, var(--color-border) 75%)' }} />
                <div className="h-3 w-24 bg-[var(--color-muted)] rounded" />
              </div>
              <div className="h-6 w-16 bg-[var(--color-muted)] rounded-full" />
            </div>
            <div className="h-3 w-28 bg-[var(--color-muted)] rounded" />
            <div className="h-px bg-[var(--color-border)]" />
            <div className="h-8 w-20 bg-[var(--color-muted)] rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
