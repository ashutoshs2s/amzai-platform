import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_URL } from "@/lib/env";

/**
 * Supabase client using the service role key.
 *
 * READ THIS BEFORE USING IT.
 *
 * The service role key bypasses row level security completely. A query made
 * with this client can read and write every row in every table, for every
 * client, with no policy standing in the way.
 *
 * It exists for one reason: the client-facing routes on `client.amzai.events`
 * have no signed-in user and therefore no database identity, so they cannot
 * rely on row level security. Per SPEC.md section 5, the token check and the
 * session check inside those routes are the entire access control, and every
 * one of them must confirm that the programme in the URL is the programme the
 * token or session was issued for.
 *
 * Rules:
 *  - Never import this file from a client component. The `server-only` import
 *    above makes the build fail if anything tries, which is the enforcement
 *    behind CLAUDE.md hard rule 2.
 *  - Never use it for internal screens. Those have a signed-in staff user, so
 *    they use lib/supabase/server.ts and let row level security do its job.
 *  - Never reach for it to make a failing query work. Fix the policy instead.
 *    That is CLAUDE.md hard rule 3.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !serviceRoleKey) {
    throw new Error(
      "Supabase admin client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY in .env.local, then restart the dev server.",
    );
  }

  return createSupabaseClient(SUPABASE_URL, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/** True when the service role key is present. Never exposes the value. */
export function serviceRoleKeyIsSet(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
