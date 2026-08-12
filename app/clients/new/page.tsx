import Link from "next/link";

import { AccessState } from "@/components/AccessState";
import { listClientTypes } from "@/lib/data/taxonomy";
import { getSession } from "@/lib/data/session";
import { isAdminOrAbove } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";

import { NewClientForm } from "./NewClientForm";

/**
 * New client. SPEC.md section 4, in the order that section gives.
 *
 * Admin only. It writes the organisation, the programme, its team and its
 * situational module choices in one transaction, then hands off to the
 * generation preview. It does not generate: that is a separate step with its
 * own preview, per SPEC.md 4.1a.
 */
export const dynamic = "force-dynamic";

export default async function NewClientPage() {
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
        <h1 className="text-page-title font-semibold text-ink">New client</h1>
        <p className="mt-3 text-body text-slate">
          Only an admin can create a client. Ask one of them to set it up.
        </p>
        <Link href="/programs" className="mt-4 inline-block text-body text-accent hover:underline">
          Back to programs
        </Link>
      </div>
    );
  }

  const supabase = await createClient();

  const [clientTypes, { data: staff }, { data: modules }] = await Promise.all([
    listClientTypes(),
    supabase
      .from("users")
      .select("id, full_name, tier")
      .eq("active", true)
      .order("full_name"),
    /*
      The modules on offer come from the same rows generation resolves against,
      so one can never be offered here and then refused at generation. Only the
      newest version of each matters, and the form only needs its slug.
    */
    supabase
      .from("onboarding_templates")
      .select("slug, name, version, client_type_id")
      .eq("kind", "situational")
      .eq("active", true)
      .order("version", { ascending: false }),
  ]);

  const newestModules = new Map<string, { slug: string; name: string; clientTypeId: string | null }>();
  for (const m of modules ?? []) {
    if (!newestModules.has(m.slug)) {
      newestModules.set(m.slug, {
        slug: m.slug,
        name: m.name,
        clientTypeId: m.client_type_id,
      });
    }
  }

  return (
    <NewClientForm
      clientTypes={clientTypes}
      staff={(staff ?? []).map((s) => ({
        id: s.id,
        name: s.full_name,
        role: s.tier,
      }))}
      modules={[...newestModules.values()]}
    />
  );
}
