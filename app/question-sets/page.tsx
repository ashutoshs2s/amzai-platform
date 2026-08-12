import Link from "next/link";

import { AccessState } from "@/components/AccessState";
import { EmptyState } from "@/components/EmptyState";
import { listQuestionSets } from "@/lib/data/question-sets";
import { KIND_LABEL } from "@/lib/question-sets";
import { getSession } from "@/lib/data/session";

/**
 * The question sets. Module 2.
 *
 * Reference data, so it reads like a table and not like a form. The only thing
 * editable anywhere under here is who owns a question, one screen down.
 */
export const dynamic = "force-dynamic";

export default async function QuestionSetsPage() {
  const session = await getSession();
  if (session.state !== "ok") {
    return (
      <AccessState
        state={session.state}
        email={session.state === "no_staff_record" ? session.email : undefined}
      />
    );
  }

  const sets = await listQuestionSets();

  return (
    <div className="max-w-[1500px]">
      <h1 className="text-page-title font-semibold text-ink">Question sets</h1>
      <p className="mt-1 max-w-[720px] text-body text-slate">
        Imported from the workbook. A programme&rsquo;s onboarding is composed from these
        at generation: the core set, one segment set, and any situational modules chosen.
        Changing a question means importing the workbook again, which creates a new
        version. Ownership is the exception, and is set here.
      </p>

      {sets.length === 0 ? (
        <div className="mt-6">
          <EmptyState message="No question sets yet. Run the workbook importer." />
        </div>
      ) : (
        <table className="mt-6 w-full table-fixed border border-line bg-surface">
          <thead>
            <tr className="border-b border-line text-left text-table-header uppercase tracking-wide text-slate">
              <th className="w-[24%] px-3 py-2 font-medium">Set</th>
              <th className="w-[12%] px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Applies to</th>
              <th className="w-[9%] px-3 py-2 text-right font-medium">Questions</th>
              <th className="w-[9%] px-3 py-2 text-right font-medium">Client</th>
              <th className="w-[9%] px-3 py-2 text-right font-medium">Amzai</th>
              <th className="w-[9%] px-3 py-2 text-right font-medium">Both</th>
              <th className="w-[10%] px-3 py-2 text-right font-medium">Tuned</th>
            </tr>
          </thead>
          <tbody>
            {sets.map((set) => (
              <tr key={set.id} className="h-row border-b border-line last:border-b-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/question-sets/${set.slug}`}
                    className="rounded-base text-body text-accent underline underline-offset-2"
                  >
                    {set.name}
                  </Link>
                  <span className="ml-2 font-time text-caption text-slate">
                    v{set.version}
                  </span>
                </td>
                <td className="px-3 py-2 text-body text-slate">
                  {KIND_LABEL[set.kind] ?? set.kind}
                </td>
                <td className="px-3 py-2 text-body text-slate">{set.appliesTo}</td>
                <td className="px-3 py-2 text-right font-time text-time text-ink">
                  {set.questionCount}
                </td>
                <td className="px-3 py-2 text-right font-time text-time text-slate">
                  {set.clientOwned}
                </td>
                <td className="px-3 py-2 text-right font-time text-time text-slate">
                  {set.amzaiOwned}
                </td>
                <td className="px-3 py-2 text-right font-time text-time text-slate">
                  {set.bothOwned || ""}
                </td>
                <td className="px-3 py-2 text-right font-time text-time text-slate">
                  {set.tuned || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-3 max-w-[720px] text-body text-slate">
        Tuned counts the questions whose owner a person set by hand. Those are never
        overwritten by a later import; the rest follow the importer&rsquo;s default.
      </p>
    </div>
  );
}
