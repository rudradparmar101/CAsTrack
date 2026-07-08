import React from 'react';

export default function TaskDetailLoading() {
  const shimmerStyle = {
    animation: 'shimmer 1.5s infinite linear',
    backgroundSize: '200% 100%',
    backgroundImage:
      'linear-gradient(90deg, var(--color-border) 25%, var(--color-muted) 50%, var(--color-border) 75%)',
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      {/* Back button */}
      <div className="h-5 w-24 bg-[var(--color-border)] rounded" />

      {/* Header card */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <div className="h-7 w-72 bg-[var(--color-border)] rounded-lg" style={shimmerStyle} />
            <div className="h-4 w-40 bg-[var(--color-muted)] rounded" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 w-16 bg-[var(--color-muted)] rounded-full" />
            <div className="h-6 w-16 bg-[var(--color-muted)] rounded-full" />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-2 pt-2">
          <div className="h-4 w-full bg-[var(--color-muted)] rounded" />
          <div className="h-4 w-3/4 bg-[var(--color-muted)] rounded" />
        </div>

        {/* Detail grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-[var(--color-border)]">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-16 bg-[var(--color-muted)] rounded" />
              <div className="h-4 w-24 bg-[var(--color-border)] rounded" style={shimmerStyle} />
            </div>
          ))}
        </div>
      </div>

      {/* Comments placeholder */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-6 space-y-4">
        <div className="h-5 w-24 bg-[var(--color-border)] rounded" style={shimmerStyle} />
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="h-8 w-8 bg-[var(--color-border)] rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-32 bg-[var(--color-muted)] rounded" />
                <div className="h-4 w-full bg-[var(--color-muted)] rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Activity placeholder */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-6 space-y-4">
        <div className="h-5 w-32 bg-[var(--color-border)] rounded" style={shimmerStyle} />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-3 items-center">
              <div className="h-2 w-2 bg-[var(--color-border)] rounded-full" />
              <div className="h-3 w-64 bg-[var(--color-muted)] rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
