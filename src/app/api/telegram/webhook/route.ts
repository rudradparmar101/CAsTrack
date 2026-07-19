import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyTelegram } from '@/lib/notifyTelegram';

/**
 * Telegram bot webhook — Telegram pushes updates here. Only /stats is
 * handled today. Gated two ways: the secret token Telegram echoes back
 * (set via setWebhook's secret_token) and an explicit check that the
 * message came from TG_CHAT, so nobody else who finds this URL or the
 * bot's username can pull firm/user data out of it.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.TG_WEBHOOK_SECRET;
  if (!secret || request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await request.json().catch(() => null);
  const message = update?.message;
  const chatId = message?.chat?.id?.toString();
  const text = (message?.text as string | undefined)?.trim();

  if (!chatId || chatId !== process.env.TG_CHAT || !text) {
    return NextResponse.json({ ok: true });
  }

  if (text === '/stats') {
    await sendStats();
  }

  return NextResponse.json({ ok: true });
}

async function sendStats() {
  const admin = createAdminClient();

  const [{ count: firmCount }, { count: partnerCount }, { count: employeeCount }, { count: clientCount }] =
    await Promise.all([
      admin.from('firms').select('id', { count: 'exact', head: true }),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'partner'),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'employee'),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'client_user'),
    ]);

  const { data: perFirm } = await admin
    .from('firms')
    .select('name, profiles(count)')
    .order('name');

  const { data: recent } = await admin
    .from('profiles')
    .select('name, role, created_at, firms(name)')
    .order('created_at', { ascending: false })
    .limit(10);

  const totalUsers = (partnerCount ?? 0) + (employeeCount ?? 0) + (clientCount ?? 0);

  const perFirmLines = ((perFirm ?? []) as { name: string; profiles: { count: number }[] }[])
    .map((f) => `  ${f.name}: ${f.profiles?.[0]?.count ?? 0}`)
    .join('\n');

  const recentLines = (
    (recent ?? []) as { name: string; role: string; created_at: string; firms: { name: string }[] | null }[]
  )
    .map((p) => `  ${p.name} (${p.role}) @ ${p.firms?.[0]?.name ?? '?'} — ${new Date(p.created_at).toLocaleString()}`)
    .join('\n');

  const message = [
    '📊 Praxida stats',
    `Firms: ${firmCount ?? 0}`,
    `Users: ${totalUsers} (partners ${partnerCount ?? 0}, employees ${employeeCount ?? 0}, clients ${clientCount ?? 0})`,
    '',
    'Per firm:',
    perFirmLines || '  (none)',
    '',
    'Recent signups:',
    recentLines || '  (none)',
  ].join('\n');

  await notifyTelegram(message);
}
