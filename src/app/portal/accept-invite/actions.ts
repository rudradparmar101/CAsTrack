'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { provisionClientFromInvite } from '@/lib/provisioning';
import { checkRateLimit, getClientIp, rateLimitMessage } from '@/lib/rate-limit';

export interface AcceptInviteResult {
  success: boolean;
  error?: string;
}

/**
 * Server Action: accept a client portal invitation.
 *
 * AUTO-CONFIRM flow (per product decision): possession of the invitation
 * token IS the email proof, so instead of signUp() + a second confirmation
 * email round trip, we:
 *   1. re-validate the token via the lookup_client_invitation RPC
 *      (returns nothing for missing / already-accepted / expired tokens)
 *   2. create the auth user with the SERVICE-ROLE client, email pre-confirmed
 *   3. provision the client_user profile bound to the invitation's
 *      firm + client and mark the invitation accepted (lib/provisioning.ts)
 *   4. sign them in immediately and land them on /portal
 *
 * If provisioning fails after user creation, the auth user is deleted so a
 * retry of the invitation link doesn't hit "email already registered".
 */
export async function acceptClientInviteAction(
  formData: FormData
): Promise<AcceptInviteResult> {
  const token = (formData.get('token') as string)?.trim();
  const password = formData.get('password') as string;

  if (!token) {
    return { success: false, error: 'This invitation link is malformed. Ask your CA firm to resend it.' };
  }
  if (!password || password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters.' };
  }

  // Same bucket as the accept-invite page's own lookup — see that file.
  const ip = await getClientIp();
  const rateLimit = await checkRateLimit('accept_invite_lookup', ip, 20, 3600);
  if (!rateLimit.allowed) {
    return { success: false, error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  // Re-validate the token server-side (RPC only — there is deliberately no
  // SELECT policy on client_portal_invitations for unauthenticated users).
  const supabase = await createClient();
  const { data: invitations, error: lookupError } = await supabase.rpc(
    'lookup_client_invitation',
    { p_token: token }
  );

  const invitation = Array.isArray(invitations) ? invitations[0] : invitations;
  if (lookupError || !invitation) {
    return {
      success: false,
      error: 'This invitation is invalid, has expired, or was already used. Ask your CA firm to send a new one.',
    };
  }

  const adminClient = createAdminClient();

  // Create the auth user pre-confirmed. The metadata mirrors the other signup
  // modes so /onboarding can re-run provisioning if we crash mid-way.
  const { data: created, error: createError } =
    await adminClient.auth.admin.createUser({
      email: invitation.email,
      password,
      email_confirm: true,
      user_metadata: {
        signup_mode: 'accept_client_invite',
        inviteToken: token,
      },
    });

  if (createError || !created?.user) {
    if (
      createError?.message?.includes('already been registered') ||
      createError?.message?.includes('already exists')
    ) {
      return {
        success: false,
        error: 'An account with this email already exists. Please sign in instead.',
      };
    }
    console.error('acceptClientInviteAction createUser error:', createError);
    return { success: false, error: 'We could not create your account. Please try again.' };
  }

  // Provision profile (role=client_user, firm+client from the invitation)
  // and mark the invitation accepted.
  const result = await provisionClientFromInvite(adminClient, created.user);

  if (!result.ok) {
    // Roll back the auth user so the invite link can be retried cleanly.
    await adminClient.auth.admin.deleteUser(created.user.id);
    return { success: false, error: result.reason };
  }

  // Sign them in — no confirmation email round trip needed.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: invitation.email,
    password,
  });

  if (signInError) {
    // Account is fully provisioned; they can just log in normally.
    console.error('acceptClientInviteAction sign-in error:', signInError);
    redirect('/login');
  }

  redirect('/portal');
}
