/**
 * Shared HTML email layout (Phase 11). Inline styles only — email clients
 * don't load external CSS. Colors are the light-mode design tokens from
 * globals.css (an email has no dark-mode toggle to react to).
 *
 * EVERY user-controlled value interpolated into these templates MUST go
 * through esc() (app-layer security audit, finding M2). Until this change
 * every interpolation was raw, and the values are all user-controlled:
 * taskTitle (any staff with tasks.create), clientName/firmName (clients.manage
 * / signup / firm settings), holderName, rejection reasons, comment text,
 * document names. Those reach the CLIENT's inbox via the reminder, nag,
 * invoice, and portal-invite templates.
 *
 * The risk is not classic XSS — mail clients strip <script>. It is HTML and
 * link injection into a trusted channel: a task titled
 *   </strong></p><a href="https://evil.example/gst-portal">Verify now</a><p>
 * renders a working phishing link inside a legitimate, DKIM-signed email from
 * the firm's own verified domain, in the firm's branding, addressed to that
 * firm's client. For a product whose whole subject is statutory portal
 * deadlines, that is a worse outcome than script execution would be.
 */

/**
 * HTML-escape a value for interpolation into any of the templates below.
 * Escapes the five characters that can break out of text content or an
 * attribute value. Non-string inputs stringify first so a number or null can
 * never slip through unescaped.
 */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a URL destined for an href, and refuse any scheme that could execute.
 * Every ctaUrl today is app-constructed (siteUrl + a fixed path), so this is
 * not closing a live hole — it is making sure a future call site that passes
 * user data here cannot turn the CTA button into a javascript: or data: link.
 * An unusable URL degrades to '#' rather than rendering a dangerous one.
 */
function escUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return '#';
  return esc(trimmed);
}

