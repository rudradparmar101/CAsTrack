'use server';

import { createClient } from '@/lib/supabase/server';
import { validatePassword } from '@/lib/auth/password-policy';
import type { ActionResult } from '@/lib/types';

export async function resetPasswordAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No session means the recovery token was never verified (expired,
  // already used, or this page was reached directly) — the page component
  // already gates on this, but the action re-checks since it's the actual
  // security boundary, not the page's rendering branch.
  if (!user) {
    return { success: false, error: 'Your reset link has expired or was already used. Please request a new one.' };
  }

  const newPassword = formData.get('new_password') as string;
  const confirmPassword = formData.get('confirm_password') as string;

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return { success: false, error: passwordError };
  }

  if (newPassword !== confirmPassword) {
    return { success: false, error: 'Passwords do not match.' };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { success: false, error: error.message };
  }

  // The recovery session's only purpose was setting this password — sign
  // out so the user comes back through a normal login with their new
  // password, matching the requested "redirects to login on success" flow.
  await supabase.auth.signOut();

  return { success: true };
}
