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
    A RELATIVE Location, deliberately.

    NextResponse.redirect wants an absolute URL, and building one from
    request.nextUrl.origin sent clients to the wrong host: this handler is
    reached through a rewrite, and after that rewrite the origin is the internal
    one, not the client host the browser actually asked for. A valid link
    therefore 307'd to http://localhost:3000/... where the page does not exist
    (404), and an invalid one landed on the staff sign-in screen — which should
    be unreachable from the client host at all.

    HTTP allows a relative Location and the browser resolves it against the URL
    it requested, which is the client host by definition. So there is no origin
    to get wrong, in development or in production.

    The /c prefix is absent because it is internal: the proxy rewrites onto it
    and a client never sees it.
  */
  const to = (path: string) => {
    const response = new NextResponse(null, { status: 307 });
    response.headers.set("Location", path);
    return response;
  };

  const token = request.nextUrl.searchParams.get("t");
  if (!token) return to(`/${org}/${programme}/request?link=missing`);

  const db = createAdminClient();
  const { data: found } = await db
    .from("programs")
    .select("id, organisation:organisations ( slug )")
    .eq("slug", programme)
    .maybeSingle();

  const organisation = found?.organisation as unknown as { slug: string } | null;
  if (!found || organisation?.slug !== org) {
    return to(`/${org}/${programme}/request?link=expired`);
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
    // is told the same thing in every case and offered another link: telling
    // them which would say whether the token was ever real.
    return to(`/${org}/${programme}/request?link=expired`);
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
