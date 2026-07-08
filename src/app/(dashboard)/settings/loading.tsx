import React from 'react';

export default function SettingsLoading() {
  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div className="space-y-2">
        <div className="h-8 w-28 bg-[var(--color-border)] rounded-lg" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, var(--color-border) 25%, var(--color-muted) 50%, var(--color-border) 75%)' }} />
        <div className="h-4 w-56 bg-[var(--color-muted)] rounded" />
      </div>

      {/* Profile card skeleton */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-5 w-16 bg-[var(--color-border)] rounded" />
          <div className="h-6 w-14 bg-[var(--color-muted)] rounded-full" />
        </div>
        <div className="space-y-1.5">
          <div className="h-4 w-12 bg-[var(--color-muted)] rounded" />
          <div className="h-10 w-full bg-[var(--color-muted)] rounded-lg" />
        </div>
        <div className="space-y-1.5">
          <div className="h-4 w-12 bg-[var(--color-muted)] rounded" />
          <div className="h-10 w-full bg-[var(--color-muted)] rounded-lg" />
        </div>
        <div className="flex justify-end">
          <div className="h-9 w-28 bg-[var(--color-border)] rounded-lg" />
        </div>
      </div>

      {/* Org card skeleton */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5 space-y-4">
        <div className="h-5 w-24 bg-[var(--color-border)] rounded" />
        <div className="space-y-1.5">
          <div className="h-4 w-32 bg-[var(--color-muted)] rounded" />
          <div className="h-10 w-full bg-[var(--color-muted)] rounded-lg" />
        </div>
        <div className="space-y-1.5">
          <div className="h-4 w-20 bg-[var(--color-muted)] rounded" />
          <div className="h-10 w-full bg-[var(--color-muted)] rounded-lg" />
        </div>
        <div className="flex justify-end">
          <div className="h-9 w-36 bg-[var(--color-border)] rounded-lg" />
        </div>
      </div>
    </div>
  );
}
