/**
 * Seed two real programmes and everything behind them.
 *
 *   node --env-file=.env.local scripts/seed.mjs
 *
 * Uses the service role key, so it bypasses row level security. That is
 * correct for a seed and wrong for anything else: this file is run by hand
 * from a terminal, never imported by the app. CLAUDE.md hard rule 2.
 *
 * Safe to run twice. Every insert is keyed on something stable — a slug, an
 * email, a template name — and upserts rather than duplicating.
 *
 * It also creates Supabase Auth users so somebody can actually sign in and see
 * the data, since every screen reads through the authenticated client.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run with:  node --env-file=.env.local scripts/seed.mjs",
  );
  process.exit(1);
}

const db = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Password for every seeded account. Development only. */
const SEED_PASSWORD = "amzai-dev-password";

const STAFF = [
  { email: "priya.raman@amzai.ai", full_name: "Priya Raman", role: "admin" },
  { email: "daniel.okoro@amzai.ai", full_name: "Daniel Okoro", role: "engagement_lead" },
  { email: "sana.iqbal@amzai.ai", full_name: "Sana Iqbal", role: "delivery_lead" },
  { email: "tom.whitfield@amzai.ai", full_name: "Tom Whitfield", role: "specialist" },
  { email: "ana.beltran@amzai.ai", full_name: "Ana Beltrán", role: "data_ops" },
];

function fail(step, error) {
  if (!error) return;
  console.error(`\n✗ ${step}\n  ${error.message ?? error}`);
  process.exit(1);
}

async function upsert(table, rows, onConflict) {
  const { data, error } = await db
    .from(table)
    .upsert(rows, { onConflict, ignoreDuplicates: false })
    .select();
  fail(`upsert ${table}`, error);
  return data;
}

/* -------------------------------------------------------------------------- */
/* 1. Staff, in Supabase Auth and in public.users                             */
/* -------------------------------------------------------------------------- */

console.log("Staff");
const staffIds = {};

// One page is plenty at this size; the seed is not a migration tool.
const { data: existingAuth, error: listError } = await db.auth.admin.listUsers({
  perPage: 200,
});
fail("list auth users", listError);

