import { createBrowserClient } from "@supabase/ssr";

import { requireSupabasePublicEnv } from "@/lib/env";

/**
 * Supabase client for the browser, on the internal app only.
 *
 * Uses the anon key, so every query it makes is subject to row level security.
 * That is the point: this client is never trusted.
 *
 * Not for client-facing surfaces. Per SPEC.md section 5, `client.amzai.events`
 * never touches the database from the browser at all; it goes through
 * server-side routes that check a token or a session first.
 */
export function createClient() {
  const { url, anonKey } = requireSupabasePublicEnv();
  return createBrowserClient(url, anonKey);
}
