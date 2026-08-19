/**
 * Every migration applies, twice, and leaves the schema it claims to.
 *
 * The "twice" is not academic. A `supabase db push` that fails partway leaves
 * some migrations applied and some not, and the fix is to run it again; a
 * migration that cannot survive that turns a bad afternoon into a restore.
 */

import { freshDatabase, migrationCount, one, rows, suite } from "./harness.mjs";

const t = suite("Migrations");
const db = await freshDatabase({ twice: true });

t.check(`all ${migrationCount()} migrations apply, twice`, true);

/* -------------------------------------------------------------------------- */
/* Question sets                                                              */
/* -------------------------------------------------------------------------- */

const templateColumns = (
  await rows(
    db,
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'onboarding_templates'`,
  )
).map((c) => c.column_name);

for (const column of ["slug", "kind", "source_sheet", "content_hash", "client_type_id", "sub_segment_id"]) {
  t.check(`onboarding_templates.${column} exists`, templateColumns.includes(column));
}
t.check("the old vertical column is gone", !templateColumns.includes("vertical"));

t.check(
  "program_type is nullable, so a core set is not tied to a programme type",
  (
    await one(
      db,
      `select is_nullable from information_schema.columns
       where table_name = 'onboarding_templates' and column_name = 'program_type'`,
    )
  ).is_nullable === "YES",
);

await t.refuses(
  "a duplicate (slug, version) is refused",
  db,
  null,
  `insert into public.onboarding_templates (name, slug, kind, version)
   values ('A','dup','core',1), ('B','dup','core',1)`,
);

await t.refuses(
  "a nonsense kind is refused",
  db,
  null,
  `insert into public.onboarding_templates (name, slug, kind) values ('A','k','nonsense')`,
);

/* -------------------------------------------------------------------------- */
/* Borrowed question sets                                                     */
/* -------------------------------------------------------------------------- */

const borrows = await rows(
  db,
  `select target.slug as target, source.slug as source
   from public.client_sub_segments target
   join public.client_sub_segments source
     on source.id = target.questions_from_sub_segment_id
   order by target.slug`,
);

t.equal(
  "the two sub-segments the workbook does not cover borrow trade show organizer",
  borrows,
  [
    { target: "community_event_organizer", source: "trade_show_organizer" },
    { target: "hosted_buyer_organizer", source: "trade_show_organizer" },
  ],
);

await t.refuses(
  "a sub-segment cannot borrow from itself",
  db,
  null,
  `update public.client_sub_segments set questions_from_sub_segment_id = id where slug = 'association'`,
);

await t.refuses(
  "nor across client types",
  db,
  null,
  `update public.client_sub_segments
   set questions_from_sub_segment_id = (select id from public.client_sub_segments where slug = 'erp')
   where slug = 'association'`,
);

/* -------------------------------------------------------------------------- */
/* Frozen once generated                                                      */
/* -------------------------------------------------------------------------- */

const template = (
  await one(
    db,
    `insert into public.onboarding_templates (name, slug, kind, version)
     values ('Frozen','frozen','core',1) returning id`,
  )
).id;
const field = (
  await one(
    db,
    `insert into public.onboarding_template_fields
       (template_id, section, question, default_owner, default_offset_type)
     values ('${template}','S','Original wording?','client','weeks_from_start') returning id`,
  )
).id;

await t.refuses(
  "a template field cannot be reworded",
  db, null,
  `update public.onboarding_template_fields set question = 'Reworded' where id = '${field}'`,
  "append-only",
);
await t.refuses(
  "nor deleted",
  db, null,
  `delete from public.onboarding_template_fields where id = '${field}'`,
  "append-only",
);
await t.refuses(
  "nor truncated",
  db, null,
  `truncate public.onboarding_template_fields`,
);
t.check(
  "so the question survives all three",
  (await one(db, `select question from public.onboarding_template_fields where id = '${field}'`))
    .question === "Original wording?",
);

await t.allows(
  "but its owner may be changed, which is the one exception",
  db, null,
  `update public.onboarding_template_fields set default_owner = 'both' where id = '${field}'`,
);
await t.refuses(
  "and an owner change smuggling a reword is refused whole",
  db, null,
  `update public.onboarding_template_fields
   set default_owner = 'amzai', question = 'Sneaky' where id = '${field}'`,
);

await t.refuses(
  "a template version cannot be renumbered",
  db, null,
  `update public.onboarding_templates set version = 9 where id = '${template}'`,
);
await t.allows(
  "but a bad version can be withdrawn",
  db, null,
  `update public.onboarding_templates set active = false where id = '${template}'`,
);

/* -------------------------------------------------------------------------- */
/* Tables the later migrations added                                          */
/* -------------------------------------------------------------------------- */

for (const table of [
  "program_onboarding_sources",
  "program_situational_modules",
  "staff_functions",
  "user_staff_functions",
  "organisation_managers",
]) {
  const exists =
    (await rows(db, `select 1 from information_schema.tables where table_name = '${table}'`))
      .length === 1;
  t.check(`${table} exists`, exists);

  if (!exists) continue;

  t.check(
    `${table} has row level security on`,
    (await one(db, `select relrowsecurity from pg_class where relname = '${table}'`))
      .relrowsecurity === true,
  );
  t.check(
    `${table} is closed to anon`,
    (
      await rows(
        db,
        `select 1 from information_schema.role_table_grants
         where table_name = '${table}' and grantee = 'anon'`,
      )
    ).length === 0,
  );

  const triggers = (
    await rows(
      db,
      `select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relname = '${table}' and not t.tgisinternal`,
    )
  ).map((r) => r.tgname);
  t.check(`${table} is audited`, triggers.includes("record_audit"));
  t.check(`${table} stamps updated_at`, triggers.includes("set_updated_at"));
}

/*
  A real programme first. Sub-selecting one that does not exist would make the
  insert a no-op, and the case would pass without ever reaching the trigger.
*/
const org = (
  await one(
    db,
    `insert into public.organisations (name, slug, client_type_id)
     select 'Trigger Co', 'trigger-co', id from public.client_types where slug = 'b2b_tech'
     returning id`,
  )
).id;
const programme = (
  await one(
    db,
    `insert into public.programs (organisation_id, name, slug, type)
     values ('${org}', 'Trigger', 'trigger', 'event') returning id`,
  )
).id;

await t.refuses(
  "a situational module choice must name a module that exists",
  db, null,
  `insert into public.program_situational_modules (program_id, module_slug)
   values ('${programme}', 'not_a_module')`,
  "no situational module",
);

process.exit(t.report().failed ? 1 : 0);
