import { notFound } from "next/navigation";
import Link from "next/link";

import { AccessState } from "@/components/AccessState";
import { loadGenerationContext, planFor } from "@/lib/data/generation";
import { getSession } from "@/lib/data/session";
import { formatDayMonthYear } from "@/lib/time";

import { GeneratePreview } from "./GeneratePreview";

/**
 * The generation preview. SPEC.md section 4.4.
 *
 * Two steps, never one. Nothing is written by opening this screen: it shows
 * which question sets the selections resolve to and why, what the total comes
 * to, and what was dropped as a duplicate. Changing a selection recomputes it
 * in place, using the same resolver the commit uses, so the admin approves the
 * thing that actually happens rather than a description of it.
 */
export const dynamic = "force-dynamic";

export default async function GeneratePage({ params }: PageProps<"/programs/[id]/generate">) {
  const { id } = await params;

  const session = await getSession();
  if (session.state !== "ok") {
    return (
      <AccessState
        state={session.state}
        email={session.state === "no_staff_record" ? session.email : undefined}
      />
    );
  }

  const context = await loadGenerationContext(id);
  if (!context) notFound();

  if (!context.canGenerate) {
    return (
      <div className="max-w-[720px] p-6">
        <h1 className="text-page-title font-semibold text-ink">Generate onboarding</h1>
        <p className="mt-3 text-body text-slate">
          Only an admin, or the manager who holds this client, can generate onboarding.
        </p>
        <Link
          href={`/programs/${id}`}
          className="mt-4 inline-block text-body text-accent hover:underline"
        >
          Back to {context.programme.name}
        </Link>
      </div>
    );
  }

  if (context.programme.generatedAt) {
    return (
      <div className="max-w-[720px] p-6">
        <h1 className="text-page-title font-semibold text-ink">Onboarding is generated</h1>
        <p className="mt-3 text-body text-slate">
          {context.programme.name} had its onboarding generated on{" "}
          <span className="font-time text-time text-ink">
            {formatDayMonthYear(context.programme.generatedAt)}
          </span>
          . A generated set is frozen to the programme: importing a new workbook or
          changing a mapping will not alter it.
        </p>
        <Link
          href={`/programs/${id}`}
          className="mt-4 inline-block text-body text-accent hover:underline"
        >
          Back to {context.programme.name}
        </Link>
      </div>
    );
  }

  /*
    Only the sets that could possibly apply are sent to the browser, so the
    preview can recompute as the admin ticks a module without a round trip.
    Resolving against every template in the database would mean shipping every
    client's questions to every screen.
  */
  const widest = planFor(
    context,
    context.offered.map((m) => m.slug),
  );
  const relevant = new Set(widest.sets.map((s) => s.templateId));
  const templates = context.templates.filter((t) => relevant.has(t.id));

  return (
    <GeneratePreview
      programme={context.programme}
      team={context.team}
      offered={context.offered}
      selectedSlugs={context.selectedSlugs}
      selection={context.selection}
      templates={templates}
    />
  );
}
