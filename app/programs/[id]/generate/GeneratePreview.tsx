"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/Button";
import { generateOnboarding, type RoleChoice } from "@/lib/data/generation-actions";
import { rolesNeeded, roleLabel, unassignedCount } from "@/lib/generation/assignment.ts";
import { resolveQuestions, type Selection, type Template } from "@/lib/generation/resolve.ts";

/**
 * What will be generated, before anything is.
 *
 * The plan is recomputed in the browser as selections change, by calling the
 * same resolver the server calls. That is why it can be a pure function with no
 * database access: the preview and the commit are the same calculation, so the
 * screen cannot promise one thing and the write do another. The server runs it
 * again on submit regardless, because a browser can be lied to.
 */

const UNASSIGNED = "__unassigned__";

const ROLE_NOTE: Record<string, string> = {
  core: "Applies to every programme",
  segment: "Chosen by the client's segment",
  situational: "Chosen for this programme",
  fallback: "Borrowed, no set of its own",
};

type Props = {
  programme: {
    id: string;
    name: string;
    organisationName: string;
    type: string;
    clientTypeLabel: string;
    subSegmentLabel: string | null;
    category: string | null;
  };
  team: { userId: string; fullName: string; role: string }[];
  offered: { slug: string; name: string; questionCount: number }[];
  selectedSlugs: string[];
  selection: Selection;
  templates: Template[];
};

