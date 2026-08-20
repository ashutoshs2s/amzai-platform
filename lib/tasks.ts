/**
 * Tasks, client-safe. Labels and shapes only.
 *
 * A task is a unit of delivery work. An onboarding response is a question and
 * its answer. Keeping the two apart is the whole design: one is information,
 * the other is work that follows from it.
 */

export const TASK_STATUSES = [
  "not_started",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;

export const TASK_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

/** Statuses somebody picks. Cancelled is reached by cancelling, with a reason. */
export const CHOOSABLE_STATUSES = ["not_started", "in_progress", "blocked", "done"];

export type Task = {
  id: string;
  title: string;
  detail: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  roleOnProgramme: string | null;
  dueDate: string | null;
  status: string;
  blocking: boolean;
  source: "onboarding" | "manual";
  /** The question this came from, for the operator's sake. */
  sourceQuestion: string | null;
  sourceResponseId: string | null;
  /** The answer as it was when the task was built. */
  sourceAnswer: string | null;
  /** The answer as it stands now, when the two differ. */
  currentAnswer: string | null;
  staleSince: string | null;
  staleReason: string | null;
  cancelledReason: string | null;
  /** Whether regenerating is possible: the template must still exist. */
  canRegenerate: boolean;
};

export function isOpen(task: Task): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}
