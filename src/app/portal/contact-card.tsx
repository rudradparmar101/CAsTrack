import React from 'react';
import { Mail, Phone, UserRound } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { createClient } from '@/lib/supabase/server';

interface ContactCardProps {
  supabase: Awaited<ReturnType<typeof createClient>>;
  clientId: string;
}

/**
 * "Who is my contact at the firm" (Phase 11) — resolved via the
 * get_client_assigned_contact() SECURITY DEFINER RPC (migration 002), never
 * a direct profiles read (client_users have no SELECT policy on profiles
 * beyond their own row, by design — see ROLES_AND_RLS.md).
 */
export async function ContactCard({ supabase, clientId }: ContactCardProps) {
  const { data } = await supabase
    .rpc('get_client_assigned_contact', { p_client_id: clientId })
    .maybeSingle();

  const contact = data as { name: string; email: string | null; phone: string | null; designation: string | null } | null;
  if (!contact?.name) return null;

  return (
    <Card>
      <h2 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2 mb-3">
        <UserRound className="h-4 w-4 text-[var(--color-accent)]" />
        Your contact at the firm
      </h2>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-[var(--color-accent-muted)] flex items-center justify-center text-[var(--color-accent)] text-sm font-medium shrink-0">
          {contact.name
            .split(' ')
            .map((n: string) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--color-text)] truncate">{contact.name}</p>
          {contact.designation && (
            <p className="text-xs text-[var(--color-text-muted)] truncate">{contact.designation}</p>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-1.5 text-xs text-[var(--color-text-secondary)]">
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="flex items-center gap-1.5 hover:text-[var(--color-accent)] transition-colors">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{contact.email}</span>
          </a>
        )}
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="flex items-center gap-1.5 hover:text-[var(--color-accent)] transition-colors">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            {contact.phone}
          </a>
        )}
      </div>
    </Card>
  );
}
