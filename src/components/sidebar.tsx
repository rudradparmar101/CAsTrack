'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Profile, Firm } from '@/lib/types';
import {
  LayoutDashboard,
  Users,
  CheckSquare,
  UsersRound,
  Settings,
  LogOut,
  Clock,
  X,
  LayoutTemplate,
} from 'lucide-react';

interface SidebarProps {
  profile: Profile;
  firm: Firm;
  open: boolean;
  onClose: () => void;
}

const adminNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/templates', label: 'Templates', icon: LayoutTemplate },
  { href: '/team', label: 'Team', icon: UsersRound },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const memberNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ profile, firm, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  // CA roles: partners get the full staff nav; employees get the scoped one
  // (RLS decides what they see inside each page).
  const navItems = profile.role === 'partner' ? adminNavItems : memberNavItems;

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-full w-64
          bg-[var(--color-sidebar)] flex flex-col
          transition-transform duration-200 ease-in-out
          lg:translate-x-0 lg:static lg:z-auto
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-[var(--color-accent)] flex items-center justify-center">
              <Clock className="h-4 w-4 text-[var(--color-accent-foreground)]" />
            </div>
            <span className="text-base font-semibold text-white">
              CA Firm Manager
            </span>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1 text-[var(--color-sidebar-text)] hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Firm */}
        <div className="px-5 py-3 border-b border-white/10">
          <p className="text-xs font-medium text-[var(--color-sidebar-text)] uppercase tracking-wider">
            Firm
          </p>
          <p className="text-sm font-medium text-[var(--color-sidebar-active)] mt-1 truncate">
            {firm.name}
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg
                  text-sm font-medium transition-colors duration-150
                  ${
                    isActive
                      ? 'bg-white/10 text-white'
                      : 'text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-active)]'
                  }
                `}
              >
                <item.icon className="h-[18px] w-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User & Logout */}
        <div className="px-3 py-4 border-t border-white/10">
          <div className="px-3 py-2 mb-2">
            <p className="text-sm font-medium text-[var(--color-sidebar-active)] truncate">
              {profile.name}
            </p>
            <p className="text-xs text-[var(--color-sidebar-text)] capitalize">
              {profile.role}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-active)] transition-colors"
          >
            <LogOut className="h-[18px] w-[18px]" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
