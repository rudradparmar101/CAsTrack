'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, LogOut, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { updateProfileAction, updateOrganizationAction, changePasswordAction } from './actions';
import { createClient } from '@/lib/supabase/client';
import type { Profile, Firm } from '@/lib/types';

interface SettingsPageClientProps {
  profile: Profile;
  firm: Firm | null;
}

export function SettingsPageClient({ profile, firm }: SettingsPageClientProps) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [isPending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(''), 4000);
  };

  const handleSaveProfile = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateProfileAction(formData);
      if (result.success) {
        showMessage('Profile updated successfully.', 'success');
      } else {
        showMessage(result.error || 'Failed to update profile.', 'error');
      }
    });
  };

  const handleSaveOrg = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateOrganizationAction(formData);
      if (result.success) {
        showMessage('Firm updated successfully.', 'success');
      } else {
        showMessage(result.error || 'Failed to update firm.', 'error');
      }
    });
  };

  const handleChangePassword = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await changePasswordAction(formData);
      if (result.success) {
        showMessage('Password changed successfully.', 'success');
        (e.target as HTMLFormElement).reset();
        setShowPassword(false);
      } else {
        showMessage(result.error || 'Failed to change password.', 'error');
      }
    });
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Settings</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Manage your profile and organization.
        </p>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm animate-fade-in ${
            messageType === 'success'
              ? 'bg-[var(--color-success-bg)] border-[var(--color-success-border)] text-[var(--color-success-text)]'
              : 'bg-[var(--color-danger-bg)] border-[var(--color-danger-border)] text-[var(--color-danger-text)]'
          }`}
        >
          {message}
        </div>
      )}

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <Badge variant={profile.role === 'partner' ? 'info' : 'default'}>
            {profile.role}
          </Badge>
        </CardHeader>
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <Input
            label="Name"
            name="name"
            defaultValue={profile.name}
            required
          />
          <Input
            label="Email"
            value={profile.email}
            disabled
            hint="Email cannot be changed."
          />
          <div className="flex justify-end">
            <Button type="submit" loading={isPending} size="sm">
              Save Profile
            </Button>
          </div>
        </form>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-[var(--color-text-muted)]" />
              Change Password
            </span>
          </CardTitle>
        </CardHeader>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="relative">
            <Input
              label="New Password"
              name="new_password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Minimum 8 characters"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-[34px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Input
            label="Confirm New Password"
            name="confirm_password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Re-enter your new password"
            required
          />
          <div className="flex justify-end">
            <Button type="submit" loading={isPending} size="sm">
              Change Password
            </Button>
          </div>
        </form>
      </Card>

      {/* Firm (Partner only) */}
      {profile.role === 'partner' && firm && (
        <Card>
          <CardHeader>
            <CardTitle>Firm</CardTitle>
          </CardHeader>
          <form onSubmit={handleSaveOrg} className="space-y-4">
            <Input
              label="Firm Name"
              name="orgName"
              defaultValue={firm.name}
              required
            />
            <Input
              label="Invite Code"
              value={firm.invite_code}
              disabled
              hint="Share this code with new team members."
            />
            <div className="flex justify-end">
              <Button type="submit" loading={isPending} size="sm">
                Save Firm
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Danger Zone */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="text-[var(--color-danger)]">Danger Zone</span>
          </CardTitle>
        </CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">Sign Out</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Sign out of your account on this device.
            </p>
          </div>
          <Button
            variant="danger"
            size="sm"
            loading={signingOut}
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </Card>
    </div>
  );
}
