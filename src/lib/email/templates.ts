/**
 * Shared HTML email layout (Phase 11). Inline styles only — email clients
 * don't load external CSS. Colors are the light-mode design tokens from
 * globals.css (an email has no dark-mode toggle to react to).
 */
function layout(params: {
  preheader?: string;
  heading: string;
  bodyHtml: string;
  ctaUrl?: string;
  ctaLabel?: string;
  firmName?: string;
}): string {
  const { preheader, heading, bodyHtml, ctaUrl, ctaLabel, firmName } = params;
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
                <span style="color:#ffffff;font-size:16px;font-weight:700;">${firmName || 'CA Firm Manager'}</span>
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
    bodyHtml: `<p style="margin:0;">${params.message}</p>`,
    ctaUrl: params.ctaUrl,
    ctaLabel: 'Open in CA Firm Manager',
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
      <p style="margin:0 0 12px;">${params.firmName} has set up portal access for <strong>${params.clientName}</strong>. Use the button below to accept the invitation and sign in — you'll be able to track your compliance tasks, exchange documents, and message your CA firm directly.</p>
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
    bodyHtml: `<p style="margin:0 0 12px;">Hello ${params.clientName},</p>
      <p style="margin:0 0 12px;">This is a reminder that <strong>${params.taskTitle}</strong>${params.periodLabel ? ` (${params.periodLabel})` : ''} is due on <strong>${params.dueDate}</strong>. Please share any pending documents or information with ${params.firmName} at the earliest.</p>`,
    ctaUrl: params.portalUrl,
    ctaLabel: 'View in client portal',
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
    bodyHtml: `<p style="margin:0 0 12px;">Hello ${params.clientName},</p>
      <p style="margin:0 0 12px;">${params.firmName} has been waiting on you for <strong>${params.taskTitle}</strong> for ${params.daysWaiting} day${params.daysWaiting === 1 ? '' : 's'}. Please check the task for what's needed so work can continue.</p>`,
    ctaUrl: params.portalUrl,
    ctaLabel: 'View in client portal',
    firmName: params.firmName,
  });
}
