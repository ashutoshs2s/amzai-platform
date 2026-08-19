/**
 * Committing a generation, and what freezing means afterwards.
 *
 * SPEC.md 4.1a and 4.2. The decision about WHICH questions is made in
 * lib/generation/resolve.ts and tested by `npm run test-generation`; this is
 * about the write: that it is one transaction, that it refuses what it should,
 * and that a later import cannot reach back into a programme already generated.
 */

import { asUser, freshDatabase, one, rows, suite } from "./harness.mjs";

const t = suite("Generation");
const db = await freshDatabase();

const admin = (await one(db, `select id from public.users where tier = 'super_admin'`)).id;
const leadOne = (
  await one(db, `insert into public.users (id, email, full_name, tier)
                 values (gen_random_uuid(),'one@amzai.test','One','user') returning id`)
).id;
const leadTwo = (
  await one(db, `insert into public.users (id, email, full_name, tier)
                 values (gen_random_uuid(),'two@amzai.test','Two','user') returning id`)
).id;

const b2b = (await one(db, `select id from public.client_types where slug = 'b2b_tech'`)).id;
const org = (
  await one(db, `insert into public.organisations (name, slug, client_type_id)
                 values ('Acme','acme','${b2b}') returning id`)
).id;
const programme = (
  await one(db, `insert into public.programs (organisation_id, name, slug, type, start_date)
                 values ('${org}','P','p','event','2026-09-01') returning id`)
).id;

const template = (
  await one(db, `insert into public.onboarding_templates (name, slug, kind, version)
                 values ('Core','core','core',1) returning id`)
).id;
const fields = await rows(
  db,
  `insert into public.onboarding_template_fields
     (template_id, section, sort_order, question, default_owner, default_offset_type, default_offset_value)
   values ('${template}','S',1,'Q one','client','weeks_from_start',2),
          ('${template}','S',2,'Q two','amzai','weeks_from_start',3)
   returning id`,
);

const responses = JSON.stringify(
  fields.map((f, i) => ({
    template_field_id: f.id,
    owner: i === 0 ? "client" : "amzai",
    assignee_id: i === 0 ? null : leadOne,
    due_date: "2026-09-15",
    blocking: false,
    is_generic: false,
  })),
);
const sources = JSON.stringify([{ template_id: template, role: "core" }]);

const commit = (r = responses, s = sources, res = "[]", modules = "'{}'") =>
  `select public.commit_onboarding_generation(
     '${programme}','amzai',${modules},'${r}'::jsonb,'${s}'::jsonb,'${res}'::jsonb)`;

const responseCount = async () =>
  (await one(db, `select count(*)::int as n from public.onboarding_responses
                  where program_id = '${programme}'`)).n;

/* -------------------------------------------------------------------------- */
/* Blocked until the team is assigned. SPEC.md 4.2                            */
/* -------------------------------------------------------------------------- */

await t.refuses("refused with no team assignment", db, null, commit(), "Assign at least one person");
t.check("and nothing was written", (await responseCount()) === 0);

await db.exec(`insert into public.program_assignments (program_id, user_id, role_on_program)
               values ('${programme}','${leadOne}','delivery_lead')`);

/* -------------------------------------------------------------------------- */
/* All of it or none of it                                                    */
/* -------------------------------------------------------------------------- */

const withOneBadRow = JSON.stringify([
  { template_field_id: fields[0].id, owner: "client", assignee_id: null,
    due_date: "2026-09-15", blocking: false, is_generic: false },
  { template_field_id: "00000000-0000-0000-0000-000000000000", owner: "amzai", assignee_id: null,
    due_date: null, blocking: false, is_generic: false },
]);

await t.refuses("a bad field id is refused", db, null, commit(withOneBadRow));
t.check("and the good row in the same call was rolled back with it",
  (await responseCount()) === 0);
t.check("and the programme is still ungenerated",
  (await one(db, `select onboarding_generated_at from public.programs where id = '${programme}'`))
    .onboarding_generated_at === null);

await t.refuses("generating nothing is refused", db, null, commit("[]"), "no questions at all");

