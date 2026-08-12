"use server";

import { revalidatePath } from "next/cache";

import { loadGenerationContext, planFor } from "@/lib/data/generation";
import { getSession } from "@/lib/data/session";
import { isAdminOrAbove } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import type { AmbiguousRole } from "@/lib/generation/assignment.ts";
import { ROLE_LABEL, rolesNeeded } from "@/lib/generation/assignment.ts";

/**
 * Generating a programme's onboarding.
 *
 * The plan is recomputed here from the database, never taken from the browser.
 * What the admin approved was a view of it; trusting the view would let a
 * modified form ask for questions the rules would not have chosen.
 */

export type GenerateResult =
  | { ok: true; written: number }
  | { ok: false; message: string }
  /** SPEC.md 4.4. Not an error: the admin has to answer before this can run. */
  | { ok: false; needsResolution: AmbiguousRole[]; message: string };

export type RoleChoice = {
  role: string;
  /** A user id, or null for a deliberate "leave unassigned". SPEC.md 4.4. */
  userId: string | null;
};

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * When a question is due.
 *
 * Returns null when the programme has no date to count from. A null due date is
 * honest; a made-up one would put a deadline in front of somebody that nothing
 * justifies.
 */
function dueDateFor(
  offsetType: "weeks_from_start" | "days_before_milestone",
  offsetValue: number,
  programme: {
    type: string;
    start_date: string | null;
    end_date: string | null;
    fixed_milestone_date: string | null;
    gate_date: string | null;
  },
): string | null {
  if (offsetType === "weeks_from_start") {
    return programme.start_date ? addDays(programme.start_date, offsetValue * 7) : null;
  }

  // The date that does not move for an event; the end of the engagement
  // otherwise. SPEC.md section 7.2.
  const milestone =
    programme.type === "event" || programme.type === "series"
      ? programme.fixed_milestone_date
      : (programme.gate_date ?? programme.end_date);

  return milestone ? addDays(milestone, -offsetValue) : null;
}

export async function generateOnboarding(input: {
  programmeId: string;
  situationalSlugs: string[];
  fillMode: "amzai" | "client";
  /** One per ambiguous role. A missing one stops generation rather than guessing. */
  choices: RoleChoice[];
}): Promise<GenerateResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };
  if (!isAdminOrAbove(session.staff.tier)) {
    return { ok: false, message: "Only an admin can generate onboarding." };
  }

  const context = await loadGenerationContext(input.programmeId);
  if (!context) {
    return { ok: false, message: "That programme does not exist, or you cannot see it." };
  }
  if (context.programme.generatedAt) {
    return {
      ok: false,
      message: "Onboarding was already generated for this programme. A generated set is frozen.",
    };
  }
  if (context.team.length === 0) {
    return {
      ok: false,
      message: "Assign at least one person to this programme before generating onboarding.",
    };
  }

  const plan = planFor(context, input.situationalSlugs);
  if (plan.total === 0) {
    return { ok: false, message: "That would generate no questions at all." };
  }

  const supabase = await createClient();

  const { data: programme, error: programmeError } = await supabase
    .from("programs")
    .select("type, start_date, end_date, fixed_milestone_date, gate_date")
    .eq("id", input.programmeId)
    .maybeSingle();
  if (programmeError || !programme) {
    return { ok: false, message: "Could not read the programme's dates." };
  }

  const { settled, ambiguous } = rolesNeeded(plan, context.team);

  /*
    A choice already recorded for this programme is reused rather than asked
    again, unless the person it names has since left the programme. SPEC.md 4.5.
  */
  const { data: recorded } = await supabase
    .from("program_role_resolutions")
    .select("role_on_program, user_id")
    .eq("program_id", input.programmeId);

  const stillAssigned = new Set(context.team.map((t) => t.userId));
  const unanswered: AmbiguousRole[] = [];
  const toRecord: RoleChoice[] = [];

  for (const role of ambiguous) {
    const submitted = input.choices.find((c) => c.role === role.role);
    if (submitted) {
      if (submitted.userId && !stillAssigned.has(submitted.userId)) {
        return {
          ok: false,
          message: `The person chosen for ${ROLE_LABEL[role.role] ?? role.role} is not assigned to this programme.`,
        };
      }
      settled.set(role.role, submitted.userId);
      toRecord.push(submitted);
      continue;
    }

    const previous = recorded?.find((r) => r.role_on_program === role.role);
    const usable =
      previous && (previous.user_id === null || stillAssigned.has(previous.user_id));
    if (usable) {
      settled.set(role.role, previous.user_id);
      continue;
    }

    unanswered.push(role);
  }

  if (unanswered.length > 0) {
    return {
      ok: false,
      needsResolution: unanswered,
      message:
        "More than one person holds these roles. Choose who each set of questions goes to, or leave them unassigned.",
    };
  }

  const responses = plan.questions.map((q) => ({
    template_field_id: q.field.id,
    owner: q.field.defaultOwner,
    assignee_id:
      q.field.defaultOwner === "client" || !q.field.defaultAssigneeRole
        ? null
        : (settled.get(q.field.defaultAssigneeRole) ?? null),
    due_date: dueDateFor(q.field.defaultOffsetType, q.field.defaultOffsetValue, programme),
    blocking: q.field.blocking,
    is_generic: q.generic,
  }));

  const sources = plan.sets.map((s) => ({ template_id: s.templateId, role: s.role }));

  const { data: written, error } = await supabase.rpc("commit_onboarding_generation", {
    p_program_id: input.programmeId,
    p_fill_mode: input.fillMode,
    p_modules: input.situationalSlugs,
    p_responses: responses,
    p_sources: sources,
    p_resolutions: toRecord.map((c) => ({ role_on_program: c.role, user_id: c.userId })),
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath(`/programs/${input.programmeId}`);
  revalidatePath("/programs");
  return { ok: true, written: written as number };
}
