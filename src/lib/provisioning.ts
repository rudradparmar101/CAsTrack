import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Profile/firm provisioning — the single source of truth for turning a
 * verified auth user into a usable account, driven by user_metadata.signup_mode.
 *
 * Used by BOTH /auth/callback (first-time verification) and /onboarding
 * (safety net retry), so a transient failure in the callback gets a second
 * chance with identical logic instead of a divergent fallback.
 *
 * All writes go through the SERVICE-ROLE client: the CA schema deliberately
 * has no INSERT policies on profiles/firms (see supabase/ca-firm/ROLES_AND_RLS.md, flag F3).
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export type ProvisionResult =
  | { ok: true; homePath: string }
  | { ok: false; reason: string };

export async function provisionFromMetadata(
  adminClient: AdminClient,
  user: User
): Promise<ProvisionResult> {
  const mode = (user.user_metadata?.signup_mode as string) || 'create_firm';

  switch (mode) {
    case 'create_firm':
      return provisionCreateFirm(adminClient, user);
    case 'join_firm':
      return provisionJoinFirm(adminClient, user);
    case 'accept_client_invite':
      return provisionClientFromInvite(adminClient, user);
    default:
      return {
        ok: false,
        reason: 'Your account was created through an unrecognized signup flow. Please contact support.',
      };
  }
}

/**
 * CREATE FIRM — inserts the firm (which fires the seed_default_departments
 * trigger automatically), then the partner profile. Cleans up the firm if
 * the profile insert fails so a retry doesn't leave orphan firms behind.
 */
async function provisionCreateFirm(
  adminClient: AdminClient,
  user: User
): Promise<ProvisionResult> {
  const metadata = user.user_metadata || {};
  const name = (metadata.name as string) || user.email?.split('@')[0] || 'User';
  const firmName = (metadata.firmName as string) || `${name}'s Firm`;

  const { data: firm, error: firmError } = await adminClient
    .from('firms')
    .insert({ name: firmName })
    .select('id')
    .single();

  if (firmError || !firm) {
    console.error('Provisioning: firm creation error:', firmError);
    return { ok: false, reason: 'We could not create your firm. Please try again.' };
  }

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: user.id,
    name,
    email: user.email || '',
    role: 'partner',
    firm_id: firm.id,
  });

  if (profileError) {
    await adminClient.from('firms').delete().eq('id', firm.id);
    console.error('Provisioning: partner profile creation error:', profileError);
    return { ok: false, reason: 'We could not finish setting up your account. Please try again.' };
  }

  return { ok: true, homePath: '/dashboard' };
}

/**
 * JOIN FIRM — resolves the invite code via the lookup_firm_by_invite_code RPC
 * (never a direct SELECT on firms; that policy path doesn't exist) and creates
 * an employee profile. Deliberately does NOT assign any department — a partner
 * adds the employee to departments later, so new joiners start least-privilege.
 */
async function provisionJoinFirm(
  adminClient: AdminClient,
  user: User
): Promise<ProvisionResult> {
  const metadata = user.user_metadata || {};
  const name = (metadata.name as string) || user.email?.split('@')[0] || 'User';
  const inviteCode = metadata.inviteCode as string;

  if (!inviteCode) {
    return {
      ok: false,
      reason: 'Your signup is missing an invite code. Ask your firm for a new invite link and sign up again.',
    };
  }

  const { data: firms, error: lookupError } = await adminClient.rpc(
    'lookup_firm_by_invite_code',
    { p_code: inviteCode }
  );

  const firm = Array.isArray(firms) ? firms[0] : firms;
  if (lookupError || !firm) {
    console.error('Provisioning: invalid invite code:', lookupError);
    return {
      ok: false,
      reason: 'Your invite code is no longer valid. Ask a partner at your firm for the current code.',
    };
  }

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: user.id,
    name,
    email: user.email || '',
    role: 'employee',
    firm_id: firm.firm_id,
  });

  if (profileError) {
    console.error('Provisioning: employee profile creation error:', profileError);
    return { ok: false, reason: 'We could not finish setting up your account. Please try again.' };
  }

  return { ok: true, homePath: '/dashboard' };
}

/**
 * ACCEPT CLIENT INVITATION — re-validates the token via the
 * lookup_client_invitation RPC (returns nothing for missing, already-accepted,
 * or expired tokens), creates the client_user profile bound to the invitation's
 * firm + client, and marks the invitation accepted.
 *
 * Called from acceptClientInviteAction right after admin.createUser (the
 * auto-confirm flow) and from /onboarding as a retry if that was interrupted.
 */
export async function provisionClientFromInvite(
  adminClient: AdminClient,
  user: User
): Promise<ProvisionResult> {
  const metadata = user.user_metadata || {};
  const token = metadata.inviteToken as string;

  if (!token) {
    return {
      ok: false,
      reason: 'Your account is missing its invitation reference. Ask your CA firm to send a new invitation.',
    };
  }

  const { data: invitations, error: lookupError } = await adminClient.rpc(
    'lookup_client_invitation',
    { p_token: token }
  );

  const invitation = Array.isArray(invitations) ? invitations[0] : invitations;
  if (lookupError || !invitation) {
    console.error('Provisioning: invalid client invitation token:', lookupError);
    return {
      ok: false,
      reason: 'This invitation is invalid, has expired, or was already used. Ask your CA firm to send a new one.',
    };
  }

  // The portal signup form only collects a password, so default the display
  // name to the email prefix — client users can rename themselves later.
  const name =
    (metadata.name as string) || invitation.email?.split('@')[0] || 'Client';

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: user.id,
    name,
    email: user.email || invitation.email,
    role: 'client_user',
    firm_id: invitation.firm_id,
    client_id: invitation.client_id,
  });

  if (profileError) {
    console.error('Provisioning: client_user profile creation error:', profileError);
    return { ok: false, reason: 'We could not finish setting up your portal account. Please try again.' };
  }

  // Mark accepted only after the profile exists. If this update fails the
  // token stays technically live, but reuse is blocked anyway (same email
  // can't sign up twice), so log and continue.
  const { error: acceptError } = await adminClient
    .from('client_portal_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.invitation_id);

  if (acceptError) {
    console.error('Provisioning: failed to mark invitation accepted:', acceptError);
  }

  return { ok: true, homePath: '/portal' };
}
