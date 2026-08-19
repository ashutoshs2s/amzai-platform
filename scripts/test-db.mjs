/**
 * Every database suite, in one command.
 *
 *   npm run test-db
 *
 * Each runs in its own process against its own throwaway Postgres, so one
 * suite's fixtures cannot leak into another's expectations — which is how a
 * suite ends up passing because of something a different file did.
 */

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DIR = "supabase/tests";
const suites = readdirSync(DIR).filter((f) => f.endsWith(".test.mjs")).sort();

let failedSuites = 0;

for (const suite of suites) {
  const run = spawnSync("node", [`${DIR}/${suite}`], { encoding: "utf8" });
  process.stdout.write(run.stdout ?? "");
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) failedSuites += 1;
}

console.log(
  failedSuites === 0
    ? `  ${suites.length} suites passed.\n`
    : `  ${failedSuites} of ${suites.length} suites FAILED.\n`,
);
process.exit(failedSuites ? 1 : 0);
