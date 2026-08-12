import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { awaitingFor, listProgrammes } from "@/lib/data/programmes";
import { getSession } from "@/lib/data/session";
import { isAdminOrAbove } from "@/lib/tiers";

/**
 * Every module screen renders inside the shell. DESIGN.md section 4.
 *
 * One implementation, used by each module's layout, so the rail, the top bar
 * and the awaiting-me count cannot drift apart between modules.
 *
 * The shell's own reads — the awaiting-me count and the search index — go
 * through the same authenticated client as the screens, so a delivery lead's
 * search cannot surface a programme their list would not show them.
 *
 * /styleguide is deliberately outside the shell: it is a component reference,
 * not a module, and reviewing components is easier without a rail and a top
 * bar around them.
 */
export async function ModuleLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const today = new Date().toISOString().slice(0, 10);

  const [awaiting, programmes] =
    session.state === "ok"
      ? await Promise.all([
          awaitingFor(session.staff.id, today),
          listProgrammes(today),
        ])
      : [{ count: 0, overdue: 0, dueSoon: 0 }, []];

  return (
    <AppShell
      awaiting={awaiting}
      staffName={session.state === "ok" ? session.staff.fullName : undefined}
      showAdmin={session.state === "ok" && isAdminOrAbove(session.staff.tier)}
      searchIndex={programmes.map((p) => ({
        id: p.id,
        name: p.name,
        owner: p.owner,
        typeLabel: p.typeLabel,
        clientTypeLabel: p.clientTypeLabel,
        subSegmentLabel: p.subSegmentLabel,
        category: p.category,
      }))}
    >
      {children}
    </AppShell>
  );
}
