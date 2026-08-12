import { AccessState } from "@/components/AccessState";
import { PROGRAMME_TYPE_LABEL, listProgrammes } from "@/lib/data/programmes";
import { getSession } from "@/lib/data/session";
import { listClientTypes } from "@/lib/data/taxonomy";

import { ProgramsContent } from "./ProgramsContent";

/**
 * Programme list. DESIGN.md section 6.1.
 *
 * Reads through the authenticated server client, so row level security applies
 * with the signed-in staff member's identity. A delivery lead sees their
 * assignments and nothing else, and that is enforced by the database rather
 * than by this query remembering to filter.
 */
export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const session = await getSession();
  if (session.state !== "ok") {
    return (
      <>
        <h1 className="text-page-title font-semibold">Programs</h1>
        <div className="mt-4">
          <AccessState
            state={session.state}
            email={session.state === "no_staff_record" ? session.email : undefined}
          />
        </div>
      </>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const [programmes, clientTypes] = await Promise.all([
    listProgrammes(today),
    listClientTypes(),
  ]);

  // Filter options come from what is actually there, so a filter can never
  // offer a value that matches nothing.
  const owners = [...new Set(programmes.map((p) => p.owner))].sort();
  const types = [...new Set(programmes.map((p) => p.type))].sort().map((value) => ({
    value,
    label: PROGRAMME_TYPE_LABEL[value] ?? value,
  }));

  return (
    <ProgramsContent
      nowIso={new Date().toISOString()}
      programmes={programmes}
      owners={owners}
      types={types}
      clientTypes={clientTypes}
    />
  );
}
