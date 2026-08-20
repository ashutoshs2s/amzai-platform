"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/Button";
import { Field, Select, TextInput } from "@/components/form/Field";
import { setFieldOwner } from "@/lib/data/question-set-actions";
import { addTaskTemplate, removeTaskTemplate } from "@/lib/data/task-actions";
import {
  KIND_LABEL,
  OWNER_LABEL,
  OWNERS,
  type QuestionSetDetail,
  type QuestionSetField,
} from "@/lib/question-sets";
import { ROLE_ON_PROGRAMME, ROLE_ON_PROGRAMME_LABEL } from "@/lib/programme-types";

/**
 * One question set, with ownership editable per question.
 *
 * Ownership is a judgement about who answers, and the workbook does not carry
 * it, so this is where it is corrected. Everything else on the row is the
 * workbook's and is read-only, which the database enforces regardless of what
 * this screen does.
 *
 * Saved on change, not on a save button: it is a single field, and DESIGN.md
 * section 5 has no modal for that. The brief Saved marker follows the same rule
 * as inline editing elsewhere.
 */

export function QuestionSetContent({
  set,
  canEdit,
}: {
  set: QuestionSetDetail;
  canEdit: boolean;
}) {
  const [owners, setOwners] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      set.sections.flatMap((s) => s.fields.map((f) => [f.id, f.owner] as const)),
    ),
  );
  const [saved, setSaved] = useState<string | null>(null);
  const [writingWorkFor, setWritingWorkFor] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function change(fieldId: string, owner: string) {
    const previous = owners[fieldId];
    setOwners((current) => ({ ...current, [fieldId]: owner }));
    setError(null);

    const result = await setFieldOwner(fieldId, owner);
    if (!result.ok) {
      // Put it back. Showing a value the database refused would be a lie.
      setOwners((current) => ({ ...current, [fieldId]: previous }));
      setError({ id: fieldId, message: result.message });
      return;
    }

    setSaved(fieldId);
    setTimeout(() => setSaved((current) => (current === fieldId ? null : current)), 2000);
  }

  const tuned = set.sections
    .flatMap((s) => s.fields)
    .filter((f) => f.setAt !== null).length;

  return (
    <div className="max-w-[1100px]">
      <Link
        href="/question-sets"
        className="rounded-base text-label text-accent underline underline-offset-2"
      >
        Question sets
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-page-title font-semibold text-ink">{set.name}</h1>
        <span className="text-body text-slate">
          {KIND_LABEL[set.kind] ?? set.kind} · {set.appliesTo} · {set.questionCount}{" "}
          questions
        </span>
        <span className="font-time text-caption text-slate">v{set.version}</span>
      </div>

      <p className="mt-3 max-w-[720px] text-body text-slate">
        {canEdit ? (
          <>
            Ownership decides who is asked. Changing it here affects programmes generated
            from now on and never a programme already generated, which holds its own copy.
            A question you set by hand is not overwritten by a later import.
            {" "}
            <span className="text-ink">
              Work defines what approving an answer produces on the Tasks tab.
            </span>
          </>
        ) : (
          <>
            Ownership decides who is asked. Only an admin can change it.
          </>
        )}
      </p>

      {tuned > 0 && (
        <p className="mt-1 text-body text-slate">
          {tuned} of {set.questionCount} set by hand.
        </p>
      )}

      {set.sections.map((section) => (
        <section key={section.section} className="mt-6">
          <h2 className="text-section font-semibold text-ink">
            {section.section}{" "}
            <span className="font-normal text-slate">({section.fields.length})</span>
          </h2>

          <table className="mt-2 w-full table-fixed border border-line bg-surface">
            <tbody>
              {section.fields.map((field) => (
                <tr key={field.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 align-top text-body text-ink">
                    {field.question}
                    {field.duplicateKind && (
                      <span className="mt-1 block text-caption text-slate">
                        {field.duplicateKind === "exact"
                          ? `Also asked in ${field.duplicateOf}. Dropped at generation when both sets apply.`
                          : `Close to a question in ${field.duplicateOf}. Both are kept.`}
                      </span>
                    )}
                    {error?.id === field.id && (
                      <span className="mt-1 block text-caption text-critical" role="status">
                        {error.message}
                      </span>
                    )}

                    <FieldWork
                      slug={set.slug}
                      field={field}
                      canEdit={canEdit}
                      open={writingWorkFor === field.id}
                      onToggle={() =>
                        setWritingWorkFor((c) => (c === field.id ? null : field.id))
                      }
                    />
                  </td>
                  <td className="w-[210px] px-3 py-2 align-top">
                    <span className="flex items-center gap-2">
                      {canEdit ? (
                        <Select
                          quiet
                          value={owners[field.id]}
                          aria-label={`Owner of: ${field.question}`}
                          onChange={(event) => change(field.id, event.target.value)}
                        >
                          {OWNERS.map((owner) => (
                            <option key={owner} value={owner}>
                              {OWNER_LABEL[owner]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="pl-1 text-body text-ink">
                          {OWNER_LABEL[owners[field.id]]}
                        </span>
                      )}

                      {saved === field.id && (
                        <span className="text-caption font-medium text-clear" role="status">
                          Saved
                        </span>
                      )}
                    </span>

                    {field.setByName && saved !== field.id && (
                      <span className="mt-1 block text-caption text-slate">
                        set by {field.setByName}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}


/**
 * What work a question produces.
 *
 * Nothing is supplied by default. What Amzai does once a client has answered is
 * a judgement about delivery, not something a workbook can state, so the first
 * few are written here by hand. From then on, approving that question's answer
 * creates them automatically on the programme.
 */
function FieldWork({
  slug,
  field,
  canEdit,
  open,
  onToggle,
}: {
  slug: string;
  field: QuestionSetField;
  canEdit: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [role, setRole] = useState<string>("delivery_lead");
  const [offsetType, setOffsetType] = useState("weeks_from_start");
  const [offsetValue, setOffsetValue] = useState("2");
  const [blocking, setBlocking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="mt-2">
      {field.tasks.length > 0 && (
        <ul className="flex flex-col gap-1">
          {field.tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-baseline gap-2 text-caption">
              <span className="text-ink">{task.title}</span>
              <span className="text-slate">
                {task.role ? ROLE_ON_PROGRAMME_LABEL[task.role] : "Nobody by default"}
                {" · "}
                {task.offsetType === "weeks_from_start"
                  ? `${task.offsetValue} weeks from start`
                  : `${task.offsetValue} days before the milestone`}
                {task.blocking ? " · blocking" : ""}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={async () => {
                    setProblem(null);
                    const result = await removeTaskTemplate(task.id, slug);
                    if (!result.ok) setProblem(result.message);
                    else location.reload();
                  }}
                  className="rounded-base text-caption text-accent underline underline-offset-2"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-1 rounded-base text-caption text-accent underline underline-offset-2"
        >
          {open
            ? "Done"
            : field.tasks.length === 0
              ? "Define the work this produces"
              : "Add more work"}
        </button>
      )}

      {open && canEdit && (
        <div className="mt-2 flex flex-col gap-2 rounded-base border border-line bg-canvas p-3">
          <Field label="What has to be done" required>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Detail" hint="Optional. Anything the person doing it needs.">
            <TextInput value={detail} onChange={(e) => setDetail(e.target.value)} />
          </Field>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Falls to">
              <Select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Nobody by default</option>
                {ROLE_ON_PROGRAMME.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_ON_PROGRAMME_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due">
              <Select value={offsetType} onChange={(e) => setOffsetType(e.target.value)}>
                <option value="weeks_from_start">Weeks from start</option>
                <option value="days_before_milestone">Days before the milestone</option>
              </Select>
            </Field>
            <Field label="How many">
              <TextInput
                type="number"
                className="w-[80px]"
                value={offsetValue}
                onChange={(e) => setOffsetValue(e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 pb-2 text-body text-ink">
              <input
                type="checkbox"
                checked={blocking}
                onChange={(e) => setBlocking(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Blocking
            </label>
          </div>

          <span>
            <Button
              variant="primary"
              disabled={busy || title.trim() === ""}
              onClick={async () => {
                setBusy(true);
                setProblem(null);
                const result = await addTaskTemplate({
                  templateFieldId: field.id,
                  slug,
                  title,
                  detail,
                  role,
                  offsetType,
                  offsetValue: Number(offsetValue) || 0,
                  blocking,
                });
                setBusy(false);
                if (!result.ok) setProblem(result.message);
                else location.reload();
              }}
            >
              {busy ? "Adding…" : "Add this work"}
            </Button>
          </span>

          {problem && <p className="text-caption text-critical">{problem}</p>}
        </div>
      )}
    </div>
  );
}
