import React from 'react';
import Link from 'next/link';
import { Briefcase, Mail, Phone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { businessTypeLabel } from '@/lib/ca-options';
import type { Client } from '@/lib/types';

interface TaskClientCardProps {
  /** Full client row IF the viewer's RLS grants it — employees always see the
   *  clients their tasks reference (employee_has_task_for_client). */
  client: Pick<
    Client,
    'id' | 'name' | 'trade_name' | 'business_type' | 'gstin' | 'pan' | 'email' | 'phone' | 'is_active'
  > | null;
}

/** Client summary on the task detail page (server-renderable). */
export function TaskClientCard({ client }: TaskClientCardProps) {
  return (
    <Card>
      <h2 className="text-base font-semibold text-[var(--color-text)] flex items-center gap-2 mb-3">
        <Briefcase className="h-4 w-4 text-[var(--color-primary)]" />
        Client
      </h2>
      {!client ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          You do not have access to this client&apos;s record.
        </p>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/clients/${client.id}`}
              className="font-medium text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
            >
              {client.name}
            </Link>
            {!client.is_active && <Badge>Inactive</Badge>}
          </div>
          {client.trade_name && (
            <p className="text-xs text-[var(--color-text-muted)]">{client.trade_name}</p>
          )}
          <p className="text-xs text-[var(--color-text-secondary)]">
            {businessTypeLabel(client.business_type)}
          </p>
          {client.gstin && (
            <p className="text-xs text-[var(--color-text-muted)]">
              GSTIN <span className="font-mono text-[var(--color-text)]">{client.gstin}</span>
            </p>
          )}
          {client.pan && (
            <p className="text-xs text-[var(--color-text-muted)]">
              PAN <span className="font-mono text-[var(--color-text)]">{client.pan}</span>
            </p>
          )}
          {client.email && (
            <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
              <Mail className="h-3 w-3" />
              {client.email}
            </p>
          )}
          {client.phone && (
            <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
              <Phone className="h-3 w-3" />
              {client.phone}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
