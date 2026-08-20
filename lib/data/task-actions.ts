"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { isAdminOrAbove } from "@/lib/tiers";
import { CHOOSABLE_STATUSES } from "@/lib/tasks";

/**
 * Working a task, and resolving a flagged one.
 *
 * Ordinary staff writes: authenticated client, row level security decides, the
 * audit trigger reads auth.uid(). Anybody who can see a programme can work its
 * tasks, exactly as they can answer its onboarding.
 */

export type TaskResult = { ok: true } | { ok: false; message: string };

const DENIED = "That did not save. You may no longer have access to this programme.";

export async function setTaskStatus(
  taskId: string,
  programmeId: string,
  status: string,
): Promise<TaskResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };
  if (!CHOOSABLE_STATUSES.includes(status)) {
    // Cancelling is its own action, because it takes a reason.
    return { ok: false, message: "That is not a status you can set here." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ status })
    .eq("id", taskId)
    .eq("program_id", programmeId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  return { ok: true };
}

export async function setTaskAssignee(
  taskId: string,
  programmeId: string,
  assigneeId: string | null,
): Promise<TaskResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ assignee_id: assigneeId })
    .eq("id", taskId)
    .eq("program_id", programmeId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  return { ok: true };
}

/**
 * Keep: the work is still right despite the answer moving. Clears the flag and
 * changes nothing else, which is one of the three outcomes SPEC.md section 8
 * allows. It is a decision, and it is recorded as one by the audit trigger.
 */
export async function keepStaleTask(
  taskId: string,
  programmeId: string,
): Promise<TaskResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ stale_since: null, stale_reason: null })
    .eq("id", taskId)
    .eq("program_id", programmeId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  return { ok: true };
}

/**
 * Regenerate: rebuild from the answer as it now stands.
 *
 * One database call, because it supersedes rather than rewrites — the old task
 * is cancelled and a new one created, so the record still shows what was built
 * from the earlier answer. Two round trips could leave one without the other.
 */
export async function regenerateTask(
  taskId: string,
  programmeId: string,
): Promise<TaskResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("regenerate_task", { p_task_id: taskId });

  if (error) return { ok: false, message: error.message };

  revalidatePath(`/programs/${programmeId}`);
  return { ok: true };
}

export async function cancelTask(
  taskId: string,
  programmeId: string,
  reason: string,
): Promise<TaskResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };

  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, message: "Say why it is being cancelled." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({
      status: "cancelled",
      cancelled_reason: trimmed,
      // Cancelling resolves the flag: somebody has decided.
      stale_since: null,
      stale_reason: null,
    })
    .eq("id", taskId)
    .eq("program_id", programmeId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  return { ok: true };
}

export async function addManualTask(
  programmeId: string,
  title: string,
  dueDate: string,
): Promise<TaskResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };

  const trimmed = title.trim();
  if (!trimmed) return { ok: false, message: "Give the task a title." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      program_id: programmeId,
      title: trimmed,
      source: "manual",
      due_date: dueDate || null,
    })
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Authoring what work a question produces                                    */
/* -------------------------------------------------------------------------- */

export async function addTaskTemplate(input: {
  templateFieldId: string;
  slug: string;
  title: string;
  detail: string;
  role: string;
  offsetType: string;
  offsetValue: number;
  blocking: boolean;
}): Promise<TaskResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };
  if (!isAdminOrAbove(session.staff.tier)) {
    return { ok: false, message: "Only an admin can define what work a question produces." };
  }

  const title = input.title.trim();
  if (!title) return { ok: false, message: "Give the task a title." };

  const supabase = await createClient();
  const { error } = await supabase.from("task_templates").insert({
    template_field_id: input.templateFieldId,
    title,
    detail: input.detail.trim() || null,
    default_assignee_role: input.role || null,
    default_offset_type: input.offsetType,
    default_offset_value: input.offsetValue,
    blocking: input.blocking,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath(`/question-sets/${input.slug}`);
  return { ok: true };
}

export async function removeTaskTemplate(
  id: string,
  slug: string,
): Promise<TaskResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };
  if (!isAdminOrAbove(session.staff.tier)) {
    return { ok: false, message: "Only an admin can change what work a question produces." };
  }

  const supabase = await createClient();
  /*
    Deactivated rather than deleted. Tasks already created point at it, and
    regenerating one needs the template it came from to still exist.
  */
  const { data, error } = await supabase
    .from("task_templates")
    .update({ active: false })
    .eq("id", id)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/question-sets/${slug}`);
  return { ok: true };
}
