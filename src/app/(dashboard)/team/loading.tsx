import React from 'react';

export default function TeamLoading() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-2">
        <div className="h-8 w-24 bg-gray-200 rounded-lg" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%)' }} />
        <div className="h-4 w-20 bg-gray-100 rounded" />
      </div>

      {/* Invite code skeleton */}
      <div className="bg-[var(--color-primary-light)] rounded-xl border border-indigo-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1.5">
            <div className="h-4 w-24 bg-indigo-100 rounded" />
            <div className="h-3 w-64 bg-indigo-50 rounded" />
          </div>
          <div className="h-10 w-40 bg-white rounded-lg border border-indigo-200" />
        </div>
      </div>

      {/* Table skeleton */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center px-6 py-4 border-b border-[var(--color-border)] last:border-0">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 bg-gray-100 rounded-full" />
              <div className="h-4 w-28 bg-gray-200 rounded" style={{ animation: 'shimmer 1.5s infinite linear', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%)' }} />
            </div>
            <div className="flex-1" />
            <div className="h-4 w-36 bg-gray-100 rounded hidden sm:block" />
            <div className="ml-6 h-6 w-16 bg-gray-100 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
