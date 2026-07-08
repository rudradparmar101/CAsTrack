import React from 'react';

export default function TeamLoading() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-2">
        <div className="h-8 w-24 bg-[var(--color-border)] rounded-lg" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, var(--color-border) 25%, var(--color-muted) 50%, var(--color-border) 75%)' }} />
        <div className="h-4 w-20 bg-[var(--color-muted)] rounded" />
      </div>

      {/* Invite code skeleton */}
      <div className="bg-[var(--color-accent-muted)] rounded-xl border border-[var(--color-border)] p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1.5">
            <div className="h-4 w-24 bg-[var(--color-accent-muted)] rounded" />
            <div className="h-3 w-64 bg-[var(--color-accent-muted)] rounded" />
          </div>
          <div className="h-10 w-40 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]" />
        </div>
      </div>

      {/* Table skeleton */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center px-6 py-4 border-b border-[var(--color-border)] last:border-0">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 bg-[var(--color-muted)] rounded-full" />
              <div className="h-4 w-28 bg-[var(--color-border)] rounded" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, var(--color-border) 25%, var(--color-muted) 50%, var(--color-border) 75%)' }} />
            </div>
            <div className="flex-1" />
            <div className="h-4 w-36 bg-[var(--color-muted)] rounded hidden sm:block" />
            <div className="ml-6 h-6 w-16 bg-[var(--color-muted)] rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
