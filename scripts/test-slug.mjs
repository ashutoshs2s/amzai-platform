/**
 * Slugs. npm run test-slug
 *
 * Small, but worth pinning: a slug goes into a URL an operator may share, and
 * both tables reject one that does not match their format constraint. A name
 * that silently produced an invalid slug would fail at the database with a
 * message nobody can act on.
 */

import { isValidSlug, slugify, uniqueSlug } from "../lib/slug.ts";

const results = [];
const is = (name, actual, expected) =>
  results.push({
    name,
    pass: actual === expected,
    detail: `got "${actual}", wanted "${expected}"`,
  });

is("plain name", slugify("BeyondTrust"), "beyondtrust");
is("spaces become hyphens", slugify("Revenue Tech Summit Series"), "revenue-tech-summit-series");
is("punctuation goes", slugify("Smith & Co., LLP"), "smith-co-llp");
is("accents fold", slugify("Zürich Übergroup"), "zurich-ubergroup");
is("no leading or trailing hyphen", slugify("  --Acme--  "), "acme");
is("runs of separators collapse", slugify("A / B // C"), "a-b-c");
is("digits survive", slugify("Q4 2026 Summit"), "q4-2026-summit");
is("an ampersand alone yields nothing", slugify("&&&"), "");
is("long names are cut without a trailing hyphen",
  slugify("A".repeat(40) + " " + "B".repeat(40)).length <= 60, true);
is("and the cut leaves a valid slug",
  isValidSlug(slugify("A".repeat(40) + " " + "B".repeat(40))), true);

for (const name of ["BeyondTrust", "Smith & Co., LLP", "Q4 2026 Summit", "Zürich"]) {
  is(`"${name}" passes the database constraint`, isValidSlug(slugify(name)), true);
}

is("an empty slug is not valid", isValidSlug(""), false);
is("a trailing hyphen is not valid", isValidSlug("acme-"), false);
is("uppercase is not valid", isValidSlug("Acme"), false);

is("unique leaves a free slug alone", uniqueSlug("summit", []), "summit");
is("and steps past a taken one", uniqueSlug("summit", ["summit"]), "summit-2");
is("and past several", uniqueSlug("summit", ["summit", "summit-2", "summit-3"]), "summit-4");
is("the stepped slug is still valid", isValidSlug(uniqueSlug("summit", ["summit"])), true);

console.log("\n  Slugs\n  " + "-".repeat(60));
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : "\n        " + r.detail}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n  ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
