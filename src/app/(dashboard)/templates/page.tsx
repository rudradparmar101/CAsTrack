import React from 'react';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import { TemplatesPageClient } from './templates-page-client';
import type { FirmTaskTemplate } from '@/lib/types';

export default async function TemplatesPage() {
  const { supabase, profile } = await getAuthContext();

  if (profile.role !== 'partner') {
    const { data: allowed } = await supabase.rpc('has_permission', {
      p_key: 'templates.manage',
    });
    if (allowed !== true) {
      redirect('/dashboard');
    }
  }

  const [{ data: templates }, { data: departments }] = await Promise.all([
    supabase.from('task_templates').select('*').order('created_at', { ascending: false }),
    supabase.from('departments').select('id, name').order('name'),
  ]);

  return (
    <TemplatesPageClient
      templates={(templates as FirmTaskTemplate[]) || []}
      departments={departments || []}
    />
  );
}
