"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";

/**
 * The first write path in the application.
 *
 * Everything here goes through the authenticated server client, so row level
 * security decides what may be written, exactly as it decides what may be read.
 * A staff member editing a programme they cannot see updates zero rows rather
 * than being told no: the policy is the boundary and this code does not repeat
 * it.
 *
 * The actor is not set explicitly. The audit trigger falls back to auth.uid()
 * when no session variable is present, and here that is right: this runs under
 * the signed-in staff member's own identity, so the fallback records exactly
 * who they are. set_actor() exists for the client-facing routes, which run
 * under the service role and genuinely have no database identity.
 *
 * Each PostgREST call is its own transaction, so a set_actor() call followed by
 * an update would be two transactions and the setting would be gone by the
 * second. Anything needing an explicit actor has to do both inside one
 * function, which is a problem for the client routes to solve when they exist.
 */

export type SaveResult = { ok: true } | { ok: false; message: string };

/** onboarding_responses.status. SPEC.md section 3. */
const RESPONSE_STATUSES = [
  "not_started",
  "in_progress",
  "submitted",
  "approved",
  "blocked",
  "na",
];

const DENIED =
  "That did not save. You may no longer have access to this programme.";

/** Staff answering a field. Records who answered and when. */
export async function saveResponseText(
  responseId: string,
  programmeId: string,
  text: string,
): Promise<SaveResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };

  const supabase = await createClient();
  const trimmed = text.trim();

  /*
    Clearing an answer clears its authorship too. Leaving a name against an
    empty field would say somebody answered it when nobody has.

    answered_by_contact_id is nulled because a staff edit replaces a client's
    answer, and the check constraint permits only one author.
  */
  const authorship = trimmed
    ? {
        answer_source: "amzai_written",
        answered_by: session.staff.id,
        answered_by_contact_id: null,
        answered_at: new Date().toISOString(),
      }
    : {
        answer_source: null,
        answered_by: null,
        answered_by_contact_id: null,
        answered_at: null,
      };

  const { data, error } = await supabase
    .from("onboarding_responses")
    .update({ response: text, ...authorship })
    .eq("id", responseId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  // Row level security filters rather than refuses: no rows means not allowed.
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  return { ok: true };
}

/** Reassigning a field. The awaiting-me count follows from this column. */
export async function saveResponseAssignee(
  responseId: string,
  programmeId: string,
  assigneeId: string | null,
): Promise<SaveResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("onboarding_responses")
    .update({ assignee_id: assigneeId })
    .eq("id", responseId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  return { ok: true };
}

/**
 * Status. The counts on both screens derive from this column.
 *
 * A programme's section counts, its answered line, its blocking bar and the
 * four portfolio counts on the list are all functions of status, which is why
 * this revalidates the list as well as the programme. The screen updates its
 * own copy optimistically; this is what makes the *other* screen right when the
 * operator gets back to it.
 */
export async function saveResponseStatus(
  responseId: string,
  programmeId: string,
  status: string,
): Promise<SaveResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };
  if (!RESPONSE_STATUSES.includes(status)) {
    return { ok: false, message: "That is not a status." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("onboarding_responses")
    .update({ status })
    .eq("id", responseId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  revalidatePath("/programs");
  return { ok: true };
}

/**
 * Due date.
 *
 * Clearing it is allowed and means the same as it did at generation: there is
 * no date to count from. A blank due date is honest, and inventing one puts a
 * deadline in front of somebody that nothing justifies.
 */
export async function saveResponseDueDate(
  responseId: string,
  programmeId: string,
  dueDate: string,
): Promise<SaveResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };

  const value = dueDate.trim();
  if (value !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, message: "A due date needs to look like 2026-09-14." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("onboarding_responses")
    .update({ due_date: value === "" ? null : value })
    .eq("id", responseId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  revalidatePath("/programs");
  return { ok: true };
}

/**
 * Reassign every response on a programme from one person to another.
 * SPEC.md section 4.6.
 *
 * For the real cases: somebody leaves, somebody covers. Changing a person's
 * role_on_program deliberately does NOT move existing assignments, because
 * that would change who owes what without anyone being told; this is the
 * explicit action that does.
 *
 * One statement, and the audit trigger fires per row, so the trail carries one
 * event per response changed rather than a single vague "bulk reassign". A year
 * later "who was this assigned to in September" has an answer.
 */
export async function reassignResponses(
  programmeId: string,
  fromAssigneeId: string,
  toAssigneeId: string | null,
): Promise<SaveResult & { moved?: number }> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };
  if (!fromAssigneeId) return { ok: false, message: "Choose who to reassign from." };
  if (fromAssigneeId === toAssigneeId) {
    return { ok: false, message: "That is the same person." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("onboarding_responses")
    .update({ assignee_id: toAssigneeId })
    .eq("program_id", programmeId)
    .eq("assignee_id", fromAssigneeId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  revalidatePath("/programs");
  return { ok: true, moved: data.length };
}