export function GeneratePreview({
  programme,
  team,
  offered,
  selectedSlugs,
  selection,
  templates,
}: Props) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>(selectedSlugs);
  const [fillMode, setFillMode] = useState<"amzai" | "client">("amzai");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = useMemo(
    () => resolveQuestions(templates, { ...selection, situationalSlugs: chosen }),
    [templates, selection, chosen],
  );

  const { settled, ambiguous, unheld } = useMemo(
    () => rolesNeeded(plan, team),
    [plan, team],
  );

  // A deliberate "leave unassigned" counts as an answer. SPEC.md 4.4.
  const answered = ambiguous.every((role) => choices[role.role] !== undefined);

  const wouldBeUnassigned = useMemo(() => {
    const withChoices = new Map(settled);
    for (const role of ambiguous) {
      const choice = choices[role.role];
      if (choice !== undefined) {
        withChoices.set(role.role, choice === UNASSIGNED ? null : choice);
      }
    }
    return unassignedCount(plan, withChoices);
  }, [plan, settled, ambiguous, choices]);

  const genericCount = plan.questions.filter((q) => q.generic).length;
  const blocked = team.length === 0;

  async function submit() {
    setBusy(true);
    setError(null);

    const result = await generateOnboarding({
      programmeId: programme.id,
      situationalSlugs: chosen,
      fillMode,
      choices: ambiguous.map<RoleChoice>((role) => ({
        role: role.role,
        userId: choices[role.role] === UNASSIGNED ? null : (choices[role.role] ?? null),
      })),
    });

    setBusy(false);
    if (result.ok) {
      router.push(`/programs/${programme.id}`);
      router.refresh();
      return;
    }
    setError(result.message);
  }

  return (
    <div className="max-w-[1000px] p-6">
      <Link
        href={`/programs/${programme.id}`}
        className="text-body text-accent hover:underline"
      >
        ← {programme.name}
      </Link>

      <h1 className="mt-3 text-page-title font-semibold text-ink">Generate onboarding</h1>
      <p className="mt-1 text-body text-slate">
        {programme.organisationName} · {programme.clientTypeLabel}
        {programme.subSegmentLabel ? ` · ${programme.subSegmentLabel}` : ""}
        {programme.category ? ` · ${programme.category}` : ""} · {programme.type}
      </p>
      <p className="mt-3 max-w-[640px] text-body text-slate">
        Nothing is written until you press Generate. Once generated, this set is frozen to
        the programme: a later workbook import or a change to the segment mapping will not
        alter it.
      </p>

      {/* ---------------------------------------------------------------- */}
      {offered.length > 0 && (
        <section className="mt-8">
          <h2 className="text-section font-medium text-ink">Situational modules</h2>
          <p className="mt-1 text-body text-slate">
            Optional and independent. Each appends its questions; anything it repeats is
            dropped below.
          </p>
          <div className="mt-3 overflow-hidden rounded-base border border-line bg-surface">
            {offered.map((module) => (
              <label
                key={module.slug}
                className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 hover:bg-canvas"
              >
                <input
                  type="checkbox"
                  checked={chosen.includes(module.slug)}
                  onChange={(event) =>
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, module.slug]
                        : current.filter((s) => s !== module.slug),
                    )
                  }
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="text-body text-ink">{module.name}</span>
                <span className="ml-auto font-time text-time font-medium text-ink">
                  {module.questionCount}
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      <section className="mt-8">
        <h2 className="text-section font-medium text-ink">
          Question sets selected{" "}
          <span className="font-normal text-slate">({plan.sets.length})</span>
        </h2>
        <table className="mt-3 w-full table-fixed overflow-hidden rounded-base border border-line bg-surface">
          <thead>
            <tr className="border-b border-line bg-surface-head text-left text-table-header uppercase tracking-[0.04em] text-slate">
              <th className="w-[26%] px-3 py-2 font-medium">Set</th>
              <th className="w-[14%] px-3 py-2 font-medium">Why</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="w-[12%] px-3 py-2 text-right font-medium">Questions</th>
            </tr>
          </thead>
          <tbody>
            {plan.sets.map((set) => (
              <tr key={set.templateId} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 text-body text-ink">
                  {set.name}
                  <span className="ml-2 font-time text-caption text-slate">v{set.version}</span>
                </td>
                <td className="px-3 py-2 text-body text-slate">{ROLE_NOTE[set.role]}</td>
                <td className="px-3 py-2 text-body text-slate">{set.reason}</td>
                <td className="px-3 py-2 text-right font-time text-time font-medium text-ink">
                  {set.contributed}
                  {set.contributed !== set.offered && (
                    <span className="text-slate"> of {set.offered}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td colSpan={3} className="px-3 py-2 text-body font-medium text-ink">
                Total questions
              </td>
              <td className="px-3 py-2 text-right font-time text-time font-medium text-ink">
                {plan.total}
              </td>
            </tr>
          </tfoot>
        </table>

        {genericCount > 0 && (
          <p className="mt-2 text-body text-watch">
            {genericCount} question{genericCount === 1 ? " is" : "s are"} marked generic:
            borrowed from another sub-segment&rsquo;s set because this one has none of its
            own.
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {plan.dropped.length > 0 && (
        <section className="mt-8">
          <h2 className="text-section font-medium text-ink">
            Dropped as duplicates{" "}
            <span className="font-normal text-slate">({plan.dropped.length})</span>
          </h2>
          <p className="mt-1 text-body text-slate">
            Asked once, by whichever set came first. Not silently: this is the list.
          </p>
          <table className="mt-3 w-full table-fixed overflow-hidden rounded-base border border-line bg-surface">
            <tbody>
              {plan.dropped.map((d, index) => (
                <tr key={index} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 text-body text-ink">{d.question}</td>
                  <td className="w-[38%] px-3 py-2 text-body text-slate">
                    in {d.fromSet}, already asked by {d.alreadyIn}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {plan.near.length > 0 && (
        <section className="mt-8">
          <h2 className="text-section font-medium text-ink">
            Close, kept anyway{" "}
            <span className="font-normal text-slate">({plan.near.length})</span>
          </h2>
          <p className="mt-1 text-body text-slate">
            Similar to a question already in the set but not identical. Both are kept: a
            repeated question is annoying, a subtly different one dropped is worse.
          </p>
          <table className="mt-3 w-full table-fixed overflow-hidden rounded-base border border-line bg-surface">
            <tbody>
              {plan.near.map((q) => (
                <tr key={q.field.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 text-body text-ink">
                    {q.field.question}
                    <span className="mt-1 block text-body text-slate">
                      against {q.nearDuplicateOf?.setName}: {q.nearDuplicateOf?.question}
                    </span>
                  </td>
                  <td className="w-[10%] px-3 py-2 text-right font-time text-time font-medium text-slate">
                    {Math.round((q.nearDuplicateOf?.score ?? 0) * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {ambiguous.length > 0 && (
        <section className="mt-8">
          <h2 className="text-section font-medium text-ink">Who answers these</h2>
          <p className="mt-1 text-body text-slate">
            More than one person holds these roles. The platform will not pick one:
            a wrong guess stays invisible until somebody misses a deadline.
          </p>
          <div className="mt-3 overflow-hidden rounded-base border border-line bg-surface">
            {ambiguous.map((role) => (
              <div
                key={role.role}
                className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
              >
                <span className="w-[180px] text-body text-ink">{roleLabel(role.role)}</span>
                <span className="w-[80px] font-time text-time font-medium text-ink">
                  {role.fieldCount}
                </span>
                <select
                  value={choices[role.role] ?? ""}
                  onChange={(event) =>
                    setChoices((current) => ({ ...current, [role.role]: event.target.value }))
                  }
                  className="h-8 rounded-base border border-line bg-surface px-2 text-body text-ink"
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {role.holders.map((holder) => (
                    <option key={holder.id} value={holder.id}>
                      {holder.fullName}
                    </option>
                  ))}
                  <option value={UNASSIGNED}>Leave unassigned</option>
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {unheld.length > 0 && (
        <p className="mt-3 text-body text-watch">
          Nobody on this programme holds{" "}
          {unheld.map((u) => `${roleLabel(u.role).toLowerCase()} (${u.fieldCount})`).join(", ")}.
          Those questions will generate unassigned.
        </p>
      )}

      {/* ---------------------------------------------------------------- */}
      <section className="mt-8">
        <h2 className="text-section font-medium text-ink">Who fills this in</h2>
        <div className="mt-3 overflow-hidden rounded-base border border-line bg-surface">
          {(
            [
              ["amzai", "Amzai fills it in", "Answers are written internally. No link goes to the client."],
              ["client", "The client fills it in", "The client is sent a link to the questions owned by them."],
            ] as const
          ).map(([value, label, note]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 border-b border-line px-3 py-2 last:border-b-0 hover:bg-canvas"
            >
              <input
                type="radio"
                name="fill-mode"
                checked={fillMode === value}
                onChange={() => setFillMode(value)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span>
                <span className="block text-body text-ink">{label}</span>
                <span className="block text-body text-slate">{note}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {plan.problems.length > 0 && (
        <ul className="mt-6 border border-critical rounded-base bg-critical-bg p-3">
          {plan.problems.map((problem, index) => (
            <li key={index} className="text-body text-critical">
              {problem.message}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-6 border border-critical rounded-base bg-critical-bg p-3 text-body text-critical">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center gap-3 border-t border-line pt-4">
        <Button variant="primary" disabled={busy || blocked || !answered} onClick={submit}>
          {busy ? "Generating…" : `Generate ${plan.total} questions`}
        </Button>
        <Link href={`/programs/${programme.id}`} className="text-body text-accent hover:underline">
          Cancel
        </Link>

        <span className="ml-auto text-body text-slate">
          {wouldBeUnassigned > 0 && `${wouldBeUnassigned} would be unassigned`}
        </span>
      </div>

      {/* A disabled button with no explanation is a dead end. DESIGN.md 5. */}
      {blocked && (
        <p className="mt-2 text-body text-critical">
          Assign at least one person to this programme first. Without a team every question
          generates unassigned, and unassigned work is invisible work.
        </p>
      )}
      {!blocked && !answered && (
        <p className="mt-2 text-body text-slate">
          Answer every row under &ldquo;Who answers these&rdquo; first. Leaving one
          unassigned counts as an answer.
        </p>
      )}
    </div>
  );
}