/* -------------------------------------------------------------------------- */
/* The real thing                                                             */
/* -------------------------------------------------------------------------- */

await db.exec(`set test.actor = '${admin}'`);
const written = (
  await one(db, commit(responses, sources,
    JSON.stringify([{ role_on_program: "delivery_lead", user_id: leadTwo }])))
).commit_onboarding_generation;

t.check("it reports what it wrote", written === 2, `got ${written}`);
t.check("the responses landed", (await responseCount()) === 2);
t.check("the provenance landed",
  (await one(db, `select role from public.program_onboarding_sources
                  where program_id = '${programme}'`)).role === "core");
t.check("the fill mode is recorded",
  (await one(db, `select onboarding_fill_mode from public.programs where id = '${programme}'`))
    .onboarding_fill_mode === "amzai");
t.check("and generated_at is set",
  (await one(db, `select onboarding_generated_at from public.programs where id = '${programme}'`))
    .onboarding_generated_at !== null);

const resolution = await one(
  db, `select user_id, resolved_by from public.program_role_resolutions
       where program_id = '${programme}'`);
t.check("the role choice was recorded", resolution?.user_id === leadTwo);
t.check("against the person who made it", resolution?.resolved_by === admin);
t.check("every response is audited",
  (await one(db, `select count(*)::int as n from public.audit_events
                  where table_name = 'onboarding_responses'`)).n === 2);

/* -------------------------------------------------------------------------- */
/* Frozen                                                                     */
/* -------------------------------------------------------------------------- */

await t.refuses("a second generation is refused", db, null, commit(), "already generated");
t.check("still exactly the first set", (await responseCount()) === 2);

// A later import writes a new version and cannot reach back.
await db.exec(`insert into public.onboarding_templates (name, slug, kind, version)
               values ('Core','core','core',2)`);
t.check("the live programme still points at v1",
  (await one(db, `select t.version from public.program_onboarding_sources s
                  join public.onboarding_templates t on t.id = s.template_id
                  where s.program_id = '${programme}'`)).version === 1);
t.check("and its question wording is untouched",
  (await one(db, `select f.question from public.onboarding_responses r
                  join public.onboarding_template_fields f on f.id = r.template_field_id
                  where r.program_id = '${programme}' order by f.sort_order limit 1`))
    .question === "Q one");

/* -------------------------------------------------------------------------- */
/* Ownership is retunable; a generated programme keeps its own copy            */
/* -------------------------------------------------------------------------- */

await db.exec(`update public.onboarding_template_fields
               set default_owner = 'both', default_owner_set_by = '${admin}',
                   default_owner_set_at = clock_timestamp()
               where id = '${fields[0].id}'`);
t.check("retuning a template field's owner is allowed",
  (await one(db, `select default_owner from public.onboarding_template_fields
                  where id = '${fields[0].id}'`)).default_owner === "both");
t.check("and the generated response keeps the owner it was generated with",
  (await one(db, `select owner from public.onboarding_responses
                  where program_id = '${programme}' and template_field_id = '${fields[0].id}'`))
    .owner === "client");
t.check("the change is audited",
  (await one(db, `select count(*)::int as n from public.audit_events
                  where table_name = 'onboarding_template_fields' and action = 'update'`)).n >= 1);

/* -------------------------------------------------------------------------- */
/* Deleting a generated programme                                             */
/* -------------------------------------------------------------------------- */

await t.refuses("a programme with generated onboarding cannot be deleted", db, null,
  `delete from public.programs where id = '${programme}'`, "generated onboarding");
await t.refuses("nor its organisation", db, null,
  `delete from public.organisations where id = '${org}'`, "programme");

await db.exec(`update public.programs set archived_at = now() where id = '${programme}'`);
t.check("but it can be archived, history intact",
  (await one(db, `select archived_at from public.programs where id = '${programme}'`))
    .archived_at !== null);
await db.exec(`update public.programs set archived_at = null where id = '${programme}'`);
t.check("and unarchived",
  (await one(db, `select archived_at from public.programs where id = '${programme}'`))
    .archived_at === null);

process.exit(t.report().failed ? 1 : 0);