for (const person of STAFF) {
  const found = existingAuth.users.find((u) => u.email === person.email);
  let id = found?.id;

  if (!id) {
    const { data, error } = await db.auth.admin.createUser({
      email: person.email,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    fail(`create auth user ${person.email}`, error);
    id = data.user.id;
    console.log(`  created  ${person.email}`);
  } else {
    console.log(`  exists   ${person.email}`);
  }

  staffIds[person.email] = id;
}

// public.users.id must equal the auth user id: every policy resolves the role
// by looking this row up from auth.uid().
await upsert(
  "users",
  STAFF.map((person) => ({
    id: staffIds[person.email],
    full_name: person.full_name,
    email: person.email,
    role: person.role,
    active: true,
  })),
  "id",
);

/* -------------------------------------------------------------------------- */
/* 2. Organisations                                                           */
/* -------------------------------------------------------------------------- */

console.log("Organisations");
const orgs = await upsert(
  "organisations",
  [
    {
      name: "BeyondTrust",
      slug: "beyondtrust",
      vertical: "b2b_tech",
      sub_vertical: "identity_access",
      status: "active",
    },
    {
      name: "Revenue Tech Media",
      slug: "revenue-tech-media",
      vertical: "conference_organizers",
      sub_vertical: "b2b_media",
      status: "active",
    },
  ],
  "slug",
);
const orgId = Object.fromEntries(orgs.map((o) => [o.slug, o.id]));
for (const o of orgs) console.log(`  ${o.name}`);

/* -------------------------------------------------------------------------- */
/* 3. Onboarding template                                                     */
/* -------------------------------------------------------------------------- */

console.log("Template");
// No unique constraint on the template name, so upsert has nothing to conflict
// on. Select first, insert only if absent. Adding a constraint to the schema
// purely to make seeding convenient would be the tail wagging the dog.
const { data: found, error: findError } = await db
  .from("onboarding_templates")
  .select("id, name, version")
  .eq("name", "B2B Tech event")
  .eq("version", 1)
  .maybeSingle();
fail("find template", findError);

let template = found;
if (!template) {
  const { data, error } = await db
    .from("onboarding_templates")
    .insert({
      name: "B2B Tech event",
      program_type: "event",
      vertical: "b2b_tech",
      sub_vertical: null,
      version: 1,
      active: true,
    })
    .select()
    .single();
  fail("insert template", error);
  template = data;
}
console.log(`  ${template.name} v${template.version}`);

const FIELDS = [
  {
    section: "Audience",
    sort_order: 1,
    question: "Which job titles should we target?",
    guidance: "Seniority matters more than headcount. Be specific.",
    default_owner: "client",
    default_assignee_role: "delivery_lead",
    default_offset_type: "days_before_milestone",
    default_offset_value: 70,
    blocking: true,
  },
  {
    section: "Audience",
    sort_order: 2,
    question: "Which companies are off limits?",
    guidance: "Existing customers, live opportunities, competitors.",
    default_owner: "client",
    default_assignee_role: "delivery_lead",
    default_offset_type: "days_before_milestone",
    default_offset_value: 63,
    blocking: true,
  },
  {
    section: "Audience",
    sort_order: 3,
    question: "Minimum company size?",
    guidance: null,
    default_owner: "client",
    default_assignee_role: null,
    default_offset_type: "days_before_milestone",
    default_offset_value: 63,
    blocking: false,
  },
  {
    section: "Content",
    sort_order: 1,
    question: "Who is speaking, and what is their title?",
    guidance: "Full name and title as they should appear on the invitation.",
    default_owner: "amzai",
    default_assignee_role: "specialist",
    default_offset_type: "days_before_milestone",
    default_offset_value: 49,
    blocking: false,
  },
  {
    section: "Content",
    sort_order: 2,
    question: "Approved copy for the invitation email",
    guidance: null,
    default_owner: "client",
    default_assignee_role: "specialist",
    default_offset_type: "days_before_milestone",
    default_offset_value: 42,
    blocking: true,
  },
  {
    section: "Logistics",
    sort_order: 1,
    question: "Final attendee list",
    guidance: "Names, titles and dietary requirements.",
    default_owner: "client",
    default_assignee_role: "delivery_lead",
    default_offset_type: "days_before_milestone",
    default_offset_value: 7,
    blocking: true,
  },
  {
    section: "Logistics",
    sort_order: 2,
    question: "Venue and room set-up",
    guidance: null,
    default_owner: "amzai",
    default_assignee_role: "specialist",
    default_offset_type: "days_before_milestone",
    default_offset_value: 35,
    blocking: false,
  },
];

// Clear and rewrite the field set, so re-running does not accumulate copies.
fail(
  "clear template fields",
  (await db.from("onboarding_template_fields").delete().eq("template_id", template.id))
    .error,
);
const { data: fields, error: fieldsError } = await db
  .from("onboarding_template_fields")
  .insert(FIELDS.map((f) => ({ ...f, template_id: template.id })))
  .select();
fail("insert template fields", fieldsError);
console.log(`  ${fields.length} fields`);

/* -------------------------------------------------------------------------- */
/* 4. Programmes                                                              */
/* -------------------------------------------------------------------------- */

console.log("Programmes");
const programmes = await upsert(
  "programs",
  [
    {
      organisation_id: orgId.beyondtrust,
      name: "BeyondTrust",
      slug: "beyondtrust",
      type: "event",
      status: "active",
      currency: "GBP",
      fixed_milestone_date: "2026-11-30",
      onboarding_template_id: template.id,
      approver_name: "Rachel Okonjo",
      approver_email: "rachel.okonjo@beyondtrust.example",
      engagement_lead_id: staffIds["daniel.okoro@amzai.ai"],
      delivery_lead_id: staffIds["sana.iqbal@amzai.ai"],
    },
    {
      organisation_id: orgId["revenue-tech-media"],
      name: "Revenue Tech Summit Series",
      slug: "revenue-tech-summit-series",
      type: "retainer",
      status: "active",
      currency: "GBP",
      start_date: "2026-08-17",
      // The brief gives a milestone of 15 November. A retainer counts in
      // engagement weeks, which needs an end date, so the engagement is set to
      // run to the same date: 17 Aug to 15 Nov is 12 whole weeks.
      end_date: "2026-11-15",
      fixed_milestone_date: "2026-11-15",
      gate_date: "2026-10-19",
      approver_name: "Helena Vaughan",
      approver_email: "helena.vaughan@revenuetech.example",
      engagement_lead_id: staffIds["daniel.okoro@amzai.ai"],
      delivery_lead_id: staffIds["tom.whitfield@amzai.ai"],
    },
  ],
  "organisation_id,slug",
);
const programmeId = Object.fromEntries(programmes.map((p) => [p.slug, p.id]));
for (const p of programmes) console.log(`  ${p.name}`);

/* -------------------------------------------------------------------------- */
/* 5. Assignments                                                             */
/* -------------------------------------------------------------------------- */

console.log("Assignments");
await upsert(
  "program_assignments",
  [
    {
      program_id: programmeId.beyondtrust,
      user_id: staffIds["sana.iqbal@amzai.ai"],
      role_on_program: "delivery_lead",
      allocation_percent: 40,
    },
    {
      program_id: programmeId.beyondtrust,
      user_id: staffIds["tom.whitfield@amzai.ai"],
      role_on_program: "specialist",
      allocation_percent: 25,
    },
    {
      program_id: programmeId["revenue-tech-summit-series"],
      user_id: staffIds["tom.whitfield@amzai.ai"],
      role_on_program: "delivery_lead",
      allocation_percent: 30,
    },
    {
      program_id: programmeId["revenue-tech-summit-series"],
      user_id: staffIds["ana.beltran@amzai.ai"],
      role_on_program: "data_ops",
      allocation_percent: 15,
    },
  ],
  "program_id,user_id,role_on_program",
);
console.log("  4 assignments");

/* -------------------------------------------------------------------------- */
/* 6. Onboarding for BeyondTrust                                              */
/*                                                                            */
/* Generated the way the app will generate it. SPEC.md section 4.3: each       */
/* response takes its assignee from whoever holds the field's role on the      */
/* programme; client-owned and unroled fields get nobody.                      */
/* -------------------------------------------------------------------------- */

console.log("Onboarding");
const roleHolder = {
  delivery_lead: staffIds["sana.iqbal@amzai.ai"],
  specialist: staffIds["tom.whitfield@amzai.ai"],
};

function dueDate(field) {
  // days_before_milestone, counted back from 30 November 2026. SPEC.md 7.1.
  const milestone = new Date(Date.UTC(2026, 10, 30));
  milestone.setUTCDate(milestone.getUTCDate() - field.default_offset_value);
  return milestone.toISOString().slice(0, 10);
}

const ANSWERS = {
  "Which job titles should we target?": {
    status: "approved",
    response:
      "CISO, Head of Identity, IAM Architect. Financial services and insurance only.",
  },
  "Which companies are off limits?": {
    status: "approved",
    response: "Suppression list received. 212 domains.",
  },
  "Who is speaking, and what is their title?": {
    status: "in_progress",
    response: "Shortlist of three. Awaiting confirmation from the client.",
  },
  "Approved copy for the invitation email": { status: "blocked", response: "" },
};

const responses = fields.map((field) => {
  const answer = ANSWERS[field.question];
  const assignee =
    field.default_owner === "client" || !field.default_assignee_role
      ? null
      : (roleHolder[field.default_assignee_role] ?? null);

  return {
    program_id: programmeId.beyondtrust,
    template_field_id: field.id,
    response: answer?.response ?? "",
    owner: field.default_owner,
    assignee_id: assignee,
    due_date: dueDate(field),
    status: answer?.status ?? "not_started",
    blocking: field.blocking,
    answer_source: answer?.response ? "amzai_written" : null,
    answered_by: answer?.response ? staffIds["sana.iqbal@amzai.ai"] : null,
    answered_at: answer?.response ? new Date().toISOString() : null,
    tasks_generated: false,
  };
});

await upsert("onboarding_responses", responses, "program_id,template_field_id");
console.log(`  ${responses.length} responses for BeyondTrust`);
console.log(
  "  Revenue Tech Summit Series left ungenerated, so the generate gate is visible",
);

/* -------------------------------------------------------------------------- */

console.log("\nDone.\n");
console.log("Sign in with any of these once staff sign-in exists:");
for (const person of STAFF) {
  console.log(`  ${person.email.padEnd(28)} ${person.role}`);
}
console.log(`\nPassword for all of them: ${SEED_PASSWORD}`);
