import React from 'react';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import { TemplatesPageClient } from './templates-page-client';
import type { TaskTemplate } from '@/lib/types';

export default async function TemplatesPage() {
  const { supabase, profile } = await getAuthContext();

  if (profile.role !== 'admin') {
    redirect('/dashboard');
  }

  const { data: templates } = await supabase
    .from('task_templates')
    .select('*')
    .order('created_at', { ascending: false });

  return <TemplatesPageClient templates={(templates as TaskTemplate[]) || []} />;
}
