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
