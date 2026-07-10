import React from 'react';
import { getAuthContext } from '@/lib/auth';
import { SettingsPageClient } from './settings-page-client';

export default async function SettingsPage() {
  const { profile, firm } = await getAuthContext();

  return (
    <SettingsPageClient
      profile={profile}
      firm={firm}
    />
  );
}
