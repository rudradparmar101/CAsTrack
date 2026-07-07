'use client';

import React from 'react';
import { Menu } from 'lucide-react';
import type { Profile } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { NotificationBell } from '@/components/notification-bell';

interface TopbarProps {
  profile: Profile;
  onMenuClick: () => void;
}

export function Topbar({ profile, onMenuClick }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 h-16 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center px-4 sm:px-6 gap-4">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-gray-100 transition-colors focus-ring"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <NotificationBell />
        <Badge variant={profile.role === 'admin' ? 'info' : 'default'}>
          {profile.role === 'admin' ? 'Admin' : 'Member'}
        </Badge>
        <div className="h-8 w-8 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white text-sm font-medium">
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

