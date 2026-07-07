import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Profile, Firm } from '@/lib/types';

/**
 * Shared auth helper — eliminates redundant profile/firm fetching
 * across pages. Call this once in any Server Component that needs
 * the authenticated user's context.
 *
 * Works for ALL roles (partner, employee, client_user) — role-specific
 * routing lives in middleware and layouts, not here.
 *
 * Redirects automatically:
 *  - No session → /login
 *  - No profile/firm → /onboarding (which retries provisioning or shows an error)
 */
export async function getAuthContext(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  profile: Profile;
  firm: Firm;
  /** @deprecated Alias of `firm` so not-yet-ported DeadlineTracker pages keep compiling. */
  organization: Firm;
  /** The one bound client for client_user logins; null for staff. */
  clientId: string | null;
  /** True if the user is in platform_admins — gates the future /admin surface. */
  isSuperAdmin: boolean;
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) {
    redirect('/onboarding');
  }

  // RLS lets every role (including client_user) read their own firm row.
  // is_super_admin() is the SECURITY DEFINER RPC from the CA schema.
  const [firmResult, superAdminResult] = await Promise.all([
    supabase.from('firms').select('*').eq('id', profile.firm_id).single(),
    supabase.rpc('is_super_admin'),
  ]);

  const firm = firmResult.data;
  if (!firm) {
    redirect('/onboarding');
  }

  const typedProfile = profile as Profile;

  return {
    supabase,
    userId: user.id,
    profile: typedProfile,
    firm: firm as Firm,
    organization: firm as Firm,
    clientId: typedProfile.client_id ?? null,
    isSuperAdmin: superAdminResult.data === true,
  };
}

/**
 * Lightweight version — only checks auth + profile, skips the firm fetch
 * and super-admin check. Use in Server Actions where you need the user's
 * firm_id/role but not the full firm object.
 */
export async function getAuthProfile(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  profile: Profile;
  clientId: string | null;
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) {
    redirect('/onboarding');
  }

  const typedProfile = profile as Profile;

  return {
    supabase,
    userId: user.id,
    profile: typedProfile,
    clientId: typedProfile.client_id ?? null,
  };
}
