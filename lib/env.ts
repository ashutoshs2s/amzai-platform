/**
 * Public environment variables, read in one place.
 *
 * These two are written out as literal `process.env.NEXT_PUBLIC_...`
 * references on purpose. Next.js substitutes those exact strings at build
 * time and only those exact strings, so reading them through a generic
 * helper function would leave them undefined in the browser.
 *
 * SUPABASE_SERVICE_ROLE_KEY is deliberately absent from this file. It is read
 * in lib/supabase/admin.ts and nowhere else, because that file is marked
 * server-only and the build fails if anything client-side imports it.
 * See CLAUDE.md hard rule 2.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when both public Supabase variables are present. Never exposes values. */
export function supabasePublicEnvIsSet(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Returns the public Supabase settings, or throws an error that says exactly
 * what to do about it. Every Supabase client goes through this rather than
 * reaching for process.env directly.
 */
export function requireSupabasePublicEnv(): { url: string; anonKey: string } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and fill in " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart the dev server.",
    );
  }
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
}
