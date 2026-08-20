import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { expiryInDays, hashToken, newToken, SESSION_TTL_DAYS } from "@/lib/client/token";

/**
 * Following the link.
 *
 * Exchanges a one-time link for a session, once, inside a single database
 * function. The programme in the URL is checked against the programme the link
 * was issued for — inside that function, not here, so a route that forgot to
 * check could not be written.
 *
 * The link token arrives in the query string, which is unavoidable: it is what
 * makes a link a link. It is never stored, never logged, and the page it leads
 * to redirects immediately so the token does not sit in the address bar or in
 * the browser history of a shared machine any longer than it must.
 */
export const dynamic = "force-dynamic";

export default async function VerifyPage({
  params,
  searchParams,
}: PageProps<"/c/[org]/[programme]/verify">) {
  const { org, programme } = await params;
  const query = await searchParams;
  const token = typeof query.t === "string" ? query.t : "";

  if (!token) redirect(`/${org}/${programme}/request`);

  const db = createAdminClient();
  const { data: found } = await db
    .from("programs")
    .select("id, organisation:organisations ( slug )")
    .eq("slug", programme)
    .maybeSingle();

  const organisation = found?.organisation as unknown as { slug: string } | null;
  if (!found || organisation?.slug !== org) {
    redirect(`/${org}/${programme}/request?expired=1`);
  }

  const session = newToken();

  const { data } = await db.rpc("consume_client_link", {
    p_link_token_hash: hashToken(token),
    p_program_id: found.id,
    p_session_token_hash: session.hash,
    p_session_expires_at: expiryInDays(SESSION_TTL_DAYS),
  });

  if (!data || data.ok !== true) {
    // Used, expired, wrong programme, or never real. The visitor is told the
    // same thing in every case and offered another link.
    redirect(`/${org}/${programme}/request?expired=1`);
  }

  /*
    httpOnly so no script can read it, sameSite lax so following the emailed
    link works, secure everywhere but local development. The cookie holds the
    session token; the database holds only its hash.
  */
  const jar = await cookies();
  jar.set("amzai_client_session", session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });

  redirect(`/${org}/${programme}`);
}
