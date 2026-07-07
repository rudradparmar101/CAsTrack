'use server';

import { createClient } from '@/lib/supabase/server';

export interface SignupResult {
  success: boolean;
  error?: string;
  requiresEmailConfirmation?: boolean;
}

/**
 * Server Action: Create a new firm and partner account.
 *
 * Uses the standard Supabase client to trigger a real confirmation email
 * (Supabase's built-in mailer for now — Resend comes later).
 * Profile and firm are NOT created here — they're created in the
 * /auth/callback route after the user clicks the verification link
 * (see lib/provisioning.ts).
 *
 * We store `name` and `firmName` in user_metadata so the callback
 * can read them and provision the firm + partner profile atomically.
 */
export async function signupCreateFirmAction(formData: FormData): Promise<SignupResult> {
  const name = (formData.get('name') as string)?.trim();
  const email = (formData.get('email') as string)?.trim();
  const password = formData.get('password') as string;
  const firmName = (formData.get('firmName') as string)?.trim();

  // Validate inputs
  if (!name || !email || !password || !firmName) {
    return { success: false, error: 'All fields are required.' };
  }

  if (password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters.' };
  }

  const supabase = await createClient();

  const { data, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        firmName,
        signup_mode: 'create_firm',
      },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`,
    },
  });

  if (authError) {
    if (authError.message?.includes('already been registered') || authError.message?.includes('already exists')) {
      return { success: false, error: 'An account with this email already exists. Please sign in.' };
    }
    console.error('Auth signup error:', authError);
    return { success: false, error: authError.message };
  }

  // Supabase returns a user with identities=[] when the email is already taken
  // but "Confirm email" is enabled. Handle this edge case.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { success: false, error: 'An account with this email already exists. Please sign in.' };
  }

  return { success: true, requiresEmailConfirmation: true };
}

/**
 * Server Action: Join an existing firm via invite code and create an
 * employee account.
 *
 * Validates the invite code FIRST via the lookup_firm_by_invite_code RPC —
 * never a direct SELECT on firms (the CA schema has no browse-firms policy;
 * the SECURITY DEFINER RPC only answers for a presented code). Same
 * fail-fast order as DeadlineTracker: no auth user is created for a bad code.
 *
 * Profile creation happens in /auth/callback after email verification, with
 * role='employee' and NO department membership (a partner assigns those later).
 */
export async function signupJoinFirmAction(formData: FormData): Promise<SignupResult> {
  const name = (formData.get('name') as string)?.trim();
  const email = (formData.get('email') as string)?.trim();
  const password = formData.get('password') as string;
  const inviteCode = (formData.get('inviteCode') as string)?.trim();

  // Validate inputs
  if (!name || !email || !password || !inviteCode) {
    return { success: false, error: 'All fields are required.' };
  }

  if (password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters.' };
  }

  const supabase = await createClient();

  // Validate the invite code before creating the auth user
  const { data: firms, error: lookupError } = await supabase.rpc(
    'lookup_firm_by_invite_code',
    { p_code: inviteCode }
  );

  const firm = Array.isArray(firms) ? firms[0] : firms;
  if (lookupError || !firm) {
    return { success: false, error: 'Invalid invite code. Please check with a partner at your firm.' };
  }

  const { data, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        inviteCode,
        signup_mode: 'join_firm',
      },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`,
    },
  });

  if (authError) {
    if (authError.message?.includes('already been registered') || authError.message?.includes('already exists')) {
      return { success: false, error: 'An account with this email already exists. Please sign in.' };
    }
    console.error('Auth signup error:', authError);
    return { success: false, error: authError.message };
  }

  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { success: false, error: 'An account with this email already exists. Please sign in.' };
  }

  return { success: true, requiresEmailConfirmation: true };
}
