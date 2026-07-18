import React from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ResetPasswordForm } from './reset-password-form';

/**
 * Reached only via /auth/confirm after a recovery token verifies
 * successfully (which establishes the session this page checks for).
 * Direct navigation, an expired/already-used/invalid token, or a token that
 * failed verification all land here with NO session — the single check
 * below covers every one of those cases uniformly, rather than trying to
 * special-case each failure mode.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="animate-fade-in">
        <h2 className="text-2xl font-bold text-[var(--color-text)] mb-1">
          This link isn&apos;t valid
        </h2>
        <p className="text-[var(--color-text-secondary)] mb-6">
          The password reset link is invalid, has expired, or was already
          used. Please request a new one.
        </p>
        <Link
          href="/forgot-password"
          className="inline-flex items-center justify-center w-full px-4 py-2.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-foreground)] font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return <ResetPasswordForm />;
}
