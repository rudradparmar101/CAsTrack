import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { provisionFromMetadata } from '@/lib/provisioning';
import { signOutAction } from './actions';
import { Building2 } from 'lucide-react';

/**
 * Onboarding page — safety net for authenticated users who have no profile
 * (signup interrupted after auth-user creation but before provisioning).
 *
 * It retries the SAME provisioning logic the /auth/callback route uses
 * (lib/provisioning.ts), so a transient failure self-heals here. Crucially,
 * only the create-firm mode can auto-provision from nothing — a failed
 * join-firm or client-invitation shows an error instead, because silently
 * defaulting those users into a brand-new firm would be wrong (they belong
 * to an EXISTING firm/client that we couldn't resolve).
 */
export default async function OnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not authenticated — redirect to login
  if (!user) {
    redirect('/login');
  }

  // Already provisioned? Route by role.
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (existingProfile) {
    redirect(existingProfile.role === 'client_user' ? '/portal' : '/dashboard');
  }

  // Retry provisioning based on signup_mode metadata (service-role writes —
  // the CA schema has no INSERT policies on firms/profiles by design).
  const adminClient = createAdminClient();
  const result = await provisionFromMetadata(adminClient, user);

  if (result.ok) {
    redirect(result.homePath);
  }

  return <OnboardingError message={result.reason} />;
}

function OnboardingError({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
      <div className="max-w-md w-full mx-auto p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-xl bg-[var(--color-accent)] flex items-center justify-center">
            <Building2 className="h-5 w-5 text-[var(--color-accent-foreground)]" />
          </div>
          <span className="text-xl font-bold text-[var(--color-text)]">
            CA Firm Manager
          </span>
        </div>

        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-2">
          We couldn&apos;t finish setting up your account
        </h1>

        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)] mb-6">
          {message}
        </div>

        <a
          href="/onboarding"
          className="inline-flex items-center justify-center w-full px-4 py-2.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-foreground)] font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Retry Setup
        </a>

        <form action={signOutAction} className="mt-3">
          <button
            type="submit"
            className="inline-flex items-center justify-center w-full px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] font-medium hover:bg-[var(--color-muted)] transition-colors"
          >
            Sign out and start over
          </button>
        </form>
      </div>
    </div>
  );
}
