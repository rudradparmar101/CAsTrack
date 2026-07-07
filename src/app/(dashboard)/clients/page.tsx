import React from 'react';
import { getAuthContext } from '@/lib/auth';
import { ClientsPageClient } from './clients-page-client';
import { CLIENTS_PAGE_SIZE } from '@/lib/pagination';

export default async function ClientsPage() {
  const { supabase, profile } = await getAuthContext();
  // No role redirect here: employees may view this page too — RLS decides
  // which clients they see (clients.view permission or a task against the
  // client). client_users never reach it (middleware + dashboard layout).

  const canManage =
    profile.role === 'partner'
      ? true
      : (await supabase.rpc('has_permission', { p_key: 'clients.manage' })).data === true;

  const { data: clients } = await supabase
    .from('clients')
    .select('*, creator:created_by(id, name)')
    .order('created_at', { ascending: false })
    .range(0, CLIENTS_PAGE_SIZE - 1);

  return (
    <ClientsPageClient
      clients={clients || []}
      initialHasMore={(clients || []).length === CLIENTS_PAGE_SIZE}
      canManage={canManage}
    />
  );
}
