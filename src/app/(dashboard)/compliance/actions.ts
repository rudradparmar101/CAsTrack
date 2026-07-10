'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import { generateStatutoryTasksForFirm, type GenerationSummary } from '@/lib/compliance/generation';
import type { ActionResultWithData } from '@/lib/types';

/**
 * Statutory task generation is partner-only: the generation engine inserts
 * tasks across every department, and an employee's tasks INSERT policy only
 * admits their OWN departments (schema.sql §11.13) — a non-partner run would
 * silently fail most rows via RLS. Viewing the filing-status grid is broader
 * (gated by reports.view in the grid's own page.tsx), matching the existing
 * "view is permission-gated, this specific write is partner-only" pattern
 * used for Team/Templates management elsewhere in the app.
 */
export async function generateStatutoryTasksAction(): Promise<ActionResultWithData<GenerationSummary>> {
  const { supabase, userId, profile } = await getAuthProfile();

  if (profile.role !== 'partner') {
    return { success: false, error: 'Only a partner can generate statutory tasks.' };
  }

  const summary = await generateStatutoryTasksForFirm(supabase, profile.firm_id, userId);

  revalidatePath('/compliance');
  revalidatePath('/tasks');
  revalidatePath('/dashboard');

  if (summary.errors.length > 0) {
    return {
      success: false,
      error: `Generated ${summary.created} task(s) with ${summary.errors.length} error(s): ${summary.errors.slice(0, 3).join('; ')}`,
      data: summary,
    };
  }
  return { success: true, data: summary };
}
