import type { AddressType, BusinessType } from '@/lib/types';

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

// ---- Statutory identifier formats (mirror schema.sql CHECK constraints) ----

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
export const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
export const DIN_RE = /^[0-9]{8}$/;
export const PINCODE_RE = /^[1-9][0-9]{5}$/;
