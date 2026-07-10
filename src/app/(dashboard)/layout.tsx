import React from 'react';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, firm } = await getAuthContext();

  // Defense-in-depth on top of middleware + RLS: the staff surface must never
  // render for a client portal login, even if middleware is bypassed.
  if (profile.role === 'client_user') {
    redirect('/portal');
  }

  return (
    <DashboardShell profile={profile} firm={firm}>
      {children}
    </DashboardShell>
  );
}
