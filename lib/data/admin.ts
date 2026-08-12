import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * The staff list, for the admin screen.
 *
 * Every read here goes through the authenticated client, so an admin sees what
 * their own policies allow. The screen enforces the tier rules in the interface
 * as well, but that is so it does not offer what the database would refuse —
 * not because it is the thing holding the line.
 */

export type StaffFunction = {
  id: string;
  slug: string;
  label: string;
  description: string | null;
};

export type StaffRow = {
  id: string;
  fullName: string;
  email: string;
  tier: string;
  active: boolean;
  functionSlugs: string[];
  /** Organisations held, for managers. Empty for every other tier. */
  organisations: { id: string; name: string }[];
};

export async function listStaff(): Promise<StaffRow[]> {
  const supabase = await createClient();

  const [{ data: users, error }, { data: functions }, { data: managed }] = await Promise.all([
    supabase.from("users").select("id, full_name, email, tier, active").order("full_name"),
    supabase
      .from("user_staff_functions")
      .select("user_id, staff_function:staff_functions ( slug )"),
    supabase
      .from("organisation_managers")
      .select("user_id, organisation:organisations ( id, name )"),
  ]);

  if (error) throw new Error(`Could not load the staff list: ${error.message}`);

  return (users ?? []).map((user) => ({
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    tier: user.tier,
    active: user.active,
    functionSlugs: (functions ?? [])
      .filter((f) => f.user_id === user.id)
      .map((f) => (f.staff_function as unknown as { slug: string } | null)?.slug)
      .filter((slug): slug is string => Boolean(slug)),
    organisations: (managed ?? [])
      .filter((m) => m.user_id === user.id)
      .map((m) => m.organisation as unknown as { id: string; name: string })
      .filter(Boolean),
  }));
}

export async function listStaffFunctions(): Promise<StaffFunction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_functions")
    .select("id, slug, label, description")
    .eq("active", true)
    .order("label");

  if (error) throw new Error(`Could not load the functions: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id,
    slug: f.slug,
    label: f.label,
    description: f.description,
  }));
}

export async function listOrganisationsForAdmin(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("organisations").select("id, name").order("name");
  if (error) throw new Error(`Could not load organisations: ${error.message}`);
  return data ?? [];
}
