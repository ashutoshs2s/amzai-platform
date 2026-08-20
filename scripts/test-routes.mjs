/**
 * Route-shape rules, checked statically. npm run test-routes
 *
 * READ THIS BEFORE TRUSTING IT.
 *
 * These do NOT prove the app runs. Next.js runtime rules — what a page may do,
 * what a Route Handler may do — are enforced by Next at request time, and the
 * only thing that proves compliance is loading the page. The failure that
 * prompted this file, "Cookies can only be modified in a Server Action or Route
 * Handler", compiled, typechecked and linted cleanly and then failed the first
 * time a client followed a link.
 *
 * What these DO is stop that exact mistake being made again, by asserting the
 * shape the fix depends on. A static check cannot tell you the rule is
 * satisfied; it can tell you the code has drifted back to the shape that
 * violated it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass, detail });

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const files = walk("app");
const read = (path) => readFileSync(path, "utf8");

/* -------------------------------------------------------------------------- */
/* A page may read a cookie. Only a Route Handler or an action may set one.    */
/* -------------------------------------------------------------------------- */

const setsACookie = (source) =>
  /cookies\(\)[\s\S]{0,40}\.set\(/.test(source) ||
  /\bjar\.set\(/.test(source) ||
  /\bcookieStore\.set\(/.test(source);

const offenders = files
  .filter((path) => path.endsWith("page.tsx") || path.endsWith("layout.tsx"))
  .filter((path) => setsACookie(read(path)));

check(
  "no page or layout sets a cookie, which Next refuses at runtime",
  offenders.length === 0,
  offenders.join(", "),
);

/* -------------------------------------------------------------------------- */
/* The verify endpoint is a Route Handler, because it must set one             */
/* -------------------------------------------------------------------------- */

const verifyRoute = "app/c/[org]/[programme]/verify/route.ts";
const verifyPage = "app/c/[org]/[programme]/verify/page.tsx";

check("verify is a Route Handler", files.includes(verifyRoute));
check("and not a page, which cannot set the session cookie", !files.includes(verifyPage));

if (files.includes(verifyRoute)) {
  const source = read(verifyRoute);

  check("it responds to GET, because a link in an email is a GET",
    /export async function GET\(/.test(source));

  /*
    The cookie's flags, asserted by reading them. Crude, and it proves only that
    the words are present rather than that the browser honoured them — but the
    failure it guards against is somebody deleting httpOnly while refactoring,
    and that it does catch.
  */
  check("the session cookie is httpOnly, so no script can read it",
    /httpOnly:\s*true/.test(source));
  check("and sameSite lax, so following the emailed link works",
    /sameSite:\s*"lax"/.test(source));
  check("and secure in production",
    /secure:\s*process\.env\.NODE_ENV === "production"/.test(source));

  check("it redirects rather than rendering, so the token leaves the address bar",
    /NextResponse\.redirect\(/.test(source));

  check("the exchange is one database call, not several",
    (source.match(/\.rpc\(/g) ?? []).length === 1 &&
      /consume_client_link/.test(source));

  check("the plaintext token is hashed before it is sent to the database",
    /hashToken\(token\)/.test(source) && !/p_link_token_hash:\s*token\b/.test(source));
}

/* -------------------------------------------------------------------------- */
/* Client surfaces stay on the client side of the split                        */
/* -------------------------------------------------------------------------- */

const clientSurfaces = files.filter((path) => path.startsWith("app/c/"));
check("there are client surfaces to check", clientSurfaces.length > 0);

const leaks = clientSurfaces.filter((path) => {
  const source = read(path);
  // The authenticated server client belongs to staff screens; a client surface
  // has no Supabase identity and must go through the service role and a token.
  return /from "@\/lib\/supabase\/server"/.test(source);
});
check("no client surface uses the staff-authenticated database client",
  leaks.length === 0, leaks.join(", "));

/*
  Narrowed on purpose. The first version of this searched for the words "sign
  in" and "password" and failed on the request page, whose copy says "There is
  no password and no account to create" — prose denying the thing, which is
  precisely what DESIGN.md 8 asks for. A pattern cannot tell that from a page
  offering one, so it checks the affordance instead of the vocabulary: a
  password input is unambiguous, a sentence is not.
*/
const passwordFields = clientSurfaces.filter((path) =>
  /type=["']password["']/.test(read(path)),
);
check("no client surface has a password field, per DESIGN.md 8",
  passwordFields.length === 0, passwordFields.join(", "));

const authImports = clientSurfaces.filter((path) =>
  /supabase\.auth|signInWithPassword|createBrowserClient/.test(read(path)),
);
check("and none reaches for Supabase Auth, per CLAUDE.md rule 5",
  authImports.length === 0, authImports.join(", "));

console.log("\n  Route shape\n  " + "-".repeat(64));
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : "\n        " + r.detail}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n  ${results.length - failed}/${results.length} passed`);
console.log("  These assert shape, not behaviour. Only loading the page proves the runtime rule.\n");
process.exit(failed ? 1 : 0);
