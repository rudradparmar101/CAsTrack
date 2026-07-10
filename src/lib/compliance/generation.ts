import type { SupabaseClient } from '@supabase/supabase-js';
import { currentPeriod, computeDueDate } from './period';
import type { Client, ClientRegistration, ComplianceType } from '@/lib/types';

/**
 * Idempotent calendar-driven statutory task generation (Phase 10). Locked
 * decision (Phase 9): statutory tasks are generated HERE, on a schedule —
 * never completion-chained (see tasks/actions.ts changeStageCore's
 * source==='statutory' guard).
 *
 * Known scope limitation: tasks are one row per (client, compliance_type,
 * period) — a client with multiple GSTINs (e.g. 2 states) gets ONE
 * consolidated task per GST compliance type per period, not one per GSTIN.
 * Per-registration task granularity would need a `registration_id` column on
 * tasks (out of scope for this phase; flagged as debt).
 */

export interface GenerationSummary {
  created: number;
  skippedExisting: number;
  skippedNoDepartment: number;
  skippedNoDueRule: number;
  notApplicable: number;
  errors: string[];
}

/** Exported for reuse by the filing-status grid (page.tsx), which needs to
 *  tell "not yet generated" apart from "doesn't apply to this client". */
export function isApplicable(client: Client, registrations: ClientRegistration[], ct: ComplianceType): boolean {
  if (ct.requires_registration_type) {
    const matches = registrations.filter((r) => r.is_active && r.type === ct.requires_registration_type);
    if (matches.length === 0) return false;
    if (ct.requires_gst_scheme && !matches.some((r) => r.gst_scheme === ct.requires_gst_scheme)) {
      return false;
    }
  }
  if (ct.requires_flag && (client as unknown as Record<string, unknown>)[ct.requires_flag] !== true) {
    return false;
  }
  // Conflict-pair special case: the generic predicate can only express
  // "must match/be true," never "must be false" (see project_context.md §0
  // risk (3)). itr_non_audit_annual has no requires_flag of its own, so
  // without this it would generate ALONGSIDE itr_audit_annual for an
  // audit-applicable client. Exactly one ITR variant should apply per client.
  if (ct.code === 'itr_non_audit_annual' && client.is_audit_applicable) {
    return false;
  }
  if (
    ct.applicable_business_types &&
    ct.applicable_business_types.length > 0 &&
    !ct.applicable_business_types.includes(client.business_type)
  ) {
    return false;
  }
  return true;
}

/** Resolves the firm's earliest-created active partner — used to attribute
 *  cron-generated tasks (created_by is NOT NULL; there is no "system" actor). */
export async function getFirmPartnerId(
  supabase: SupabaseClient,
  firmId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('firm_id', firmId)
    .eq('role', 'partner')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Generates (upserts, idempotently) statutory tasks for one firm's current
 * period per active client x applicable compliance_type. Safe to re-run:
 * duplicates are caught via the DB's partial unique index
 * (client_id, compliance_type_id, period_key) and counted as skipped, not
 * errors — the same "best-effort, never fail loudly on a legitimate no-op"
 * house style as the Phase 4 recurrence spawn.
 */
export async function generateStatutoryTasksForFirm(
  supabase: SupabaseClient,
  firmId: string,
  actorProfileId: string,
  referenceDate: Date = new Date()
): Promise<GenerationSummary> {
  const summary: GenerationSummary = {
    created: 0,
    skippedExisting: 0,
    skippedNoDepartment: 0,
    skippedNoDueRule: 0,
    notApplicable: 0,
    errors: [],
  };

  const [{ data: complianceTypes }, { data: departments }, { data: clients }, { data: registrations }] =
    await Promise.all([
      supabase.from('compliance_types').select('*').eq('is_active', true),
      supabase.from('departments').select('id, code').eq('firm_id', firmId).eq('is_active', true),
      supabase.from('clients').select('*').eq('firm_id', firmId).eq('is_active', true),
      supabase.from('client_registrations').select('*').eq('firm_id', firmId).eq('is_active', true),
    ]);

  const departmentByCode = new Map<string, string>(
    ((departments as { id: string; code: string }[]) || []).map((d) => [d.code, d.id])
  );
  const registrationsByClient = new Map<string, ClientRegistration[]>();
  for (const reg of (registrations as ClientRegistration[]) || []) {
    const list = registrationsByClient.get(reg.client_id) || [];
    list.push(reg);
    registrationsByClient.set(reg.client_id, list);
  }

  const activeTypes = ((complianceTypes as ComplianceType[]) || []).filter(
    (ct) => ct.periodicity !== 'event' // event/notice-style types aren't calendar-generated
  );

  for (const client of (clients as Client[]) || []) {
    const clientRegs = registrationsByClient.get(client.id) || [];
    for (const ct of activeTypes) {
      if (!isApplicable(client, clientRegs, ct)) {
        summary.notApplicable += 1;
        continue;
      }

      const departmentId = departmentByCode.get(ct.department_code);
      if (!departmentId) {
        summary.skippedNoDepartment += 1;
        continue;
      }

      const period = currentPeriod(ct.periodicity, referenceDate);
      const dueDate = computeDueDate(ct, period);
      if (!dueDate) {
        summary.skippedNoDueRule += 1;
        continue;
      }

      const { error } = await supabase
        .from('tasks')
        .insert({
          firm_id: firmId,
          client_id: client.id,
          department_id: departmentId,
          title: ct.name,
          description: `Auto-generated statutory task for ${period.periodKey}.`,
          priority: 'medium',
          due_date: dueDate,
          statutory_due_date: dueDate,
          financial_year: period.financialYear,
          period_type: period.periodType,
          period_key: period.periodKey,
          source: 'statutory',
          category: 'routine',
          compliance_type_id: ct.id,
          visible_to_client: true,
          created_by: actorProfileId,
        })
        .select('id')
        .single();

      if (error) {
        if (error.code === '23505') {
          summary.skippedExisting += 1;
        } else {
          summary.errors.push(`${client.name} / ${ct.code}: ${error.message}`);
        }
        continue;
      }
      summary.created += 1;
    }
  }

  return summary;
}
