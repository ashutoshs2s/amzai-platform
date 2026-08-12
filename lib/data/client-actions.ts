"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/data/session";
import { isAdminOrAbove } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import { isValidSlug, slugify, uniqueSlug } from "@/lib/slug";

/**
 * Creating a client and its first programme. SPEC.md section 4.
 *
 * The whole write is one call to create_client_programme, which is one
 * transaction. Four separate PostgREST calls would leave an organisation with a
 * programme and no team if the third failed, which is the half-built state the
 * creation sequence exists to prevent.
 *
 * Onboarding is deliberately not generated here. That is a separate step with a
 * preview the admin approves, and this hands off to it.
 */

export type Assignment = { userId: string; role: string };

export type NewClientInput = {
  organisationName: string;
  clientTypeId: string;
  subSegmentId: string | null;
  category: string;
  programmeName: string;
  programmeType: string;
  startDate: string;
  endDate: string;
  milestoneDate: string;
  gateDate: string;
  situationalSlugs: string[];
  assignments: Assignment[];
};

export type CreateResult =
  | { ok: true; programmeId: string }
  /** Keyed by field name so the form can mark the control, not just shout. */
  | { ok: false; message: string; fields?: Record<string, string> };

const ROLES = ["engagement_lead", "delivery_lead", "specialist", "data_ops"];
const TYPES = ["event", "retainer", "dedicated_team", "series", "research"];

/** Events count to a date that does not move; everything else runs in weeks. */
function countsToMilestone(type: string): boolean {
  return type === "event" || type === "series";
}

export async function createClientProgramme(
  input: NewClientInput,
): Promise<CreateResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };
  if (!isAdminOrAbove(session.staff.tier)) {
    return { ok: false, message: "Only an admin can create a client." };
  }

  const fields: Record<string, string> = {};
  const organisationName = input.organisationName.trim();
  const programmeName = input.programmeName.trim();

  if (!organisationName) fields.organisationName = "Give the organisation a name.";
  if (!programmeName) fields.programmeName = "Give the programme a name.";
  if (!input.clientTypeId) fields.clientTypeId = "Choose a client type.";
  if (!TYPES.includes(input.programmeType)) fields.programmeType = "Choose a programme type.";

  /*
    Dates are required where a countdown depends on them, and not otherwise.
    SPEC.md 7.2: an event counts to fixed_milestone_date, a retainer runs from
    start to end. A programme missing them renders no countdown at all, which
    reads as broken rather than as incomplete.
  */
  if (countsToMilestone(input.programmeType)) {
    if (!input.milestoneDate) {
      fields.milestoneDate = "An event counts down to this date, so it is needed.";
    }
  } else {
    if (!input.startDate) fields.startDate = "A retainer is measured in weeks from this date.";
    if (!input.endDate) fields.endDate = "A retainer is measured in weeks up to this date.";
  }

  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    fields.endDate = "The end cannot be before the start.";
  }
  if (input.gateDate) {
    if (input.startDate && input.gateDate < input.startDate) {
      fields.gateDate = "The gate sits inside the engagement.";
    }
    if (input.endDate && input.gateDate > input.endDate) {
      fields.gateDate = "The gate sits inside the engagement.";
    }
  }

  if (input.assignments.length === 0) {
    fields.assignments =
      "Assign at least one person. Without a team every onboarding field generates unassigned.";
  }
  if (input.assignments.some((a) => !ROLES.includes(a.role))) {
    fields.assignments = "That is not a role on a programme.";
  }
  // admin is a system role, not a job on a programme. SPEC.md section 3.
  const seen = new Set<string>();
  for (const a of input.assignments) {
    const key = `${a.userId}:${a.role}`;
    if (seen.has(key)) fields.assignments = "Somebody is listed twice in the same role.";
    seen.add(key);
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, message: "Some details need fixing.", fields };
  }

  const supabase = await createClient();

  /*
    An existing organisation is reused by slug, so the slug is derived and not
    made unique: two programmes for the same client should land on the same
    organisation. The programme slug is made unique within it.
  */
  const organisationSlug = slugify(organisationName);
  if (!isValidSlug(organisationSlug)) {
    return {
      ok: false,
      message: "That organisation name produces no usable slug. Use some letters or numbers.",
      fields: { organisationName: "Needs at least one letter or number." },
    };
  }

  const { data: existing } = await supabase
    .from("organisations")
    .select("id")
    .eq("slug", organisationSlug)
    .maybeSingle();

  let taken: string[] = [];
  if (existing) {
    const { data: siblings } = await supabase
      .from("programs")
      .select("slug")
      .eq("organisation_id", existing.id);
    taken = (siblings ?? []).map((s) => s.slug);
  }

  const programmeSlug = uniqueSlug(slugify(programmeName), taken);
  if (!isValidSlug(programmeSlug)) {
    return {
      ok: false,
      message: "That programme name produces no usable slug. Use some letters or numbers.",
      fields: { programmeName: "Needs at least one letter or number." },
    };
  }

  const milestone = countsToMilestone(input.programmeType)
    ? input.milestoneDate
    : input.milestoneDate || null;

  const { data, error } = await supabase.rpc("create_client_programme", {
    p_organisation_name: organisationName,
    p_organisation_slug: organisationSlug,
    p_client_type_id: input.clientTypeId,
    p_sub_segment_id: input.subSegmentId,
    p_category: input.category.trim() || null,
    p_programme_name: programmeName,
    p_programme_slug: programmeSlug,
    p_programme_type: input.programmeType,
    p_start_date: input.startDate || null,
    p_end_date: input.endDate || null,
    p_milestone_date: milestone || null,
    p_gate_date: input.gateDate || null,
    p_modules: input.situationalSlugs,
    p_assignments: input.assignments.map((a) => ({
      user_id: a.userId,
      role_on_program: a.role,
    })),
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/programs");
  return { ok: true, programmeId: data as string };
}
