import Link from "next/link";

import { AccessState } from "@/components/AccessState";
import {
  listClientsForAdmin,
  listOrganisationsForAdmin,
  listPrivilegeChanges,
  listStaff,
  listStaffFunctions,
} from "@/lib/data/admin";
import { getSession } from "@/lib/data/session";
import { isAdminOrAbove } from "@/lib/tiers";

import { AdminContent } from "./AdminContent";
import { ClientsSection } from "./ClientsSection";
import { PrivilegeTrail } from "./PrivilegeTrail";

/**
 * Staff and privileges.
 *
 * Admin and above. The tier rules are applied here and in the database, which
 * is the one that counts: the super admin row is shown but inert, no control
 * anywhere offers the super admin tier, and nobody can raise somebody to their
 * own level or above.
 */
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (session.state !== "ok") {
    return (
      <AccessState
        state={session.state}
        email={session.state === "no_staff_record" ? session.email : undefined}
      />
    );
  }

  if (!isAdminOrAbove(session.staff.tier)) {
    return (
      <div className="max-w-[720px]">
        <h1 className="text-page-title font-semibold text-ink">Staff</h1>
        <p className="mt-3 text-body text-slate">
          Only an admin can manage staff and privileges.
        </p>
        <Link href="/programs" className="mt-4 inline-block text-body text-accent hover:underline">
          Back to programs
        </Link>
      </div>
    );
  }

  const [staff, functions, organisations, changes, clients] = await Promise.all([
    listStaff(),
    listStaffFunctions(),
    listOrganisationsForAdmin(),
    listPrivilegeChanges(),
    listClientsForAdmin(),
  ]);

  return (
    <>
      <AdminContent
        actorTier={session.staff.tier}
        actorId={session.staff.id}
        staff={staff}
        functions={functions}
        organisations={organisations}
      />
      <ClientsSection clients={clients} />
      <PrivilegeTrail changes={changes} />
    </>
  );
}
