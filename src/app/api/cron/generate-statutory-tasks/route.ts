import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateStatutoryTasksForFirm, getFirmPartnerId } from '@/lib/compliance/generation';

/**
 * Scheduled statutory task generation, across every firm. Configure as a
 * Vercel Cron (vercel.json — see below) hitting this route on whatever
 * cadence the firm wants tasks to appear ahead of due dates (daily is safe:
 * generation is idempotent, a duplicate day's run is a no-op via the DB's
 * partial unique index). Vercel Cron sends requests with a
 * `Authorization: Bearer $CRON_SECRET` header automatically when
 * CRON_SECRET is set in the project's environment variables — set that env
 * var and this route verifies it.
 *
 * Example vercel.json:
 *   { "crons": [{ "path": "/api/cron/generate-statutory-tasks", "schedule": "0 3 * * *" }] }
 *
 * Alternative considered: Supabase pg_cron calling a SECURITY DEFINER SQL
 * function directly in the DB instead of this HTTP route. Not used here so
 * the generation logic stays in one place (lib/compliance/generation.ts),
 * shared with the partner-triggered "Generate now" action, instead of being
 * duplicated in PL/pgSQL.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: firms, error: firmsError } = await admin.from('firms').select('id, name');
  if (firmsError) {
    return NextResponse.json({ error: firmsError.message }, { status: 500 });
  }

  const results: { firmId: string; firmName: string; summary?: unknown; error?: string }[] = [];

  for (const firm of firms || []) {
    const partnerId = await getFirmPartnerId(admin, firm.id);
    if (!partnerId) {
      results.push({ firmId: firm.id, firmName: firm.name, error: 'No active partner to attribute tasks to' });
      continue;
    }
    try {
      const summary = await generateStatutoryTasksForFirm(admin, firm.id, partnerId);
      results.push({ firmId: firm.id, firmName: firm.name, summary });
    } catch (err) {
      results.push({
        firmId: firm.id,
        firmName: firm.name,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({ firmsProcessed: results.length, results });
}