function layout(params: {
  preheader?: string;
  heading: string;
  bodyHtml: string;
  ctaUrl?: string;
  ctaLabel?: string;
  firmName?: string;
}): string {
  // `bodyHtml` is the ONE parameter deliberately not escaped here: it is
  // template-authored markup assembled by the functions below, each of which
  // escapes its own user-controlled values before embedding them. Never pass
  // caller-supplied text straight into bodyHtml.
  const { bodyHtml } = params;
  const preheader = params.preheader ? esc(params.preheader) : undefined;
  const heading = esc(params.heading);
  const ctaUrl = escUrl(params.ctaUrl);
  const ctaLabel = params.ctaLabel ? esc(params.ctaLabel) : undefined;
  const firmName = params.firmName ? esc(params.firmName) : undefined;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f7f8fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f8fa;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background-color:#0f766e;padding:20px 28px;">
                <span style="color:#ffffff;font-size:16px;font-weight:700;">${firmName || 'Praxida'}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 16px;font-size:18px;color:#12151a;">${heading}</h1>
                <div style="font-size:14px;line-height:1.6;color:#3a3f4b;">${bodyHtml}</div>
                ${
                  ctaUrl
                    ? `<div style="margin-top:24px;">
                        <a href="${ctaUrl}" style="display:inline-block;background-color:#0f766e;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">${ctaLabel || 'Open'}</a>
                      </div>`
                    : ''
                }
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:12px;color:#9aa0ac;">
                  You're receiving this because of activity on your account. If this wasn't expected, please contact your firm.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function notificationEmail(params: {
  title: string;
  message: string;
  ctaUrl?: string;
  firmName?: string;
}): string {
  return layout({
    heading: params.title,
    bodyHtml: `<p style="margin:0;">${esc(params.message)}</p>`,
    ctaUrl: params.ctaUrl,
    ctaLabel: 'Open in Praxida',
    firmName: params.firmName,
  });
}

export function portalInviteEmail(params: {
  clientName: string;
  firmName: string;
  inviteUrl: string;
}): string {
  return layout({
    preheader: `${params.firmName} invited you to their client portal`,
    heading: `You're invited to ${params.firmName}'s client portal`,
    bodyHtml: `<p style="margin:0 0 12px;">Hello,</p>
      <p style="margin:0 0 12px;">${esc(params.firmName)} has set up portal access for <strong>${esc(params.clientName)}</strong>. Use the button below to accept the invitation and sign in — you'll be able to track your compliance tasks, exchange documents, and message your CA firm directly.</p>
      <p style="margin:0;color:#9aa0ac;font-size:13px;">This invite link is personal — please don't forward it.</p>`,
    ctaUrl: params.inviteUrl,
    ctaLabel: 'Accept invitation',
    firmName: params.firmName,
  });
}

export function statutoryReminderEmail(params: {
  clientName: string;
  firmName: string;
  taskTitle: string;
  periodLabel?: string | null;
  dueDate: string;
  daysRemaining: number;
  portalUrl?: string;
}): string {
  const dueText = params.daysRemaining === 1 ? 'due tomorrow' : `due in ${params.daysRemaining} days`;
  return layout({
    preheader: `${params.taskTitle} is ${dueText}`,
    heading: `Reminder: ${params.taskTitle} is ${dueText}`,
    bodyHtml: `<p style="margin:0 0 12px;">Hello ${esc(params.clientName)},</p>
      <p style="margin:0 0 12px;">This is a reminder that <strong>${esc(params.taskTitle)}</strong>${params.periodLabel ? ` (${esc(params.periodLabel)})` : ''} is due on <strong>${esc(params.dueDate)}</strong>. Please share any pending documents or information with ${esc(params.firmName)} at the earliest.</p>`,
    ctaUrl: params.portalUrl,
    ctaLabel: 'View in client portal',
    firmName: params.firmName,
  });
}

export function invoiceIssuedEmail(params: {
  clientName: string;
  firmName: string;
  invoiceNumber: string;
  totalAmount: number;
  dueDate: string | null;
  portalUrl?: string;
}): string {
  const amountText = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(params.totalAmount);
  return layout({
    preheader: `Invoice ${params.invoiceNumber} for ${amountText}`,
    heading: `New invoice from ${params.firmName}`,
    bodyHtml: `<p style="margin:0 0 12px;">Hello ${esc(params.clientName)},</p>
      <p style="margin:0 0 12px;">${esc(params.firmName)} has issued invoice <strong>${esc(params.invoiceNumber)}</strong> for <strong>${esc(amountText)}</strong>${params.dueDate ? `, due on <strong>${esc(params.dueDate)}</strong>` : ''}. You can view the full invoice in your client portal.</p>`,
    ctaUrl: params.portalUrl,
    ctaLabel: 'View invoice in client portal',
    firmName: params.firmName,
  });
}

export function passwordResetEmail(params: {
  resetUrl: string;
}): string {
  return layout({
    preheader: 'Reset your Praxida password',
    heading: 'Reset your password',
    bodyHtml: `<p style="margin:0 0 12px;">We received a request to reset the password on your account. Use the button below to choose a new one.</p>
      <p style="margin:0;color:#9aa0ac;font-size:13px;">If you didn't request this, you can safely ignore this email — your password won't be changed. This link expires soon and can only be used once.</p>`,
    ctaUrl: params.resetUrl,
    ctaLabel: 'Reset password',
  });
}

export function dscExpiryAlertEmail(params: {
  firmName: string;
  holderName: string;
  clientName: string;
  expiresOn: string;
  daysRemaining: number;
  dscUrl: string;
}): string {
  const expiryText = params.daysRemaining === 1 ? 'expires tomorrow' : `expires in ${params.daysRemaining} days`;
  return layout({
    preheader: `${params.holderName}'s DSC ${expiryText}`,
    heading: `DSC ${expiryText}: ${params.holderName}`,
    bodyHtml: `<p style="margin:0 0 12px;">A digital signature token held for <strong>${esc(params.clientName)}</strong> (holder: <strong>${esc(params.holderName)}</strong>) ${esc(expiryText)}, on <strong>${esc(params.expiresOn)}</strong>.</p>
      <p style="margin:0;">Renewing in advance avoids a filing being blocked mid-season.</p>`,
    ctaUrl: params.dscUrl,
    ctaLabel: 'View DSC register',
    firmName: params.firmName,
  });
}

export function waitingClientNagEmail(params: {
  clientName: string;
  firmName: string;
  taskTitle: string;
  daysWaiting: number;
  portalUrl?: string;
}): string {
  return layout({
    preheader: `${params.firmName} is still waiting on you for ${params.taskTitle}`,
    heading: `Action needed: ${params.taskTitle}`,
    bodyHtml: `<p style="margin:0 0 12px;">Hello ${esc(params.clientName)},</p>
      <p style="margin:0 0 12px;">${esc(params.firmName)} has been waiting on you for <strong>${esc(params.taskTitle)}</strong> for ${esc(params.daysWaiting)} day${params.daysWaiting === 1 ? '' : 's'}. Please check the task for what's needed so work can continue.</p>`,
    ctaUrl: params.portalUrl,
    ctaLabel: 'View in client portal',
    firmName: params.firmName,
  });
}
