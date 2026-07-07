'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Signs the user out and returns them to /login.
 *
 * Needed on the onboarding error screen: an authenticated-but-profileless
 * user can't reach /login normally (middleware bounces authenticated users
 * off auth pages), so without this they'd be stuck in a redirect loop.
 */
export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
