import { notFound } from "next/navigation";

import { SAMPLE_PROGRAMMES } from "../sample-data";
import { ProgrammeDetailContent } from "./ProgrammeDetailContent";

/**
 * Programme detail. DESIGN.md section 6.2.
 *
 * Where the team spends most of its time. Built on the same hard-coded sample
 * data as the list; no database queries.
 *
 * Only the Onboarding tab has content. The rest carry empty states naming what
 * would be there, which is the honest rendering of a module that does not exist
 * yet rather than a tab that looks broken.
 */
export const dynamic = "force-dynamic";

export default async function ProgrammeDetailPage({ params }: PageProps<"/programs/[id]">) {
  const { id } = await params;
  const programme = SAMPLE_PROGRAMMES.find((entry) => entry.id === id);
  if (!programme) notFound();

  return <ProgrammeDetailContent programmeId={id} nowIso={new Date().toISOString()} />;
}
