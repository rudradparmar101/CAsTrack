import React from 'react';

export default function ClientDetailLoading() {
  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      {/* Back link skeleton */}
      <div className="h-4 w-28 bg-[var(--color-border)] rounded" />

      {/* Client header skeleton */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-6">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-5 w-5 bg-[var(--color-border)] rounded" />
          <div
            className="h-7 w-48 rounded-lg"
            style={{
              animation: 'shimmer 1.5s infinite linear',
              backgroundSize: '200% 100%',
              backgroundImage: 'linear-gradient(90deg, var(--color-border) 25%, var(--color-background) 50%, var(--color-border) 75%)',
            }}
          />
        </div>
        <div className="h-4 w-64 bg-[var(--color-border)] rounded mt-2" />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-[var(--color-border)]">
          {[...Array(4)].map((_, i) => (
            <div key={i}>
              <div className="h-3 w-16 bg-[var(--color-border)] rounded mb-2" />
              <div
                className="h-8 w-12 rounded"
                style={{
                  animation: 'shimmer 1.5s infinite linear',
                  backgroundSize: '200% 100%',
                  backgroundImage: 'linear-gradient(90deg, var(--color-border) 25%, var(--color-background) 50%, var(--color-border) 75%)',
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Task cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4"
          >
            <div className="flex justify-between mb-3">
              <div className="space-y-2 flex-1">
                <div
                  className="h-4 w-3/4 rounded"
                  style={{
                    animation: 'shimmer 1.5s infinite linear',
                    backgroundSize: '200% 100%',
                    backgroundImage: 'linear-gradient(90deg, var(--color-border) 25%, var(--color-background) 50%, var(--color-border) 75%)',
                  }}
                />
                <div className="h-3 w-1/2 bg-[var(--color-border)] rounded" />
              </div>
              <div className="h-5 w-16 bg-[var(--color-border)] rounded-full" />
            </div>
            <div className="flex gap-3 mt-2">
              <div className="h-3 w-20 bg-[var(--color-border)] rounded" />
              <div className="h-3 w-16 bg-[var(--color-border)] rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
