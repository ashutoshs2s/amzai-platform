import { notFound } from "next/navigation";

import { AccessState } from "@/components/AccessState";
import { getProgramme } from "@/lib/data/programmes";
import { getSession } from "@/lib/data/session";

import { ProgrammeDetailContent } from "./ProgrammeDetailContent";

/**
 * Programme detail. DESIGN.md section 6.2.
 *
 * Reads through the authenticated server client. A programme the reader has no
 * right to is indistinguishable from one that does not exist, which is correct:
 * a 404 should not confirm that a record exists to somebody who cannot see it.
 */
export const dynamic = "force-dynamic";

export default async function ProgrammeDetailPage({
  params,
}: PageProps<"/programs/[id]">) {
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

  const detail = await getProgramme(id);
  if (!detail) notFound();

  return (
    <ProgrammeDetailContent nowIso={new Date().toISOString()} detail={detail} />
  );
}
