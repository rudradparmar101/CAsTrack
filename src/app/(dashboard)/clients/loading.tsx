import React from 'react';

export default function ClientsLoading() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-32 bg-[var(--color-border)] rounded-lg" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, var(--color-border) 25%, var(--color-muted) 50%, var(--color-border) 75%)' }} />
          <div className="h-4 w-20 bg-[var(--color-muted)] rounded" />
        </div>
        <div className="h-10 w-28 bg-[var(--color-border)] rounded-lg" />
      </div>

      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center px-6 py-4 border-b border-[var(--color-border)] last:border-0">
            <div className="h-4 w-40 bg-[var(--color-border)] rounded" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, var(--color-border) 25%, var(--color-muted) 50%, var(--color-border) 75%)' }} />
            <div className="flex-1" />
            <div className="h-4 w-24 bg-[var(--color-muted)] rounded hidden sm:block" />
            <div className="ml-6 h-4 w-20 bg-[var(--color-muted)] rounded hidden md:block" />
            <div className="ml-6 flex gap-1">
              <div className="h-8 w-8 bg-[var(--color-muted)] rounded-lg" />
              <div className="h-8 w-8 bg-[var(--color-muted)] rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
