import React from 'react';
import { KeyRound } from 'lucide-react';
import { getAuthContext } from '@/lib/auth';
import { EmptyState } from '@/components/ui/empty-state';
import { DscPageClient } from './dsc-page-client';
import type {
  Client,
  Profile,
  DscRegisterEntryWithRefs,
  DscCustodyMovementWithRefs,
} from '@/lib/types';

/**
 * DSC register (Phase 13.2, migration 008) — staff-internal only, NO
 * /portal surface (see migration 008's RLS: client_user has no policy on
 * either table at all). Reads AND custody movements are gated by the SAME
 * clients.view permission (partner bypass automatic) — deliberately
 * broader than udin_register's reports.view gate, since custody is
 * day-to-day operational information, not a compliance-reporting surface.
 * Full-record create/edit/deactivate is partner-only.
 */
export default async function DscRegisterPage() {
  const { supabase, profile } = await getAuthContext();
  const isPartner = profile.role === 'partner';
  const canView = isPartner || (await supabase.rpc('has_permission', { p_key: 'clients.view' })).data === true;

  if (!canView) {
    return (
      <EmptyState
        icon={<KeyRound className="h-10 w-10" />}
        title="No access"
        description="You don't have permission to view the DSC register."
      />
    );
  }

  const [{ data: entries }, { data: movements }, { data: clients }, { data: staff }] = await Promise.all([
    supabase
      .from('dsc_register')
      .select('*, client:client_id(id, name), custodian:current_custodian_id(id, name)')
      .order('expires_on', { ascending: true }),
    supabase
      .from('dsc_custody_movements')
      .select(
        '*, from_custodian:from_custodian_id(id, name), to_custodian:to_custodian_id(id, name), recorder:recorded_by(id, name)'
      )
      .order('created_at', { ascending: false }),
    supabase.from('clients').select('id, name').eq('is_active', true).order('name'),
    supabase.from('profiles').select('id, name').in('role', ['partner', 'employee']).eq('is_active', true).order('name'),
  ]);

  return (
    <DscPageClient
      entries={(entries as unknown as DscRegisterEntryWithRefs[]) || []}
      movements={(movements as unknown as DscCustodyMovementWithRefs[]) || []}
      clients={(clients as Pick<Client, 'id' | 'name'>[]) || []}
      staff={(staff as Pick<Profile, 'id' | 'name'>[]) || []}
      currentUserId={profile.id}
      canManage={isPartner}
    />
  );
}
