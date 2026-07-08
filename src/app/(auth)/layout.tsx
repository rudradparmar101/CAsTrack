import React from 'react';
import { Clock } from 'lucide-react';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* Left — Branding Panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-[var(--color-sidebar)] flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[var(--color-accent)] flex items-center justify-center">
            <Clock className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-white">CA Firm Manager</span>
        </div>

        <div className="space-y-6">
          <h1 className="text-4xl font-bold text-white leading-tight">
            Never miss a<br />
            client deadline<br />
            <span className="text-[var(--color-accent)]">again.</span>
          </h1>
          <p className="text-[var(--color-sidebar-text)] text-lg max-w-md">
            The simple task management tool built for accounting firms.
            Track deadlines, assign work, stay organized.
          </p>
        </div>

        <p className="text-[var(--color-sidebar-text)] text-sm">
          © {new Date().getFullYear()} CA Firm Manager. All rights reserved.
        </p>
      </div>

      {/* Right — Auth Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="h-10 w-10 rounded-xl bg-[var(--color-accent)] flex items-center justify-center">
              <Clock className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-[var(--color-text)]">
              CA Firm Manager
            </span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
