/**
 * Runs test_privilege_tiers.sql the way you would in the Supabase SQL editor.
 *
 * That file is the one you run against the real database, so it has to keep
 * working. Running it here as well means a policy change breaks it on this
 * machine rather than the first time somebody pastes it into production.
 *
 * It impersonates through the JWT claim rather than the plain setting, which is
 * why the harness's auth.uid() reads both.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { freshDatabase } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const db = await freshDatabase();

// The suite needs a super admin, an audience row to read, and nothing else.
await db.exec(`insert into public.companies (name) values ('Acme')`);
await db.exec(`insert into public.contacts (email) values ('x@acme.test')`);

const sql = readFileSync(join(HERE, "test_privilege_tiers.sql"), "utf8");

console.log("\n  test_privilege_tiers.sql\n  " + "-".repeat(66));

let results;
try {
  const output = await db.exec(sql);
  results = output[output.length - 1].rows;
} catch (error) {
  console.log(`  THE SUITE ITSELF FAILED TO RUN\n        ${error.message}\n`);
  process.exit(1);
}

let failed = 0;
for (const row of results) {
  if (row.result === "PASS") continue;
  failed += 1;
  console.log(`  FAIL  [${row.area}] ${row.scenario}`);
  console.log(`        expected ${row.expected}, got ${row.actual}`);
}
console.log(`\n  ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
