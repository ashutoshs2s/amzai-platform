import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Refreshes the staff session on every request and gates the internal app.
 *
 * Called from proxy.ts, Next 16's replacement for the middleware convention.
 *
 * Two jobs, and the first is easy to forget. A Supabase access token is short
 * lived; without something refreshing it on the server, a staff member who
 * leaves a tab open comes back to a session that has quietly expired, and
 * every screen reads as signed out. This runs before each request and writes
 * the refreshed cookies onto the response.
 *
 * The second is the redirect. Row level security already guarantees a signed
 * out request sees nothing, so this is not the security boundary — it is
 * navigation. Sending somebody to the sign-in screen is more use than showing
 * them an empty programme list and letting them work out why.
 */

const PUBLIC_PATHS = ["/sign-in", "/health"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser, not getSession: it revalidates the token with Supabase rather than
  // trusting whatever the cookie claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    // Come back to where they were headed once they are in.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/programs";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
