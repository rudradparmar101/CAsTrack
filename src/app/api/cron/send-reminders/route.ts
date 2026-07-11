import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFirmPartnerId } from '@/lib/compliance/generation';
import { sendStatutoryReminders, sendWaitingClientNags } from '@/lib/compliance/reminders';

/**
 * Scheduled reminder sweep, across every firm — same shape as
 * /api/cron/generate-statutory-tasks (service-role, CRON_SECRET-gated, safe
 * to re-run daily; idempotency lives in task_activities, not this route).
 *
 * Example vercel.json entry:
 *   { "path": "/api/cron/send-reminders", "schedule": "0 4 * * *" }
 * (run after generate-statutory-tasks so same-day-generated statutory tasks
 * are eligible for their own T-7 reminder immediately.)
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
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const { data: firms, error: firmsError } = await admin.from('firms').select('id, name');
  if (firmsError) {
    return NextResponse.json({ error: firmsError.message }, { status: 500 });
  }

  const results: { firmId: string; firmName: string; summary?: unknown; error?: string }[] = [];

  for (const firm of firms || []) {
    const partnerId = await getFirmPartnerId(admin, firm.id);
    if (!partnerId) {
      results.push({ firmId: firm.id, firmName: firm.name, error: 'No active partner to attribute reminders to' });
      continue;
    }
    try {
      const [statutory, nags] = await Promise.all([
        sendStatutoryReminders(admin, firm.id, partnerId, firm.name, siteUrl),
        sendWaitingClientNags(admin, firm.id, partnerId, firm.name, siteUrl),
      ]);
      results.push({ firmId: firm.id, firmName: firm.name, summary: { ...statutory, ...nags } });
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
