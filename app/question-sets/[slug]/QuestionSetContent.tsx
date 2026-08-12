"use client";

import { useState } from "react";
import Link from "next/link";

import { Select } from "@/components/form/Field";
import { setFieldOwner } from "@/lib/data/question-set-actions";
import { KIND_LABEL, OWNER_LABEL, OWNERS, type QuestionSetDetail } from "@/lib/question-sets";

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
