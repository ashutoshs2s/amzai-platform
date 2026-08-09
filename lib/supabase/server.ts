import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { requireSupabasePublicEnv } from "@/lib/env";

/**
 * Supabase client for server components, server actions and route handlers on
 * the internal app.
 *
 * Uses the anon key and carries the signed-in staff member's session from
 * cookies, so row level security applies with that user's identity. This is
 * the client almost everything internal should use.
 *
 * For the client-facing routes on `client.amzai.events`, which have no signed-in
 * user at all, see admin.ts.
 */
export async function createClient() {
  const { url, anonKey } = requireSupabasePublicEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components cannot set cookies. This is expected and safe to
          // ignore when session refresh is handled in middleware instead.
        }
      },
    },
  });
}
