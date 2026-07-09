// Service-role Supabase client — local scripts only, never shipped client-side.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from './env.mjs';

export function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Anon-key client signed in as a specific user via password — for direct
// PostgREST calls that must go through RLS as that user (not service role).
export async function signInAs(email, password) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInAs(${email}) failed: ${error.message}`);
  return { client, session: data.session, user: data.user };
}

// Creates a pre-confirmed auth user directly via the admin API, with
// user_metadata shaped exactly like signupCreateFirmAction/signupJoinFirmAction
// would set it, so provisionFromMetadata() in the real /onboarding page
// provisions it identically to a real signup. Bypasses supabase.auth.signUp()
// entirely, which is what triggers Supabase's built-in-mailer confirmation
// email and its rate limit (hit immediately in this run — see
// project_context.md §6 item 9, which names exactly this workaround).
export async function createConfirmedUser(admin, { email, password, metadata }) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw new Error(`createConfirmedUser(${email}) failed: ${error.message}`);
  return data.user.id;
}

// Confirms a just-signed-up user's email via the admin API so we never need
// to receive/click Supabase's confirmation email (avoids the mailer rate
// limit hit repeatedly in Phase 5/6 — see project_context.md §6 item 9).
export async function confirmUserByEmail(admin, email) {
  // GoTrue admin listUsers supports filtering by email in recent versions;
  // fall back to paging + find if not.
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) {
      if (!found.email_confirmed_at) {
        const { error: updErr } = await admin.auth.admin.updateUserById(found.id, {
          email_confirm: true,
        });
        if (updErr) throw new Error(`confirm failed: ${updErr.message}`);
      }
      return found.id;
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  throw new Error(`No auth user found for email ${email}`);
}
