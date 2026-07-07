'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { Mail, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signupCreateFirmAction, signupJoinFirmAction } from './actions';

type SignupMode = 'create' | 'join';

export default function SignupPage() {
  const [mode, setMode] = useState<SignupMode>('create');
  const [error, setError] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [sentEmail, setSentEmail] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;

    startTransition(async () => {
      const action = mode === 'create' ? signupCreateFirmAction : signupJoinFirmAction;
      const result = await action(formData);

      if (!result.success) {
        setError(result.error || 'Something went wrong. Please try again.');
        return;
      }

      if (result.requiresEmailConfirmation) {
        setSentEmail(email);
        setEmailSent(true);
        return;
      }
    });
  };

  // ── Success: "Check your email" screen ──
  if (emailSent) {
    return (
      <div className="animate-fade-in text-center">
        <div className="mx-auto mb-5 h-16 w-16 rounded-2xl bg-[var(--color-success-bg)] flex items-center justify-center">
          <Mail className="h-8 w-8 text-[var(--color-success)]" />
        </div>

        <h2 className="text-2xl font-bold text-[var(--color-text)] mb-2">
          Check your email
        </h2>

        <p className="text-[var(--color-text-secondary)] mb-6 max-w-sm mx-auto">
          We&apos;ve sent a verification link to{' '}
          <span className="font-semibold text-[var(--color-text)]">{sentEmail}</span>.
          Click the link to activate your account.
        </p>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-6">
          <div className="flex items-start gap-3 text-left">
            <CheckCircle2 className="h-5 w-5 text-[var(--color-success)] mt-0.5 shrink-0" />
            <div className="text-sm text-[var(--color-text-secondary)]">
              <p className="font-medium text-[var(--color-text)] mb-1">
                What happens next?
              </p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Open the email from DeadlineTracker</li>
                <li>Click the &quot;Confirm your email&quot; link</li>
                <li>You&apos;ll be automatically signed in</li>
              </ol>
            </div>
          </div>
        </div>

        <p className="text-sm text-[var(--color-text-muted)]">
          Didn&apos;t get the email? Check your spam folder or{' '}
          <button
            onClick={() => {
              setEmailSent(false);
              setSentEmail('');
            }}
            className="text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] font-medium transition-colors"
          >
            try again
          </button>
        </p>

        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          Already verified?{' '}
          <Link
            href="/login"
            className="font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors"
          >
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  // ── Signup form ──
  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-bold text-[var(--color-text)] mb-1">
        Create your account
      </h2>
      <p className="text-[var(--color-text-secondary)] mb-6">
        Get started with DeadlineTracker in minutes.
      </p>

      {/* Mode Toggle */}
      <div className="flex rounded-lg border border-[var(--color-border)] p-1 mb-6 bg-gray-50">
        <button
          type="button"
          onClick={() => setMode('create')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
            mode === 'create'
              ? 'bg-white shadow-sm text-[var(--color-text)]'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
          }`}
        >
          Create Firm
        </button>
        <button
          type="button"
          onClick={() => setMode('join')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
            mode === 'join'
              ? 'bg-white shadow-sm text-[var(--color-text)]'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
          }`}
        >
          Join a Firm
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Full Name"
          name="name"
          type="text"
          placeholder="John Smith"
          required
        />
        <Input
          label="Email"
          name="email"
          type="email"
          placeholder="you@yourfirm.com"
          required
          autoComplete="email"
        />
        <Input
          label="Password"
          name="password"
          type="password"
          placeholder="Min. 6 characters"
          required
          minLength={6}
          autoComplete="new-password"
        />

        {mode === 'create' ? (
          <Input
            label="Firm Name"
            name="firmName"
            type="text"
            placeholder="Sharma & Associates"
            required
            hint="Your CA firm's workspace name."
          />
        ) : (
          <Input
            label="Invite Code"
            name="inviteCode"
            type="text"
            placeholder="e.g., a1b2c3d4e5f6"
            required
            hint="Ask a partner at your firm for the invite code."
          />
        )}

        {error && (
          <div className="rounded-lg bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <Button type="submit" loading={isPending} className="w-full">
          {mode === 'create' ? 'Create Account & Firm' : 'Join & Create Account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
