import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase admin client — bypasses RLS.
 * Uses the service_role key, so it has full database access.
 *
 * ⚠️  NEVER import this in client components or expose it to the browser.
 * Use only in Server Actions, API routes, and server-side utilities.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL environment variable. ' +
      'Get the service_role key from: Supabase Dashboard → Settings → API.'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
