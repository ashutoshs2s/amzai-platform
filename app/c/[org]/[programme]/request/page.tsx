import { createAdminClient } from "@/lib/supabase/admin";

import { RequestLinkForm } from "./RequestLinkForm";

/**
 * Asking for a link to complete onboarding. DESIGN.md 6.4.
 *
 * Public, no account, no password, no sign-in — CLAUDE.md rule 5, and DESIGN.md
 * section 8 forbids even the suggestion of one on a client surface.
 *
 * The programme's name is shown, which is why it is read here. Nothing else
 * about it is, and a slug that matches nothing renders the same page: this must
 * not become a way to discover which clients Amzai has.
 */
export const dynamic = "force-dynamic";

export default async function RequestLinkPage({
  params,
}: PageProps<"/c/[org]/[programme]/request">) {
  const { org, programme } = await params;

  const db = createAdminClient();
  const { data } = await db
    .from("programs")
    .select("name, organisation:organisations ( name, slug )")
    .eq("slug", programme)
    .maybeSingle();

  const organisation = data?.organisation as unknown as
    | { name: string; slug: string }
    | null;
  const known = Boolean(data) && organisation?.slug === org;

  return (
    <RequestLinkForm
      organisationSlug={org}
      programmeSlug={programme}
      /* An unknown programme still renders, with a neutral heading. */
      programmeName={known ? (data?.name ?? null) : null}
    />
  );
}
