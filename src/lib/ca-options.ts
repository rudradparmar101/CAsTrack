import type { AddressType, AuditType, BusinessType, GstScheme, RegistrationType } from '@/lib/types';

/**
 * Shared option lists + format validators for Indian statutory identifiers.
 * Plain constants (like lib/pagination.ts) so both server actions and client
 * components can import them — deliberately NOT a 'use server' file.
 *
 * The regexes mirror the CHECK constraints in supabase/ca-firm/schema.sql;
 * validating here first turns ugly constraint violations into friendly errors.
 */

export const BUSINESS_TYPE_OPTIONS: { value: BusinessType; label: string }[] = [
  { value: 'individual', label: 'Individual' },
  { value: 'huf', label: 'HUF' },
  { value: 'proprietorship', label: 'Proprietorship' },
  { value: 'partnership', label: 'Partnership Firm' },
  { value: 'llp', label: 'LLP' },
  { value: 'opc', label: 'One Person Company' },
  { value: 'pvt_ltd', label: 'Private Limited' },
  { value: 'public_ltd', label: 'Public Limited' },
  { value: 'trust', label: 'Trust' },
  { value: 'society', label: 'Society' },
  { value: 'aop_boi', label: 'AOP / BOI' },
  { value: 'government', label: 'Government' },
  { value: 'other', label: 'Other' },
];

export const ADDRESS_TYPE_OPTIONS: { value: AddressType; label: string }[] = [
  { value: 'registered', label: 'Registered' },
  { value: 'business', label: 'Business' },
  { value: 'branch', label: 'Branch' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'other', label: 'Other' },
];

export function businessTypeLabel(value: string): string {
  return BUSINESS_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function addressTypeLabel(value: string): string {
  return ADDRESS_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

// ---- Phase 9/10: registrations + audit applicability ----

export const REGISTRATION_TYPE_OPTIONS: { value: RegistrationType; label: string }[] = [
  { value: 'gstin', label: 'GSTIN' },
  { value: 'tan', label: 'TAN' },
  { value: 'pf', label: 'PF (EPFO)' },
  { value: 'esi', label: 'ESI (ESIC)' },
  { value: 'pt', label: 'Professional Tax' },
  { value: 'other', label: 'Other' },
];

export const GST_SCHEME_OPTIONS: { value: GstScheme; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'composition', label: 'Composition' },
  { value: 'qrmp', label: 'QRMP' },
];

export const AUDIT_TYPE_OPTIONS: { value: AuditType; label: string }[] = [
  { value: 'tax_audit', label: 'Tax Audit (44AB)' },
  { value: 'statutory_audit', label: 'Statutory Audit' },
  { value: 'gst_audit', label: 'GST Audit' },
  { value: 'other', label: 'Other' },
];

export function registrationTypeLabel(value: string): string {
  return REGISTRATION_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value.toUpperCase();
}

export function gstSchemeLabel(value: string): string {
  return GST_SCHEME_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function auditTypeLabel(value: string): string {
  return AUDIT_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

// ---- Statutory identifier formats (mirror schema.sql CHECK constraints) ----

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
export const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
export const DIN_RE = /^[0-9]{8}$/;
export const PINCODE_RE = /^[1-9][0-9]{5}$/;
