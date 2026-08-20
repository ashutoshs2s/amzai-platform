import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/client/token";

/**
 * Where a verified client lands.
 *
 * A placeholder for the onboarding form, which is the next piece. What it does
 * do already is the part that matters: it proves the session, scoped to this
 * programme, through the same database function every later client write will
 * use. No session, or a session for another programme, and there is nothing
 * here to see.
 */
export const dynamic = "force-dynamic";

export default async function ClientHomePage({
  params,
}: PageProps<"/c/[org]/[programme]">) {
  const { org, programme } = await params;

  const jar = await cookies();
  const token = jar.get("amzai_client_session")?.value;
  if (!token) redirect(`/${org}/${programme}/request`);

  const db = createAdminClient();
  const { data: found } = await db
    .from("programs")
    .select("id, name, organisation:organisations ( name, slug )")
    .eq("slug", programme)
    .maybeSingle();

  const organisation = found?.organisation as unknown as
    | { name: string; slug: string }
    | null;
  if (!found || organisation?.slug !== org) redirect(`/${org}/${programme}/request`);

  const { data: contactId } = await db.rpc("client_session_contact", {
    p_session_token_hash: hashToken(token),
    p_program_id: found.id,
  });

  if (!contactId) redirect(`/${org}/${programme}/request?expired=1`);

  const { data: contact } = await db
    .from("client_contacts")
    .select("name")
    .eq("id", contactId)
    .maybeSingle();

  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-12">
      <span className="text-body font-semibold tracking-[0.04em] text-ink">AMZAI</span>
      <h1 className="mt-6 text-page-title font-semibold text-ink">{found.name}</h1>
      <p className="mt-1 text-body text-slate">{organisation?.name}</p>

      <div className="mt-6 rounded-base border border-line bg-surface p-4">
        <p className="text-body text-ink">
          You are signed in as {contact?.name ?? "a named contact"}.
        </p>
        <p className="mt-2 text-body text-slate">
          The onboarding questions appear here. That screen is the next thing to be built;
          the link, the session and the programme check that got you here are done.
        </p>
      </div>
    </main>
  );
}
