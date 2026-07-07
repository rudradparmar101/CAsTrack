import React from 'react';

export default function SettingsLoading() {
  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div className="space-y-2">
        <div className="h-8 w-28 bg-gray-200 rounded-lg" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%)' }} />
        <div className="h-4 w-56 bg-gray-100 rounded" />
      </div>

      {/* Profile card skeleton */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-5 w-16 bg-gray-200 rounded" />
          <div className="h-6 w-14 bg-gray-100 rounded-full" />
        </div>
        <div className="space-y-1.5">
          <div className="h-4 w-12 bg-gray-100 rounded" />
          <div className="h-10 w-full bg-gray-100 rounded-lg" />
        </div>
        <div className="space-y-1.5">
          <div className="h-4 w-12 bg-gray-100 rounded" />
          <div className="h-10 w-full bg-gray-100 rounded-lg" />
        </div>
        <div className="flex justify-end">
          <div className="h-9 w-28 bg-gray-200 rounded-lg" />
        </div>
      </div>

      {/* Org card skeleton */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5 space-y-4">
        <div className="h-5 w-24 bg-gray-200 rounded" />
        <div className="space-y-1.5">
          <div className="h-4 w-32 bg-gray-100 rounded" />
          <div className="h-10 w-full bg-gray-100 rounded-lg" />
        </div>
        <div className="space-y-1.5">
          <div className="h-4 w-20 bg-gray-100 rounded" />
          <div className="h-10 w-full bg-gray-100 rounded-lg" />
        </div>
        <div className="flex justify-end">
          <div className="h-9 w-36 bg-gray-200 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
