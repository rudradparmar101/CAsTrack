'use client';

import React, { useState } from 'react';
import type { Profile, Organization } from '@/lib/types';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';

interface DashboardShellProps {
  profile: Profile;
  organization: Organization;
  children: React.ReactNode;
}

export function DashboardShell({
  profile,
  organization,
  children,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        profile={profile}
        organization={organization}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          profile={profile}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
