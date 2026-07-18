import React from 'react';
import Link from 'next/link';
import { FileWarning, Building2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { AcceptInviteForm } from './accept-invite-form';

/**
 * Public landing page for client portal invitations:
 * /portal/accept-invite?token=...
 *
 * Looks up the invitation via the lookup_client_invitation RPC — never a
 * direct SELECT on client_portal_invitations (no policy path exists for
 * unauthenticated users; the SECURITY DEFINER RPC answers only for a valid,
 * unaccepted, unexpired token, so bad tokens all land on the same error).
 */
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return <InvalidInvite />;
  }

  const supabase = await createClient();
  const { data: invitations } = await supabase.rpc('lookup_client_invitation', {
    p_token: token,
  });

  const invitation = Array.isArray(invitations) ? invitations[0] : invitations;

  if (!invitation) {
    return <InvalidInvite />;
  }

  return (
    <PageShell>
      <h1 className="text-2xl font-bold text-[var(--color-text)] mb-2">
        You&apos;re invited to the client portal
      </h1>
      <p className="text-[var(--color-text-secondary)] mb-6">
        Set a password to activate your account and track your compliance work.
      </p>
      <AcceptInviteForm token={token} email={invitation.email} />
    </PageShell>
  );
}

function InvalidInvite() {
  return (
    <PageShell>
      <div className="mx-auto mb-5 h-16 w-16 rounded-2xl bg-[var(--color-danger-bg)] flex items-center justify-center">
        <FileWarning className="h-8 w-8 text-[var(--color-danger)]" />
      </div>
      <h1 className="text-2xl font-bold text-[var(--color-text)] mb-2 text-center">
        This invitation isn&apos;t valid
      </h1>
      <p className="text-[var(--color-text-secondary)] text-center mb-6">
        The link is invalid, has expired, or was already used. Please ask your
        CA firm to send you a new invitation.
      </p>
      <p className="text-center text-sm text-[var(--color-text-secondary)]">
        Already activated your account?{' '}
        <Link
          href="/login"
          className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
        >
          Sign in
        </Link>
      </p>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] px-4">
      <div className="max-w-md w-full">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="h-10 w-10 rounded-xl bg-[var(--color-accent)] flex items-center justify-center">
            <Building2 className="h-5 w-5 text-[var(--color-accent-foreground)]" />
          </div>
          <span className="text-xl font-bold text-[var(--color-text)]">
            Praxida
          </span>
        </div>
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm animate-fade-in">
          {children}
        </div>
      </div>
    </div>
  );
}
