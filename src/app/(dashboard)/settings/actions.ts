'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createReauthClient } from '@/lib/supabase/reauth';
import { validatePassword } from '@/lib/auth/password-policy';
import { GSTIN_RE } from '@/lib/ca-options';
import type { ActionResult } from '@/lib/types';

export async function updateProfileAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const name = (formData.get('name') as string)?.trim();

  if (!name) {
    return { success: false, error: 'Name is required.' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ name })
    .eq('id', user.id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  return { success: true };
}

export async function updateOrganizationAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  // Verify partner role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, firm_id')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'partner') {
    return { success: false, error: 'Only partners can update firm settings.' };
  }

  const name = (formData.get('orgName') as string)?.trim();

  if (!name) {
    return { success: false, error: 'Firm name is required.' };
  }

  const gstinRaw = (formData.get('gstin') as string)?.trim().toUpperCase();
  const gstin = gstinRaw || null;
  if (gstin && !GSTIN_RE.test(gstin)) {
    return { success: false, error: 'Please enter a valid 15-character GSTIN.' };
  }

  const { error } = await supabase
    .from('firms')
    .update({ name, gstin })
    .eq('id', profile.firm_id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  return { success: true };
}

/**
 * Change the signed-in user's own password.
 *
 * RE-AUTHENTICATION IS REQUIRED (app-layer security audit, finding M3). This
 * action previously took only new_password + confirm_password, so anyone
 * holding a stolen session cookie — from a shared machine, a lost device, or
 * an XSS — could convert a temporary session into permanent account takeover
 * in one request, and lock the real owner out at the same time. Verifying the
 * current password is the standard control against exactly that, and it is the
 * step that turns "I have your session for ten minutes" back into "I have your
 * session for ten minutes" instead of "I have your account".
 *
 * The check is a real signInWithPassword() against the user's own email. That
 * is the only way to verify a password through Supabase Auth (there is no
 * "verify this password" API), and it is why the call is made on a SEPARATE
 * client: signing in mutates session state, and doing it on the request's own
 * client would rewrite the caller's session cookies as a side effect of a
 * verification step. `createReauthClient()` has no cookie adapter, so the
 * session it creates is discarded when the call returns.
 *
 * Note this shares a bucket with nothing: a wrong current password is a failed
 * sign-in against Supabase Auth, which applies its own native rate limiting.
 */
export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const currentPassword = formData.get('current_password') as string;
  const newPassword = formData.get('new_password') as string;
  const confirmPassword = formData.get('confirm_password') as string;

  if (!currentPassword) {
    return { success: false, error: 'Enter your current password to confirm this change.' };
  }

  // The shared policy — this call site used to enforce its own separate rule.
  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return { success: false, error: passwordError };
  }

  if (newPassword !== confirmPassword) {
    return { success: false, error: 'Passwords do not match.' };
  }

  if (newPassword === currentPassword) {
    return { success: false, error: 'The new password must be different from your current one.' };
  }

  if (!user.email) {
    return { success: false, error: 'This account has no email address, so the password cannot be changed here.' };
  }

  // Verify the CURRENT password on a throwaway client, so this verification
  // cannot disturb the caller's real session.
  const reauth = createReauthClient();
  const { error: reauthError } = await reauth.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    return { success: false, error: 'That current password is not correct.' };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    // Supabase Auth messages are user-directed by design and carry no schema
    // detail, so unlike DB errors they are surfaced as-is.
    return { success: false, error: error.message };
  }

  return { success: true };
}
