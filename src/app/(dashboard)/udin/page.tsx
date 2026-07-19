import React from 'react';
import { BadgeCheck } from 'lucide-react';
import { getAuthContext } from '@/lib/auth';
import { EmptyState } from '@/components/ui/empty-state';
import { UdinPageClient } from './udin-page-client';
import type { Client, Profile, UdinRegisterEntryWithRefs } from '@/lib/types';

/**
 * UDIN register (Phase 12.5) — staff-internal only, NO /portal surface (see
 * migration 007's RLS: client_user has no policy on udin_register at all).
 * Reads gated by the SAME reports.view permission the filing-status grid
 * uses; writes are partner-only (see udin/actions.ts).
 */
export default async function UdinRegisterPage() {
  const { supabase, profile } = await getAuthContext();
  const isPartner = profile.role === 'partner';
  const canView = isPartner || (await supabase.rpc('has_permission', { p_key: 'reports.view' })).data === true;

  if (!canView) {
    return (
      <EmptyState
        icon={<BadgeCheck className="h-10 w-10" />}
        title="No access"
        description="You don't have permission to view the UDIN register."
      />
    );
  }

  const [{ data: entries }, { data: clients }, { data: partners }, { data: tasksLite }, { data: documentsLite }] =
    await Promise.all([
      supabase
        .from('udin_register')
        .select('*, client:client_id(id, name), signing_partner:signing_partner_id(id, name), task:task_id(id, title)')
        .order('generated_on', { ascending: false }),
      supabase.from('clients').select('id, name').eq('is_active', true).order('name'),
      supabase.from('profiles').select('id, name').eq('role', 'partner').eq('is_active', true).order('name'),
      supabase.from('tasks').select('id, title, client_id').order('title'),
      supabase.from('documents').select('id, name, client_id').order('name'),
    ]);

  return (
    <UdinPageClient
      entries={(entries as unknown as UdinRegisterEntryWithRefs[]) || []}
      clients={(clients as Pick<Client, 'id' | 'name'>[]) || []}
      partners={(partners as Pick<Profile, 'id' | 'name'>[]) || []}
      tasksLite={(tasksLite as { id: string; title: string; client_id: string }[]) || []}
      documentsLite={(documentsLite as { id: string; name: string; client_id: string }[]) || []}
      canManage={isPartner}
    />
  );
}
