import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { provisionFromMetadata } from '@/lib/provisioning';
import { safeInternalPath } from '@/lib/safe-redirect';

/**
 * Auth callback route — handles the redirect after a user clicks
 * their email verification link (create-firm and join-firm paths).
 *
 * The client-invitation path does NOT come through here: it uses
 * admin.createUser with email_confirm=true and provisions inline
 * (see /portal/accept-invite/actions.ts). The provisioning module
 * still handles that mode defensively in case a stray session hits us.
 *
 * After exchanging the code for a session, checks if the user already
 * has a profile. If not, provisions firm/profile via lib/provisioning.ts
 * based on the signup_mode stored in user_metadata.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Allow-listed to an internal path: this is concatenated onto `origin`
  // below, and `next=@evil.com` would make evil.com the URL's HOST. See
  // lib/safe-redirect.ts and the audit's L1.
  const next = safeInternalPath(searchParams.get('next'), '/dashboard');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('Auth callback code exchange error:', error);
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
  }

  // Get the authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=no_user`);
  }

  // Check if the user already has a profile (e.g., re-clicking the link)
  const adminClient = createAdminClient();
  const { data: existingProfile } = await adminClient
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (existingProfile) {
    // Profile already exists — route by role, never send a client to the dashboard
    const target = existingProfile.role === 'client_user' ? '/portal' : next;
    return NextResponse.redirect(`${origin}${target}`);
  }

  // ---- First-time verification: provision firm/profile per signup_mode ----
  try {
    const result = await provisionFromMetadata(adminClient, user);

    if (!result.ok) {
      // /onboarding retries the same provisioning once more, then shows the
      // error (it only auto-creates a firm for the create_firm mode — a failed
      // join or client invite must never silently default to a new firm).
      return NextResponse.redirect(`${origin}/onboarding`);
    }

    return NextResponse.redirect(`${origin}${result.homePath}`);
  } catch (err) {
    console.error('Callback: unexpected error during provisioning:', err);
    return NextResponse.redirect(`${origin}/onboarding`);
  }
}
