import { redirect } from "next/navigation";

import { loadClientView } from "@/lib/client/onboarding";

import { OnboardingForm } from "./OnboardingForm";

/**
 * The client's onboarding. DESIGN.md 6.4.
 *
 * Where a valid link lands. No account, no password, no navigation anywhere
 * else: everything on this page belongs to the one programme the session was
 * issued for, and there is no link off it.
 *
 * A session that has expired or was issued for another programme lands back on
 * the request page, told the same thing in either case.
 */
export const dynamic = "force-dynamic";

export default async function ClientOnboardingPage({
  params,
}: PageProps<"/c/[org]/[programme]">) {
  const { org, programme } = await params;

  const view = await loadClientView(org, programme);
  if (!view) redirect(`/${org}/${programme}/request?link=expired`);

  return <OnboardingForm organisationSlug={org} programmeSlug={programme} view={view} />;
}
