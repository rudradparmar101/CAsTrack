'use client';

import React, { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { acceptClientInviteAction } from './actions';

/**
 * Password-set form for an already-validated invitation. The email is shown
 * read-only (it's fixed by the invitation); on success the server action
 * signs the new client_user in and redirects to /portal.
 */
export function AcceptInviteForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await acceptClientInviteAction(formData);
      // On success the action redirects server-side and never resolves here.
      if (result && !result.success) {
        setError(result.error || 'Something went wrong. Please try again.');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Input
        label="Email"
        type="email"
        value={email}
        readOnly
        disabled
        hint="Your CA firm sent the invitation to this address."
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

      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Button type="submit" loading={isPending} className="w-full">
        Activate account
      </Button>
    </form>
  );
}
