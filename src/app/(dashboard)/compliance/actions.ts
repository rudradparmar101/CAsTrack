'use server';

import { revalidatePath } from 'next/cache';
import { getAuthProfile } from '@/lib/auth';
import { generateStatutoryTasksForFirm, type GenerationSummary } from '@/lib/compliance/generation';
import { checkRateLimit, rateLimitMessage } from '@/lib/rate-limit';
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

  // Keyed by firm, not by user: the cost is the firm's, and two partners
  // clicking "Generate now" in the same minute is the case worth damping.
  // This walks every active client x every applicable compliance type across
  // every department, and it is idempotent — so a repeat run inside the same
  // window is pure waste, not a second useful result.
  const rateLimit = await checkRateLimit('statutory_generation', profile.firm_id);
  if (!rateLimit.allowed) {
    return { success: false, error: rateLimitMessage(rateLimit.retryAfterSeconds) };
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
