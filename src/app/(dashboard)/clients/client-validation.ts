import {
  BUSINESS_TYPE_OPTIONS,
  AUDIT_TYPE_OPTIONS,
  GSTIN_RE,
  PAN_RE,
  TAN_RE,
  CIN_RE,
} from '@/lib/ca-options';

/**
 * Plain (non-'use server') module — parseClientFields is a pure sync
 * function, and a 'use server' file requires every export to be async (it's
 * treated as a server action). Kept separate so it stays sync rather than
 * being forced async just to satisfy that constraint. Shared by the
 * FormData-based single-create/edit form (actions.ts) and the CSV bulk
 * importer (import-actions.ts) — one validator, two producers, so bulk
 * import can never drift into a second, weaker rule set.
 */

function opt(value: string | null | undefined): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s === '' ? null : s;
}

function optUpper(value: string | null | undefined): string | null {
  const s = opt(value);
  return s ? s.toUpperCase() : null;
}

export type ClientFieldInput = Record<string, string | null | undefined>;

/** Validates core client fields; returns friendly errors instead of letting
 *  the schema CHECK constraints bubble up as raw Postgres messages. */
export function parseClientFields(input: ClientFieldInput):
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: string } {
  const name = opt(input.name);
  if (!name) return { ok: false, error: 'Client name is required.' };

  const businessType = opt(input.business_type);
  if (!businessType || !BUSINESS_TYPE_OPTIONS.some((o) => o.value === businessType)) {
    return { ok: false, error: 'Please choose a valid business type.' };
  }

  const gstin = optUpper(input.gstin);
  if (gstin && !GSTIN_RE.test(gstin)) {
    return { ok: false, error: 'GSTIN format looks invalid (e.g., 27ABCDE1234F1Z5).' };
  }
  const pan = optUpper(input.pan);
  if (pan && !PAN_RE.test(pan)) {
    return { ok: false, error: 'PAN format looks invalid (e.g., ABCDE1234F).' };
  }
  const tan = optUpper(input.tan);
  if (tan && !TAN_RE.test(tan)) {
    return { ok: false, error: 'TAN format looks invalid (e.g., MUMA12345B).' };
  }
  const cin = optUpper(input.cin);
  if (cin && !CIN_RE.test(cin)) {
    return { ok: false, error: 'CIN format looks invalid (21 characters, starts with L or U).' };
  }

  const auditType = opt(input.audit_type);
  if (auditType && !AUDIT_TYPE_OPTIONS.some((o) => o.value === auditType)) {
    return { ok: false, error: 'Please choose a valid audit type.' };
  }

  const isAuditApplicable = opt(input.is_audit_applicable)?.toLowerCase() === 'true';

  return {
    ok: true,
    values: {
      name,
      trade_name: opt(input.trade_name),
      business_type: businessType,
      gstin,
      pan,
      tan,
      cin,
      incorporation_date: opt(input.incorporation_date),
      gst_registration_date: opt(input.gst_registration_date),
      is_audit_applicable: isAuditApplicable,
      audit_type: isAuditApplicable ? auditType : null,
      email: opt(input.email),
      phone: opt(input.phone),
      notes: opt(input.notes),
    },
  };
}

/** Adapts the create/edit form's FormData into the plain-object shape
 *  parseClientFields expects — the ONLY place FormData-specific extraction
 *  happens, so createClientAction/updateClientAction and the bulk importer
 *  share the exact same validation function above. */
export function clientFieldsFromFormData(formData: FormData): ClientFieldInput {
  const keys = [
    'name',
    'trade_name',
    'business_type',
    'gstin',
    'pan',
    'tan',
    'cin',
    'incorporation_date',
    'gst_registration_date',
    'audit_type',
    'email',
    'phone',
    'notes',
  ] as const;
  const input: ClientFieldInput = {};
  for (const key of keys) {
    input[key] = formData.get(key) as string | null;
  }
  // Preserves the form's existing "true" literal contract exactly (the
  // checkbox's hidden-input-mirror pattern already submits the literal
  // string 'true'/'false' — see client-form.tsx).
  input.is_audit_applicable = formData.get('is_audit_applicable') as string | null;
  return input;
}
