'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requestPasswordResetAction } from './actions';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const formData = new FormData();
    formData.set('email', email);

    startTransition(async () => {
      const result = await requestPasswordResetAction(formData);
      if (!result.success) {
        // Only reachable for real input-validation errors (e.g. empty
        // field) — the action is deliberately identical for "account
        // exists" vs "account doesn't exist", so this branch never leaks
        // that distinction.
        setError(result.error || 'Something went wrong. Please try again.');
        return;
      }
      setSubmitted(true);
    });
  };

  if (submitted) {
    return (
      <div className="animate-fade-in">
        <h2 className="text-2xl font-bold text-[var(--color-text)] mb-1">
          Check your email
        </h2>
        <p className="text-[var(--color-text-secondary)] mb-6">
          If an account exists for <strong>{email}</strong>, we&apos;ve sent a
          link to reset your password. It expires soon and can only be used
          once.
        </p>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Didn&apos;t get it? Check your spam folder, or{' '}
          <button
            onClick={() => setSubmitted(false)}
            className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
          >
            try again
          </button>
          .
        </p>
        <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
          <Link
            href="/login"
            className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-bold text-[var(--color-text)] mb-1">
        Forgot your password?
      </h2>
      <p className="text-[var(--color-text-secondary)] mb-8">
        Enter your email and we&apos;ll send you a link to reset it.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          placeholder="you@yourfirm.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        {error && (
          <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <Button type="submit" loading={isPending} className="w-full">
          Send reset link
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
        <Link
          href="/login"
          className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
