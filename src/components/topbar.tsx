'use client';

import React, { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Menu, Moon, Sun, Clock } from 'lucide-react';
import type { Profile } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { NotificationBell } from '@/components/notification-bell';
import { useTheme } from '@/components/theme-provider';

const noopSubscribe = () => () => {};

/** Server can't know a returning visitor's saved theme preference, so it
 *  always renders as light. useSyncExternalStore (not a setState-in-effect)
 *  is the React-sanctioned way to defer client-only values past hydration. */
function useIsMounted() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

interface TopbarProps {
  profile: Profile;
  onMenuClick: () => void;
}

export function Topbar({ profile, onMenuClick }: TopbarProps) {
  const { theme, toggleTheme } = useTheme();
  const mounted = useIsMounted();
  const isDark = mounted && theme === 'dark';

  return (
    <header className="sticky top-0 z-30 h-16 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center px-4 sm:px-6 gap-4">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-muted)] transition-colors focus-ring"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* App/firm branding — single source of truth, sidebar doesn't repeat it. */}
      <Link href="/dashboard" className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-[var(--color-accent)] flex items-center justify-center shrink-0">
          <Clock className="h-4 w-4 text-[var(--color-accent-foreground)]" />
        </div>
        <span className="hidden sm:block text-base font-semibold text-[var(--color-text)]">
          CA Firm Manager
        </span>
      </Link>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-muted)] transition-colors focus-ring"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </button>
        <NotificationBell />
        <Badge variant={profile.role === 'partner' ? 'info' : 'default'}>
          {profile.role === 'partner' ? 'Partner' : 'Employee'}
        </Badge>
        <div className="h-8 w-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-[var(--color-accent-foreground)] text-sm font-medium">
          {profile.name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)}
        </div>
      </div>
    </header>
  );
}
