import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { expiryInDays, hashToken, newToken, SESSION_TTL_DAYS } from "@/lib/client/token";

/**
 * Following the link.
 *
 * A Route Handler, not a page, and that is a Next.js rule rather than a
 * preference: a page component may READ cookies but may not set one. This has
 * to set the session cookie, so it cannot be a page. It failed at runtime as a
 * page with "Cookies can only be modified in a Server Action or Route Handler",
 * which is the kind of rule no database test can see.
 *
 * Everything else is as it was:
 *
 *   The exchange happens inside one database function, so consuming the link
 *   and issuing the session either both happen or neither does, and the actor
 *   is set inside that same transaction so the audit row names the contact.
 *
 *   The programme in the URL is checked against the programme the link was
 *   issued for — inside the function, so a handler that forgot could not be
 *   written. CLAUDE.md: a route that trusts the slug rather than the token is
 *   a data breach.
 *
 *   The response is a redirect, so the token does not stay in the address bar
 *   or become the page a shared machine's history remembers.
 *
 *   The cookie is httpOnly, so no script can read it, and holds the session
 *   token while the database holds only its hash.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/c/[org]/[programme]/verify">,
) {
  const { org, programme } = await context.params;

  /*
    Built from the request's own origin, so the redirect stays on the host the
    client arrived at. The /c prefix is absent because that prefix is internal:
    the proxy rewrites onto it and the client never sees it.
  */
  const to = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin));

  const token = request.nextUrl.searchParams.get("t");
  if (!token) return to(`/${org}/${programme}/request`);

  const db = createAdminClient();
  const { data: found } = await db
    .from("programs")
    .select("id, organisation:organisations ( slug )")
    .eq("slug", programme)
    .maybeSingle();

  const organisation = found?.organisation as unknown as { slug: string } | null;
  if (!found || organisation?.slug !== org) {
    return to(`/${org}/${programme}/request?expired=1`);
  }

  const session = newToken();

  const { data } = await db.rpc("consume_client_link", {
    p_link_token_hash: hashToken(token),
    p_program_id: found.id,
    p_session_token_hash: session.hash,
    p_session_expires_at: expiryInDays(SESSION_TTL_DAYS),
  });

  if (!data || data.ok !== true) {
    // Used, expired, issued for another programme, or never real. The visitor
    // is told the same thing in every case and offered another link.
    return to(`/${org}/${programme}/request?expired=1`);
  }

  const response = to(`/${org}/${programme}`);

  response.cookies.set("amzai_client_session", session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });

  return response;
}
