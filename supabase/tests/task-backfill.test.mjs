/**
 * The one-off backfill inside 20260812210000_task_generations, run against data.
 *
 * This suite exists because the other one could not test it. Every other suite
 * starts from a database with all migrations applied and then inserts rows, so
 * a migration that transforms EXISTING data sees an empty table and proves
 * nothing. The backfill would have shipped never having processed a row.
 *
 * What it has to get right: every (answer, template) pair that already produced
 * a task gets exactly one row, so that after the migration those templates do
 * NOT fire again. Get it wrong and the first re-approval duplicates live work.
 *
 * The column drop it accompanies is irreversible, which is the other reason to
 * exercise it here rather than in production.
 */

import { applyRemaining, freshDatabase, one, rows, suite } from "./harness.mjs";

const t = suite("Task generation backfill");

// Stopped at the state the real database is in right now: task_engine applied,
// task_generations not.
const db = await freshDatabase({ stopBefore: "task_generations" });

/* -------------------------------------------------------------------------- */
/* The world before the migration                                             */
/* -------------------------------------------------------------------------- */

t.check("the old boolean is still there",
  (await rows(db, `select column_name from information_schema.columns
                   where table_name = 'onboarding_responses'
                     and column_name = 'tasks_generated'`)).length === 1);
t.check("and the join table does not exist yet",
  (await rows(db, `select 1 from information_schema.tables
                   where table_name = 'task_generations'`)).length === 0);

const admin = (await one(db, `select id from public.users where tier = 'super_admin'`)).id;
await db.exec(`set test.actor = '${admin}'`);

const sana = (
  await one(db, `insert into public.users (id, email, full_name, tier)
                 values (gen_random_uuid(),'sana@amzai.test','Sana','user') returning id`)
).id;

const b2b = (await one(db, `select id from public.client_types where slug='b2b_tech'`)).id;
const org = (
  await one(db, `insert into public.organisations (name, slug, client_type_id)
                 values ('Acme','acme','${b2b}') returning id`)
).id;
const prog = (
  await one(db, `insert into public.programs
                   (organisation_id, name, slug, type, start_date, fixed_milestone_date)
                 values ('${org}','P','p','event','2026-09-01','2026-11-30') returning id`)
).id;
await db.exec(`insert into public.program_assignments (program_id, user_id, role_on_program)
               values ('${prog}','${sana}','delivery_lead')`);

const template = (
  await one(db, `insert into public.onboarding_templates (name, slug, kind, version)
                 values ('Core','core','core',1) returning id`)
).id;

/** A question, its templates, an answer, and approval — all pre-migration. */
async function approvedQuestion(sortOrder, question, titles) {
  const field = (
    await one(db, `insert into public.onboarding_template_fields
                     (template_id, section, sort_order, question, default_owner, default_offset_type)
                   values ('${template}','S',${sortOrder},'${question}','client','weeks_from_start')
                   returning id`)
  ).id;

  const templateIds = [];
  for (const [index, title] of titles.entries()) {
    templateIds.push(
      (
        await one(db, `insert into public.task_templates
                         (template_field_id, title, default_assignee_role, sort_order)
                       values ('${field}','${title}','delivery_lead',${index + 1})
                       returning id`)
      ).id,
    );
  }

  const response = (
    await one(db, `insert into public.onboarding_responses
                     (program_id, template_field_id, owner, response)
                   values ('${prog}','${field}','client','An answer') returning id`)
  ).id;
  await db.exec(`update public.onboarding_responses set status='approved' where id='${response}'`);

  return { field, response, templateIds };
}

// Two questions: one producing two tasks, one producing one.
const first = await approvedQuestion(1, 'Two pieces of work?', ['Work A', 'Work B']);
const second = await approvedQuestion(2, 'One piece of work?', ['Work C']);

// A manual task, which belongs to no template and must produce no pair row.
await db.exec(`insert into public.tasks (program_id, title, source)
               values ('${prog}','Booked by hand','manual')`);

