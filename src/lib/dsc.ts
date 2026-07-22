/**
 * DSC (Digital Signature Certificate) register (Phase 13.2) — pure,
 * dependency-free helpers, same house style as lib/compliance/period.ts.
 */

export type DscExpiryStatus = 'expired' | 'expiring_soon' | 'valid';

const EXPIRING_SOON_WINDOW_DAYS = 30;

/** `expires_on` is a plain DATE column ('YYYY-MM-DD'). Anchoring both sides
 *  to local midnight avoids the UTC-vs-local-calendar-day bug already fixed
 *  once in lib/compliance/reminders.ts's parseDateOnly(). */
export function getDscExpiryStatus(expiresOn: string, referenceDate: Date = new Date()): DscExpiryStatus {
  const expiry = new Date(`${expiresOn}T00:00:00`);
  const ref = new Date(referenceDate);
  ref.setHours(0, 0, 0, 0);
  const diffDays = Math.round((expiry.getTime() - ref.getTime()) / 86_400_000);
  if (diffDays < 0) return 'expired';
  if (diffDays <= EXPIRING_SOON_WINDOW_DAYS) return 'expiring_soon';
  return 'valid';
}

export const DSC_EXPIRY_STATUS_LABEL: Record<DscExpiryStatus, string> = {
  expired: 'Expired',
  expiring_soon: 'Expiring soon',
  valid: 'Valid',
};
