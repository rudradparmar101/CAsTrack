import { Resend } from 'resend';

/**
 * Channel-agnostic email sending (Phase 11). The rest of the app never
 * touches the Resend SDK directly — this is the one place a future
 * WhatsApp/SMS channel would sit alongside, keyed off the same
 * `sendEmail()` call sites (per docs/ROADMAP.md Phase 11's "channel-agnostic
 * sender" decision).
 *
 * Fire-and-forget by convention, matching lib/tasks/activity.ts: a failed
 * send is logged and swallowed, never thrown, so email delivery can never
 * block the mutation that triggered it.
 *
 * TEST-MODE REDIRECT: until a sending domain is verified in Resend, the
 * shared onboarding@resend.dev sender only delivers to the Resend account
 * owner's own inbox. RESEND_TEST_RECIPIENT (set in .env.local) redirects
 * every send there regardless of the intended recipient, prefixing the
 * subject with the real recipient for traceability. Remove
 * RESEND_TEST_RECIPIENT and point RESEND_FROM_EMAIL at a verified domain
 * before the pilot checkpoint (tracked in docs/ROADMAP.md).
 */

let client: Resend | null = null;
function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const resend = getClient();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not configured — skipping send:', params.subject);
    return;
  }

  const testRecipient = process.env.RESEND_TEST_RECIPIENT;
  const from = process.env.RESEND_FROM_EMAIL || 'CA Firm Manager <onboarding@resend.dev>';
  const redirected = !!testRecipient && testRecipient !== params.to;
  const to = testRecipient || params.to;
  const subject = redirected ? `[to: ${params.to}] ${params.subject}` : params.subject;

  try {
    const { error } = await resend.emails.send({ from, to, subject, html: params.html });
    if (error) console.error('[email] Send failed:', error);
  } catch (err) {
    console.error('[email] Send failed:', err);
  }
}