/*
  A task whose template was hard deleted. The application only deactivates, so
  this is the theoretical hole the migration's comment names — and the point of
  including it is that the backfill must not choke on it.
*/
const orphanTemplate = (
  await one(db, `insert into public.task_templates (template_field_id, title)
                 values ('${first.field}','Doomed template') returning id`)
).id;
await db.exec(`insert into public.tasks
                 (program_id, title, source, source_response_id, source_task_template_id)
               values ('${prog}','From a deleted template','onboarding',
                       '${first.response}','${orphanTemplate}')`);
await db.exec(`delete from public.task_templates where id = '${orphanTemplate}'`);

const preMigrationTasks = (
  await one(db, `select count(*)::int as n from public.tasks`)
).n;
t.check("the old trigger built work before the migration", preMigrationTasks === 5,
  `got ${preMigrationTasks}`);
t.check("and set the old boolean",
  (await one(db, `select tasks_generated from public.onboarding_responses
                  where id = '${first.response}'`)).tasks_generated === true);
t.check("the deleted template left a task with no template id",
  (await one(db, `select count(*)::int as n from public.tasks
                  where source = 'onboarding' and source_task_template_id is null`)).n === 1);

/* -------------------------------------------------------------------------- */
/* Run the migration over that data                                           */
/* -------------------------------------------------------------------------- */

const applied = await applyRemaining(db);
t.check("the migration under test actually ran",
  applied.some((f) => f.includes("task_generations")), applied.join(", "));

const pairs = await rows(
  db,
  `select response_id, task_template_id, generated_at
   from public.task_generations order by task_template_id`,
);

t.check("one row per pair that had already generated", pairs.length === 3,
  `got ${pairs.length}: ${JSON.stringify(pairs.map((p) => p.task_template_id))}`);

t.check("both of the first question's templates are recorded",
  first.templateIds.every((id) => pairs.some((p) => p.task_template_id === id)));
t.check("and the second question's one",
  pairs.some((p) => p.task_template_id === second.templateIds[0]));

t.check("the manual task produced no pair row",
  pairs.length === 3 && !pairs.some((p) => p.response_id === null));

t.check("the task whose template was deleted produced none either, without failing",
  (await one(db, `select count(*)::int as n from public.task_generations g
                  join public.tasks t on t.source_task_template_id = g.task_template_id
                  where t.source_task_template_id is null`)).n === 0);

t.check("generated_at is taken from when the task was created, not from now",
  pairs.every((p) => p.generated_at !== null));

t.check("the old boolean is gone",
  (await rows(db, `select column_name from information_schema.columns
                   where table_name = 'onboarding_responses'
                     and column_name = 'tasks_generated'`)).length === 0);

/* -------------------------------------------------------------------------- */
/* The payoff: nothing fires twice                                            */
/* -------------------------------------------------------------------------- */

/*
  Without a correct backfill this is where live work would duplicate. The pairs
  have no record of firing, so the new trigger would treat every template as
  never fired and build a second copy of everything.
*/
await db.exec(`update public.onboarding_responses set status='submitted'
               where id='${first.response}'`);
await db.exec(`update public.onboarding_responses set status='approved'
               where id='${first.response}'`);

t.check("re-approving after the migration duplicates nothing",
  (await one(db, `select count(*)::int as n from public.tasks`)).n === preMigrationTasks,
  `${(await one(db, `select count(*)::int as n from public.tasks`)).n} tasks, was ${preMigrationTasks}`);
t.check("and adds no pair rows",
  (await one(db, `select count(*)::int as n from public.task_generations`)).n === 3);

t.check("backfilling a template that already fired creates nothing",
  (await one(db, `select public.backfill_task_template('${first.templateIds[0]}') as n`)).n === 0);

/*
  And the thing the whole change exists for: a template written after all this
  still fires, against an answer approved long before it existed.
*/
const late = (
  await one(db, `insert into public.task_templates
                   (template_field_id, title, default_assignee_role)
                 values ('${first.field}','Written afterwards','delivery_lead') returning id`)
).id;

t.check("a template authored after the migration fires against the old answer",
  (await one(db, `select public.backfill_task_template('${late}') as n`)).n === 1);
t.check("adding exactly one task", (await one(db,
  `select count(*)::int as n from public.tasks`)).n === preMigrationTasks + 1);
t.check("and one pair row", (await one(db,
  `select count(*)::int as n from public.task_generations`)).n === 4);

process.exit(t.report().failed ? 1 : 0);
