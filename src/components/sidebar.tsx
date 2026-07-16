'use client';

import React, { useState, useSyncExternalStore } from 'react';
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
  X,
  LayoutTemplate,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
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
  { href: '/compliance', label: 'Filing Status', icon: ShieldCheck },
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

const COLLAPSE_STORAGE_KEY = 'sidebar:collapsed';

const noopSubscribe = () => () => {};

/** Same deferred-client-value pattern as topbar.tsx's theme mount check:
 *  the server can't know the saved collapse preference, so it always
 *  renders expanded; this flips true right after hydration. */
function useIsMounted() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function resolveInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true';
}

export function Sidebar({ profile, firm, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  // CA roles: partners get the full staff nav; employees get the scoped one
  // (RLS decides what they see inside each page).
  const navItems = profile.role === 'partner' ? adminNavItems : memberNavItems;
  const roleLabel = profile.role === 'partner' ? 'Partner' : 'Employee';

  const [collapsedPref, setCollapsedPref] = useState(resolveInitialCollapsed);
  const mounted = useIsMounted();
  // Gated on `mounted` so the first client render matches the server's
  // (always-expanded) markup — a brief expanded-state flash on reload
  // instead of a hydration mismatch, same tradeoff theme already makes.
  const collapsed = mounted && collapsedPref;

  const toggleCollapsed = () => {
    setCollapsedPref((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      return next;
    });
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const initials = profile.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

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
          ${collapsed ? 'lg:w-[72px]' : 'lg:w-60'}
          bg-[var(--color-sidebar)] flex flex-col
          transition-[width,transform] duration-200 ease-in-out
          lg:translate-x-0 lg:static lg:z-auto
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Collapse toggle (desktop) / close (mobile) — no brand header
         *  here: app branding lives in the topbar as the single source of
         *  truth, so the sidebar starts directly with its controls/nav. */}
        <div className="flex items-center justify-end px-3 py-3 border-b border-white/10">
          <button
            onClick={toggleCollapsed}
            className="hidden lg:flex p-1.5 rounded-lg text-[var(--color-sidebar-text)] hover:text-white hover:bg-white/10 transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronRight className="h-[18px] w-[18px]" />
            ) : (
              <ChevronLeft className="h-[18px] w-[18px]" />
            )}
          </button>
          <button
            onClick={onClose}
            className="lg:hidden p-1 text-[var(--color-sidebar-text)] hover:text-white transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
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
                title={item.label}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg
                  text-sm font-medium transition-colors duration-150
                  ${collapsed ? 'lg:justify-center lg:px-2' : ''}
                  ${
                    isActive
                      ? 'bg-white/10 text-white'
                      : 'text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-active)]'
                  }
                `}
              >
                <item.icon className="h-[18px] w-[18px] shrink-0" />
                <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User identity (single source of truth for full name) + logout */}
        <div className="px-3 py-4 border-t border-white/10">
          <div
            className={`flex items-center gap-3 px-3 py-2 mb-2 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}
            title={collapsed ? `${profile.name} — ${roleLabel} · ${firm.name}` : undefined}
          >
            <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-[var(--color-accent-foreground)] text-xs font-semibold">
              {initials}
            </div>
            <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
              <p className="text-sm font-medium text-[var(--color-sidebar-active)] truncate">
                {profile.name}
              </p>
              <p className="text-xs text-[var(--color-sidebar-text)] truncate">
                {roleLabel} · {firm.name}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title={collapsed ? 'Sign out' : undefined}
            className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-active)] transition-colors ${collapsed ? 'lg:justify-center lg:px-2' : ''}`}
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            <span className={collapsed ? 'lg:hidden' : ''}>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
