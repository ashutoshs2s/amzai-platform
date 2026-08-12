import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Who is reading, from the point of view of row level security.
 *
 * Every screen needs this before it can say anything sensible about an empty
 * result. Under RLS, "not signed in" and "signed in but there is nothing here"
 * both come back as zero rows, and telling an operator "No programs yet" when
 * the real answer is "you are not signed in" sends them looking for the wrong
 * problem.
 */

export type Staff = {
  id: string;
  fullName: string;
  /** Privilege tier: super_admin, admin, manager, user. See lib/tiers.ts. */
  tier: string;
};

export type SessionState =
  /** No Supabase session. RLS will correctly return nothing. */
  | { state: "signed_out" }
  /**
   * Authenticated, but no matching row in `public.users`. RLS reads the role
   * from that table, so this session can see nothing either. An admin has to
   * add them, or the seed has not been run.
   */
  | { state: "no_staff_record"; email: string | null }
  | { state: "ok"; staff: Staff };

export async function getSession(): Promise<SessionState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { state: "signed_out" };

  // Subject to the policy on `users`, which asks the SECURITY DEFINER helper
  // rather than reading the table directly. A session with no staff row simply
  // sees nothing here, which is not an error.
  const { data } = await supabase
    .from("users")
    .select("id, full_name, tier")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) return { state: "no_staff_record", email: user.email ?? null };

  return {
    state: "ok",
    staff: { id: data.id, fullName: data.full_name, tier: data.tier },
  };
}
