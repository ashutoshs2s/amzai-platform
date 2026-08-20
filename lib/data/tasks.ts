import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Task } from "@/lib/tasks";

export type { Task } from "@/lib/tasks";

/**
 * A programme's tasks.
 *
 * Read through the authenticated client, so row level security scopes them
 * exactly as it scopes the programme they belong to.
 */
export async function listTasks(programmeId: string): Promise<Task[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .select(
      `id, title, detail, assignee_id, role_on_program, due_date, status, blocking,
       source, source_response_id, source_task_template_id, source_answer,
       stale_since, stale_reason, cancelled_reason,
       assignee:users ( full_name ),
       response:onboarding_responses (
         response,
         field:onboarding_template_fields ( question )
       )`,
    )
    .eq("program_id", programmeId)
    .order("due_date", { nullsFirst: false })
    .order("title");

  if (error) throw new Error(`Could not load tasks: ${error.message}`);

  return (data ?? []).map((row) => {
    const response = row.response as unknown as
      | { response: string | null; field: { question: string } | null }
      | null;

    return {
      id: row.id,
      title: row.title,
      detail: row.detail,
      assigneeId: row.assignee_id,
      assigneeName:
        (row.assignee as unknown as { full_name: string } | null)?.full_name ?? null,
      roleOnProgramme: row.role_on_program,
      dueDate: row.due_date,
      status: row.status,
      blocking: row.blocking,
      source: row.source,
      sourceQuestion: response?.field?.question ?? null,
      sourceResponseId: row.source_response_id,
      sourceAnswer: row.source_answer,
      currentAnswer: response?.response ?? null,
      staleSince: row.stale_since,
      staleReason: row.stale_reason,
      cancelledReason: row.cancelled_reason,
      canRegenerate: row.source === "onboarding" && row.source_task_template_id !== null,
    };
  });
}

/**
 * Whether any task template exists at all.
 *
 * The task engine ships empty on purpose: a task template is a judgement about
 * how Amzai delivers, and inventing a starter set would hand the team work to
 * unpick. So the screen has to tell the difference between "no work yet" and
 * "nobody has written the rules yet", which are very different states.
 */
export async function anyTaskTemplatesExist(): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("task_templates")
    .select("id", { count: "exact", head: true })
    .eq("active", true);

  return (count ?? 0) > 0;
}
