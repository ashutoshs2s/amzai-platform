/**
 * Read-only diagnostic. Says whether the database has been migrated and seeded.
 *
 *   npm run check-db
 *
 * Prints row counts and account emails only. It never writes and never prints
 * a key.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log("  .env.local is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

console.log(`Project: ${new URL(url).host}\n`);
let migrated = true;
for (const t of ["users", "organisations", "programs", "onboarding_responses"]) {
  const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
  if (error) migrated = false;
  console.log(`  ${t.padEnd(22)} ${error ? "MISSING — " + error.message : count + " rows"}`);
}

const { data, error } = await db.auth.admin.listUsers({ perPage: 100 });
console.log(`  ${"auth accounts".padEnd(22)} ${error ? "ERROR — " + error.message : data.users.length}`);
if (!error) for (const u of data.users.slice(0, 8)) console.log(`      ${u.email}`);

console.log();
if (!migrated) console.log("Next step: apply the migrations (npx supabase db push).");
else if (!data?.users.length) console.log("Next step: run the seed (npm run seed).");
else console.log("Migrated and seeded. Sign in at /sign-in.");
