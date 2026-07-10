import React from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { getAuthContext } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { StageBadge } from '@/components/task/stage-badge';
import { GenerateButton } from './generate-button';
import { isApplicable } from '@/lib/compliance/generation';
import { currentPeriod } from '@/lib/compliance/period';
import type { Client, ClientRegistration, ComplianceType, TaskStage } from '@/lib/types';

/**
 * Filing-status grid (Phase 10c) — "the partner's 18th evening screen":
 * active clients x active compliance types, for the CURRENT period of each
 * type (monthly types show this month, quarterly this quarter, annual this
 * FY). A historical/period-selector view is a reasonable follow-up, not
 * built here — this covers the primary day-to-day use case.
 */
export default async function CompliancePage() {
  const { supabase, profile } = await getAuthContext();
  const isPartner = profile.role === 'partner';
  const canView = isPartner || (await supabase.rpc('has_permission', { p_key: 'reports.view' })).data === true;

  if (!canView) {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-10 w-10" />}
        title="No access"
        description="You don't have permission to view the compliance filing-status grid."
      />
    );
  }

  const [{ data: complianceTypes }, { data: clients }, { data: registrations }] = await Promise.all([
    supabase
      .from('compliance_types')
      .select('*')
      .eq('is_active', true)
      .order('department_code', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('clients')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase.from('client_registrations').select('*').eq('is_active', true),
  ]);

  const types = (complianceTypes as ComplianceType[]) || [];
  const activeClients = (clients as Client[]) || [];
  const registrationsByClient = new Map<string, ClientRegistration[]>();
  for (const reg of (registrations as ClientRegistration[]) || []) {
    const list = registrationsByClient.get(reg.client_id) || [];
    list.push(reg);
    registrationsByClient.set(reg.client_id, list);
  }

  // Current period key per compliance type, so the task lookup below matches
  // exactly what the generation engine would have used for "today".
  const now = new Date();
  const periodKeyByType = new Map<string, string>();
  for (const ct of types) {
    periodKeyByType.set(ct.id, currentPeriod(ct.periodicity, now).periodKey);
  }

  const { data: statutoryTasks } = types.length
    ? await supabase
        .from('tasks')
        .select('id, client_id, compliance_type_id, period_key, stage')
        .eq('source', 'statutory')
        .in('compliance_type_id', types.map((t) => t.id))
    : { data: [] };

  const taskByKey = new Map<string, { id: string; stage: TaskStage }>();
  for (const t of (statutoryTasks as { id: string; client_id: string; compliance_type_id: string; period_key: string; stage: TaskStage }[]) || []) {
    taskByKey.set(`${t.client_id}|${t.compliance_type_id}|${t.period_key}`, { id: t.id, stage: t.stage });
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Filing Status</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Current-period statutory filings across every active client.
          </p>
        </div>
        {isPartner && <GenerateButton />}
      </div>

      <Card className="overflow-x-auto" padding={activeClients.length === 0 || types.length === 0 ? 'md' : 'none'}>
        {activeClients.length === 0 || types.length === 0 ? (
          <EmptyState
            title="Nothing to show yet"
            description="Add active clients and registrations, and make sure the compliance-type catalog is seeded, to see the filing-status grid."
          />
        ) : (
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-[var(--color-surface)] text-left px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider whitespace-nowrap">
                  Client
                </th>
                {types.map((ct) => (
                  <th
                    key={ct.id}
                    className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider whitespace-nowrap"
                    title={`${ct.periodicity} · ${periodKeyByType.get(ct.id)}`}
                  >
                    {ct.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {activeClients.map((client) => {
                const regs = registrationsByClient.get(client.id) || [];
                return (
                  <tr key={client.id}>
                    <td className="sticky left-0 bg-[var(--color-surface)] px-3 py-2 font-medium text-[var(--color-text)] whitespace-nowrap">
                      <Link href={`/clients/${client.id}`} className="hover:text-[var(--color-accent)]">
                        {client.name}
                      </Link>
                    </td>
                    {types.map((ct) => {
                      if (!isApplicable(client, regs, ct)) {
                        return (
                          <td key={ct.id} className="px-3 py-2 text-[var(--color-text-muted)]">
                            —
                          </td>
                        );
                      }
                      const periodKey = periodKeyByType.get(ct.id)!;
                      const task = taskByKey.get(`${client.id}|${ct.id}|${periodKey}`);
                      return (
                        <td key={ct.id} className="px-3 py-2">
                          {task ? (
                            <Link href={`/tasks/${task.id}`}>
                              <StageBadge stage={task.stage} />
                            </Link>
                          ) : (
                            <Badge variant="warning">Not generated</Badge>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
