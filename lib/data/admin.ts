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

/* -------------------------------------------------------------------------- */
/* Privilege changes                                                          */
/* -------------------------------------------------------------------------- */

export type PrivilegeChange = {
  id: string;
  at: string;
  actorName: string;
  action: string;
  what: string;
  detail: string;
};

/** The tables a privilege change touches. Nothing else belongs in this view. */
const PRIVILEGE_TABLES = ["users", "user_staff_functions", "organisation_managers"];

/**
 * Who changed a tier, a function or an organisation assignment, and when.
 *
 * Read from audit_events, which is append-only and written by a trigger, so it
 * records what happened rather than what a screen reported. A change made in
 * the SQL editor appears here too.
 */
export async function listPrivilegeChanges(limit = 40): Promise<PrivilegeChange[]> {
  const supabase = await createClient();

  const [{ data: events, error }, { data: staff }, { data: orgs }, { data: fns }] =
    await Promise.all([
      supabase
        .from("audit_events")
        .select("id, actor_id, action, table_name, record_id, before, after, occurred_at")
        .in("table_name", PRIVILEGE_TABLES)
        .order("occurred_at", { ascending: false })
        .limit(limit),
      supabase.from("users").select("id, full_name"),
      supabase.from("organisations").select("id, name"),
      supabase.from("staff_functions").select("id, label"),
    ]);

  if (error) throw new Error(`Could not load the privilege trail: ${error.message}`);

  const nameOf = (id: string | null | undefined) =>
    (staff ?? []).find((s) => s.id === id)?.full_name ?? "Unknown";
  const orgOf = (id: string | null | undefined) =>
    (orgs ?? []).find((o) => o.id === id)?.name ?? "an organisation";
  const fnOf = (id: string | null | undefined) =>
    (fns ?? []).find((f) => f.id === id)?.label ?? "a function";

  return (events ?? []).map((event) => {
    const before = (event.before ?? {}) as Record<string, unknown>;
    const after = (event.after ?? {}) as Record<string, unknown>;

    let what = "";
    let detail = "";

    if (event.table_name === "users") {
      what = nameOf((after.id ?? before.id) as string);
      if (before.tier !== after.tier && after.tier !== undefined && before.tier !== undefined) {
        detail = `Tier ${before.tier} to ${after.tier}`;
      } else if (before.active !== after.active && after.active !== undefined) {
        detail = after.active ? "Reactivated" : "Deactivated";
      } else if (event.action === "insert") {
        detail = `Added at tier ${after.tier}`;
      } else {
        detail = "Details changed";
      }
    } else if (event.table_name === "user_staff_functions") {
      const row = event.action === "delete" ? before : after;
      what = nameOf(row.user_id as string);
      detail = `${event.action === "delete" ? "Removed" : "Given"} the ${fnOf(
        row.function_id as string,
      )} function`;
    } else {
      const row = event.action === "delete" ? before : after;
      what = nameOf(row.user_id as string);
      detail = `${event.action === "delete" ? "No longer holds" : "Now holds"} ${orgOf(
        row.organisation_id as string,
      )}`;
    }

    return {
      id: String(event.id),
      at: event.occurred_at,
      actorName: event.actor_id ? nameOf(event.actor_id) : "System",
      action: event.action,
      what,
      detail,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Clients and programmes, for archiving                                      */
/* -------------------------------------------------------------------------- */

export type ClientRow = {
  id: string;
  name: string;
  archivedAt: string | null;
  /** An organisation with any programme at all cannot be deleted. */
  programmeCount: number;
  programmes: {
    id: string;
    name: string;
    archivedAt: string | null;
    /** A programme with generated onboarding cannot be deleted. */
    generated: boolean;
  }[];
};

export async function listClientsForAdmin(): Promise<ClientRow[]> {
  const supabase = await createClient();

  const [{ data: orgs, error }, { data: programmes }] = await Promise.all([
    supabase.from("organisations").select("id, name, archived_at").order("name"),
    supabase
      .from("programs")
      .select("id, name, organisation_id, archived_at, onboarding_generated_at")
      .order("name"),
  ]);

  if (error) throw new Error(`Could not load clients: ${error.message}`);

  return (orgs ?? []).map((org) => {
    const mine = (programmes ?? []).filter((p) => p.organisation_id === org.id);
    return {
      id: org.id,
      name: org.name,
      archivedAt: org.archived_at,
      programmeCount: mine.length,
      programmes: mine.map((p) => ({
        id: p.id,
        name: p.name,
        archivedAt: p.archived_at,
        generated: p.onboarding_generated_at !== null,
      })),
    };
  });
}
