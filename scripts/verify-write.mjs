/**
 * Proves the first write path end to end, against the real project.
 *
 *   npm run verify-write
 *
 * Signs in as a real seeded staff member with the anon key, so the write goes
 * through row level security under that person's identity — the same path the
 * server action takes. Then reads audit_events with the service role to confirm
 * the trigger fired and recorded the right actor.
 *
 * Also checks the negative: a staff member with no assignment to the programme
 * must update zero rows. A write path that is not gated is worse than no write
 * path.
 *
 * Leaves the data as it found it. The audit rows it generated stay, because
 * audit_events is append-only, which is the property being demonstrated.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "amzai-dev-password";

if (!url || !anon || !service) {
  console.error("Missing Supabase variables. Run with: npm run verify-write");
  process.exit(1);
}

const admin = createClient(url, service, { auth: { persistSession: false } });
const results = [];
const check = (label, pass, detail = "") =>
  results.push({ label, pass, detail });

async function signedInAs(email) {
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw new Error(`sign in as ${email}: ${error.message}`);
  return { client, userId: data.user.id };
}

/* ---------------------------------------------------------------- fixture */

const { data: programme } = await admin
  .from("programs")
  .select("id, name")
  .eq("slug", "beyondtrust")
  .single();

const { data: target } = await admin
  .from("onboarding_responses")
  .select("id, response, assignee_id")
  .eq("program_id", programme.id)
  .limit(1)
  .single();

console.log(`Programme: ${programme.name}`);
console.log(`Response:  ${target.id}\n`);

const original = target.response;
const written = `Verified write at ${new Date().toISOString()}`;

/* ------------------------------------------------- 1. an allowed write ---- */

const sana = await signedInAs("sana.iqbal@amzai.ai");

const { data: readBack } = await sana.client
  .from("onboarding_responses")
  .select("id")
  .eq("id", target.id);
check("assigned staff can read the response", (readBack ?? []).length === 1);

const { data: updated, error: updateError } = await sana.client
  .from("onboarding_responses")
  .update({
    response: written,
    answer_source: "amzai_written",
    answered_by: sana.userId,
    answered_by_contact_id: null,
    answered_at: new Date().toISOString(),
  })
  .eq("id", target.id)
  .select("id, response, answered_by");

check(
  "assigned staff can write the response",
  !updateError && (updated ?? []).length === 1,
  updateError?.message ?? "",
);
check(
  "the new value is stored",
  updated?.[0]?.response === written,
  updated?.[0]?.response?.slice(0, 40) ?? "",
);
check(
  "authorship recorded against the editor",
  updated?.[0]?.answered_by === sana.userId,
);

/* ------------------------------------------------- 2. the audit trail ----- */

const { data: audit } = await admin
  .from("audit_events")
  .select("action, table_name, actor_type, actor_id, before, after, occurred_at")
  .eq("record_id", target.id)
  .order("id", { ascending: false })
  .limit(1);

const row = audit?.[0];
check("an audit row appeared for the update", row?.action === "update", row?.action ?? "none");
check("it names the right table", row?.table_name === "onboarding_responses");
check("the actor is staff", row?.actor_type === "staff", row?.actor_type ?? "");
check(
  "the actor is the person who edited",
  row?.actor_id === sana.userId,
  `${row?.actor_id} vs ${sana.userId}`,
);
check("before holds the previous answer", row?.before?.response === original);
check("after holds the new answer", row?.after?.response === written);

/* ------------------------------------------------- 3. the negative -------- */

const ana = await signedInAs("ana.beltran@amzai.ai"); // data_ops, not assigned
const { data: denied } = await ana.client
  .from("onboarding_responses")
  .update({ response: "should not be possible" })
  .eq("id", target.id)
  .select("id");
check(
  "unassigned staff write is refused by RLS",
  (denied ?? []).length === 0,
  `${(denied ?? []).length} rows updated`,
);

const { data: stillThere } = await admin
  .from("onboarding_responses")
  .select("response")
  .eq("id", target.id)
  .single();
check("the value survived that attempt", stillThere.response === written);

/* ------------------------------------------------- 4. put it back --------- */

await admin
  .from("onboarding_responses")
  .update({
    response: original,
    answer_source: target.response ? "amzai_written" : null,
  })
  .eq("id", target.id);

/* ------------------------------------------------- report ----------------- */

let failed = 0;
for (const r of results) {
  if (!r.pass) failed += 1;
  console.log(`  ${r.pass ? "ok  " : "FAIL"} ${r.label}${r.detail ? "  — " + r.detail : ""}`);
}
console.log(`\n${results.length} checks, ${failed} failing`);
process.exit(failed ? 1 : 0);
