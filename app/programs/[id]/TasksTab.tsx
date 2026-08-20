"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { Select, TextInput } from "@/components/form/Field";
import {
  addManualTask,
  cancelTask,
  keepStaleTask,
  regenerateTask,
  setTaskAssignee,
  setTaskStatus,
} from "@/lib/data/task-actions";
import { CHOOSABLE_STATUSES, isOpen, TASK_STATUS_LABEL, type Task } from "@/lib/tasks";
import { formatDayMonth } from "@/lib/time";

/**
 * Delivery Operations. SPEC.md module 3.
 *
 * Tasks come from approved onboarding answers, plus whatever somebody adds by
 * hand. A task whose source answer has since changed is FLAGGED, never
 * rewritten — SPEC.md section 8 — and carries the three ways out: keep,
 * regenerate, or cancel with a reason.
 *
 * Staleness is surfaced in the same language as blocking, because it is the
 * same kind of fact: something needs a person to look at it, and no email is
 * going to tell them. There is no notification system in this product, and
 * pretending otherwise would be worse than saying so.
 */
export function TasksTab({
  programmeId,
  tasks,
  team,
  anyTemplates,
  canEditTemplates,
}: {
  programmeId: string;
  tasks: Task[];
  team: { id: string; name: string }[];
  /** Whether ANY question anywhere defines work yet. */
  anyTemplates: boolean;
  canEditTemplates: boolean;
}) {
  const [rows, setRows] = useState(tasks);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const [seen, setSeen] = useState(tasks);
  if (tasks !== seen) {
    setSeen(tasks);
    setRows(tasks);
  }

  const stale = rows.filter((task) => task.staleSince !== null);
  const open = rows.filter(isOpen);
  const closed = rows.filter((task) => !isOpen(task));

  async function run(id: string, apply: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    const result = await apply();
    if (!result.ok) {
      setError({ id, message: result.message ?? "That did not work." });
      return false;
    }
    return true;
  }

  return (
    <div className="mt-7">
      {/* ---------------------------------------------------------------- */}
      {/* Flagged work, in the same language as the blocking bar            */}
      {/* ---------------------------------------------------------------- */}
      {stale.length > 0 && (
        <div className="mb-6 rounded-base border border-watch bg-watch-bg px-3 py-2">
          <p className="text-body font-medium text-watch">
            <span className="font-time text-time font-medium">{stale.length}</span>{" "}
            {stale.length === 1 ? "task was" : "tasks were"} built from an answer that has
            since changed
          </p>
          <p className="mt-1 text-body text-watch">
            Nothing has been regenerated and no answer is locked. Decide on each one below.
          </p>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* The empty state has to distinguish two very different things      */}
      {/* ---------------------------------------------------------------- */}
      {rows.length === 0 && (
        <div className="rounded-base border border-line bg-surface p-6">
          {anyTemplates ? (
            <>
              <p className="text-body text-ink">No tasks yet.</p>
              <p className="mt-2 max-w-[600px] text-body text-slate">
                Tasks appear here when an onboarding answer is approved and the question it
                answers defines work. Approve an answer on the Onboarding tab, or add a task
                by hand below.
              </p>
            </>
          ) : (
            <>
              <p className="text-body text-ink">
                No question defines any work yet, so nothing can generate.
              </p>
              <p className="mt-2 max-w-[600px] text-body text-slate">
                This is setup, not a fault. A task template says what work approving a
                given question produces — who it falls to, when it is due, whether it
                blocks. Nothing is supplied by default, because what Amzai does after an
                answer is a judgement rather than something a workbook can state.
              </p>
              <p className="mt-2 max-w-[600px] text-body text-slate">
                Write the first few on <span className="text-ink">Question sets</span>, on
                any question that ought to produce work. From then on, approving that
                question&rsquo;s answer creates it.
              </p>
              {!canEditTemplates && (
                <p className="mt-2 text-body text-slate">
                  Defining them is an admin job. Ask an admin to set the first ones up.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {open.length > 0 && (
        <section>
          <h3 className="border-b border-line pb-2 text-section font-semibold text-ink">
            Open{" "}
            <span className="font-time text-caption font-medium text-slate">
              {open.length}
            </span>
          </h3>
          <div className="mt-3 overflow-hidden rounded-base border border-line bg-surface">
            {open.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                team={team}
                error={error?.id === task.id ? error.message : undefined}
                cancelling={cancelling === task.id}
                reason={reason}
                onReason={setReason}
                onStartCancel={() => {
                  setCancelling(task.id);
                  setReason("");
                }}
                onStopCancel={() => setCancelling(null)}
                onStatus={async (status) => {
                  if (await run(task.id, () => setTaskStatus(task.id, programmeId, status))) {
                    setRows((c) => c.map((r) => (r.id === task.id ? { ...r, status } : r)));
                  }
                }}
                onAssignee={async (assigneeId) => {
                  if (
                    await run(task.id, () => setTaskAssignee(task.id, programmeId, assigneeId))
                  ) {
                    const name = team.find((m) => m.id === assigneeId)?.name ?? null;
                    setRows((c) =>
                      c.map((r) => (r.id === task.id ? { ...r, assigneeId, assigneeName: name } : r)),
                    );
                  }
                }}
                onKeep={async () => {
                  if (await run(task.id, () => keepStaleTask(task.id, programmeId))) {
                    setRows((c) =>
                      c.map((r) =>
                        r.id === task.id ? { ...r, staleSince: null, staleReason: null } : r,
                      ),
                    );
                  }
                }}
                onRegenerate={async () => {
                  await run(task.id, () => regenerateTask(task.id, programmeId));
                  location.reload();
                }}
                onCancel={async () => {
                  if (await run(task.id, () => cancelTask(task.id, programmeId, reason))) {
                    location.reload();
                  }
                }}
              />
            ))}
          </div>
        </section>
      )}

      {closed.length > 0 && (
        <section className="mt-8">
          <h3 className="border-b border-line pb-2 text-section font-semibold text-ink">
            Done and cancelled{" "}
            <span className="font-time text-caption font-medium text-slate">
              {closed.length}
            </span>
          </h3>
          <div className="mt-3 overflow-hidden rounded-base border border-line bg-surface">
            {closed.map((task) => (
              <div key={task.id} className="border-b border-line px-3 py-3 last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-body text-slate line-through">{task.title}</span>
                  <span className="text-caption text-slate">
                    {TASK_STATUS_LABEL[task.status]}
                  </span>
                  {task.cancelledReason && (
                    <span className="text-caption text-slate">— {task.cancelledReason}</span>
                  )}
                </div>
                {task.staleSince && (
                  <p className="mt-1 text-caption text-watch">
                    {task.staleReason} It was already {TASK_STATUS_LABEL[task.status]?.toLowerCase()}.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      <section className="mt-8">
        <h3 className="border-b border-line pb-2 text-section font-semibold text-ink">
          Add a task by hand
        </h3>
        <div className="mt-3 flex flex-wrap items-end gap-4 rounded-base border border-line bg-surface p-4">
          <label className="flex flex-col gap-0.5">
            <span className="text-label font-medium text-slate">Title</span>
            <TextInput
              className="w-[320px]"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-label font-medium text-slate">Due</span>
            <TextInput
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </label>
          <Button
            variant="primary"
            disabled={busy || title.trim() === ""}
            onClick={async () => {
              setBusy(true);
              const result = await addManualTask(programmeId, title, due);
              setBusy(false);
              if (result.ok) location.reload();
              else setError({ id: "new", message: result.message });
            }}
          >
            {busy ? "Adding…" : "Add task"}
          </Button>
          {error?.id === "new" && (
            <span className="text-body text-critical">{error.message}</span>
          )}
        </div>
      </section>
    </div>
  );
}

function TaskRow({
  task,
  team,
  error,
  cancelling,
  reason,
  onReason,
  onStartCancel,
  onStopCancel,
  onStatus,
  onAssignee,
  onKeep,
  onRegenerate,
  onCancel,
}: {
  task: Task;
  team: { id: string; name: string }[];
  error?: string;
  cancelling: boolean;
  reason: string;
  onReason: (value: string) => void;
  onStartCancel: () => void;
  onStopCancel: () => void;
  onStatus: (status: string) => void;
  onAssignee: (assigneeId: string | null) => void;
  onKeep: () => void;
  onRegenerate: () => void;
  onCancel: () => void;
}) {
  const unassigned = task.assigneeId === null;

  return (
    <div
      className={`border-b border-l-2 border-line px-3 py-3 last:border-b-0 ${
        task.staleSince ? "border-l-watch bg-watch-bg/30" : "border-l-transparent"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-body font-medium text-ink">{task.title}</span>
        {task.blocking && (
          <span className="rounded-base bg-critical-bg px-1.5 py-[1px] text-pill font-medium uppercase tracking-[0.04em] text-critical">
            Blocking
          </span>
        )}
        {task.source === "manual" && (
          <span className="text-caption text-slate">Added by hand</span>
        )}
      </div>

      {task.detail && <p className="mt-1 text-body text-slate">{task.detail}</p>}

      {task.sourceQuestion && (
        <p className="mt-1 text-caption text-slate">From: {task.sourceQuestion}</p>
      )}

      {/* --------------------------------------------------------------- */}
      {/* Flagged: show what it was built from and what it now says        */}
      {/* --------------------------------------------------------------- */}
      {task.staleSince && (
        <div className="mt-2 rounded-base border border-watch bg-surface p-3">
          <p className="text-body font-medium text-watch">{task.staleReason}</p>

          <dl className="mt-2 flex flex-col gap-2">
            <div>
              <dt className="text-label font-medium text-slate">Built from</dt>
              <dd className="text-body text-ink">{task.sourceAnswer || "— no answer —"}</dd>
            </div>
            <div>
              <dt className="text-label font-medium text-slate">The answer now</dt>
              <dd className="text-body text-ink">{task.currentAnswer || "— no answer —"}</dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={onKeep}>Keep as it is</Button>
            {task.canRegenerate && (
              <Button onClick={onRegenerate}>Regenerate from the new answer</Button>
            )}
            <span className="text-caption text-slate">
              Regenerating cancels this one and creates a replacement, so both stay on the
              record.
            </span>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-slate">
        <span className="flex items-center gap-1">
          Status
          <Select
            quiet
            aria-label={`Status of: ${task.title}`}
            value={task.status}
            onChange={(event) => onStatus(event.target.value)}
          >
            {CHOOSABLE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
        </span>

        <span className="flex items-center gap-1">
          Assignee
          <Select
            quiet
            aria-label={`Assignee for: ${task.title}`}
            value={task.assigneeId ?? ""}
            onChange={(event) => onAssignee(event.target.value || null)}
            className={unassigned ? "text-watch" : "text-ink"}
          >
            <option value="">Unassigned</option>
            {team.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </span>

        {unassigned && task.roleOnProgramme && (
          <span className="text-watch">
            No single {task.roleOnProgramme.replace(/_/g, " ")} on this programme
          </span>
        )}

        {task.dueDate && (
          <span>
            Due <span className="font-time text-caption text-ink">{formatDayMonth(task.dueDate)}</span>
          </span>
        )}

        {!cancelling && (
          <Button variant="quiet" className="ml-auto" onClick={onStartCancel}>
            Cancel
          </Button>
        )}
      </div>

      {cancelling && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-label font-medium text-slate">Why is it being cancelled?</span>
            <TextInput
              className="w-[320px]"
              value={reason}
              onChange={(event) => onReason(event.target.value)}
            />
          </label>
          <Button variant="destructive" disabled={reason.trim() === ""} onClick={onCancel}>
            Cancel this task
          </Button>
          <Button onClick={onStopCancel}>Keep it</Button>
        </div>
      )}

      {error && (
        <p className="mt-1 text-caption text-critical" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
