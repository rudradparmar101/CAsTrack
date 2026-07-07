import React from 'react';

/**
 * Loading skeleton for dashboard pages.
 * Displayed while Server Components are fetching data.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-8 w-48 bg-gray-200 rounded-lg" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%)' }} />
        <div className="h-4 w-72 bg-gray-100 rounded" />
      </div>

      {/* Stats row skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-gray-100 rounded-lg" />
              <div className="space-y-1.5">
                <div className="h-7 w-12 bg-gray-200 rounded" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%)' }} />
                <div className="h-3 w-20 bg-gray-100 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Content skeleton */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 space-y-3"
          >
            <div className="flex justify-between">
              <div className="space-y-1.5">
                <div className="h-4 w-32 bg-gray-200 rounded" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%)' }} />
                <div className="h-3 w-24 bg-gray-100 rounded" />
              </div>
              <div className="h-6 w-16 bg-gray-100 rounded-full" />
            </div>
            <div className="h-3 w-28 bg-gray-100 rounded" />
            <div className="h-px bg-[var(--color-border)]" />
            <div className="h-8 w-20 bg-gray-100 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
