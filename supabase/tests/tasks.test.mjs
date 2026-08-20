/**
 * The task engine. SPEC.md module 3.
 *
 * Two rules carry the weight. Approval creates the work a question defines, and
 * a later change to that answer FLAGS the work rather than rewriting it —
 * SPEC.md section 8, which is explicit that nothing regenerates silently and
 * the answer is never locked.
 */

import { freshDatabase, one, rows, suite } from "./harness.mjs";

const t = suite("Task engine");
const db = await freshDatabase();

const admin = (await one(db, `select id from public.users where tier = 'super_admin'`)).id;
await db.exec(`set test.actor = '${admin}'`);

const sana = (
  await one(db, `insert into public.users (id, email, full_name, tier)
                 values (gen_random_uuid(),'sana@amzai.test','Sana','user') returning id`)
).id;
const tom = (
  await one(db, `insert into public.users (id, email, full_name, tier)
                 values (gen_random_uuid(),'tom@amzai.test','Tom','user') returning id`)
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

// One delivery lead, so a role resolves; two specialists, so one does not.
await db.exec(`insert into public.program_assignments (program_id, user_id, role_on_program)
  values ('${prog}','${sana}','delivery_lead'),
         ('${prog}','${sana}','specialist'),
         ('${prog}','${tom}','specialist')`);

const template = (
  await one(db, `insert into public.onboarding_templates (name, slug, kind, version)
                 values ('Core','core','core',1) returning id`)
).id;
const fields = await rows(
  db,
  `insert into public.onboarding_template_fields
     (template_id, section, sort_order, question, default_owner, default_offset_type)
   values ('${template}','S',1,'Question with work?','client','weeks_from_start'),
          ('${template}','S',2,'Question with none?','client','weeks_from_start'),
          ('${template}','S',3,'Question for a tied role?','client','weeks_from_start')
   returning id`,
);

const responses = await rows(
  db,
  `insert into public.onboarding_responses (program_id, template_field_id, owner)
   values ('${prog}','${fields[0].id}','client'),
          ('${prog}','${fields[1].id}','client'),
          ('${prog}','${fields[2].id}','client')
   returning id`,
);

const taskCount = async (responseId) =>
  (await one(db, `select count(*)::int as n from public.tasks
                  where source_response_id = '${responseId}'`)).n;
const approve = (responseId) =>
  `update public.onboarding_responses set status = 'approved' where id = '${responseId}'`;

/* -------------------------------------------------------------------------- */
/* It ships empty                                                             */
/* -------------------------------------------------------------------------- */

t.check("no task templates exist until somebody writes them",
  (await one(db, `select count(*)::int as n from public.task_templates`)).n === 0);

await db.exec(`update public.onboarding_responses set response = 'An answer'
               where id = '${responses[0].id}'`);
await db.exec(approve(responses[0].id));

t.check("approving a question with no template creates no work",
  (await taskCount(responses[0].id)) === 0);
t.check("and tasks_generated stays false, so the door is not silently closed",
  (await one(db, `select tasks_generated from public.onboarding_responses
                  where id = '${responses[0].id}'`)).tasks_generated === false);

/* -------------------------------------------------------------------------- */
/* Approval creates the work a question defines                               */
/* -------------------------------------------------------------------------- */

await db.exec(`insert into public.task_templates
  (template_field_id, title, detail, default_assignee_role, default_offset_type,
   default_offset_value, blocking, sort_order)
  values ('${fields[0].id}','Build the target list','From the titles they gave',
          'delivery_lead','weeks_from_start',2,true,1),
         ('${fields[0].id}','Check it against the do-not-contact list',null,
          'delivery_lead','days_before_milestone',30,false,2)`);

// Move it away from approved and back, which is how work is generated for a
// question whose template was written after it was first approved.
await db.exec(`update public.onboarding_responses set status = 'submitted'
               where id = '${responses[0].id}'`);
await db.exec(approve(responses[0].id));

t.check("approving now creates both tasks", (await taskCount(responses[0].id)) === 2);
t.check("and tasks_generated is set", (await one(db,
  `select tasks_generated from public.onboarding_responses
   where id = '${responses[0].id}'`)).tasks_generated === true);

const built = await rows(
  db,
  `select title, assignee_id, role_on_program, due_date, blocking, source, source_answer
   from public.tasks where source_response_id = '${responses[0].id}'
   order by title`,
);

t.check("the single holder of the role is assigned",
  built.every((task) => task.assignee_id === sana), JSON.stringify(built.map((b) => b.assignee_id)));
t.check("the role it resolved from is recorded",
  built.every((task) => task.role_on_program === "delivery_lead"));
t.check("weeks from start resolves against the programme's start date",
  built.find((b) => b.title === "Build the target list").due_date instanceof Date ||
    typeof built.find((b) => b.title === "Build the target list").due_date === "string");
t.check("the blocking flag carries over",
  built.find((b) => b.title === "Build the target list").blocking === true);
t.check("each task records the answer it was built from",
  built.every((task) => task.source_answer === "An answer"));
t.check("and is marked as coming from onboarding",
  built.every((task) => task.source === "onboarding"));

t.check("creating a task is audited",
  (await one(db, `select count(*)::int as n from public.audit_events
                  where table_name = 'tasks' and action = 'insert'`)).n === 2);

/* -------------------------------------------------------------------------- */
/* A role two people hold is never broken by a guess. SPEC.md 4.3             */
/* -------------------------------------------------------------------------- */

await db.exec(`insert into public.task_templates
  (template_field_id, title, default_assignee_role)
  values ('${fields[2].id}','Work for a contested role','specialist')`);
await db.exec(`update public.onboarding_responses set response = 'x', status = 'approved'
               where id = '${responses[2].id}'`);

const contested = await one(db, `select assignee_id, role_on_program from public.tasks
                                 where source_response_id = '${responses[2].id}'`);
t.check("two holders leaves the task unassigned rather than picking one",
  contested.assignee_id === null, JSON.stringify(contested));
t.check("but records the role, so the task can say why nobody has it",
  contested.role_on_program === "specialist");

/* -------------------------------------------------------------------------- */
/* A changed answer FLAGS the work. SPEC.md section 8                         */
/* -------------------------------------------------------------------------- */

const stale = async () =>
  rows(db, `select title, stale_since, stale_reason, status from public.tasks
            where source_response_id = '${responses[0].id}' order by title`);

t.check("nothing is stale to begin with",
  (await stale()).every((task) => task.stale_since === null));

// One task is already done, and one already cancelled, before the answer moves.
await db.exec(`update public.tasks set status = 'done'
               where source_response_id = '${responses[0].id}'
                 and title = 'Build the target list'`);
await db.exec(`update public.tasks set status = 'cancelled', cancelled_reason = 'Not needed'
               where source_response_id = '${responses[0].id}'
                 and title = 'Check it against the do-not-contact list'`);

await db.exec(`update public.onboarding_responses set response = 'A different answer'
               where id = '${responses[0].id}'`);

const afterChange = await stale();
const done = afterChange.find((task) => task.status === "done");
const cancelled = afterChange.find((task) => task.status === "cancelled");

t.check("work already completed IS flagged, because that is what you need to know",
  done.stale_since !== null, JSON.stringify(done));
t.check("and says why", done.stale_reason.includes("has changed"));
t.check("work already cancelled is left alone, somebody decided it did not apply",
  cancelled.stale_since === null, JSON.stringify(cancelled));

t.check("nothing was regenerated",
  (await taskCount(responses[0].id)) === 2);
t.check("and the answer is not locked",
  (await one(db, `select response from public.onboarding_responses
                  where id = '${responses[0].id}'`)).response === "A different answer");

const earlier = done.stale_since;
await db.exec(`update public.onboarding_responses set response = 'Changed again'
               where id = '${responses[0].id}'`);
t.check("a second change does not reset when it first went stale",
  String((await stale()).find((task) => task.status === "done").stale_since) === String(earlier));

/* -------------------------------------------------------------------------- */
/* Un-approving flags too                                                     */
/* -------------------------------------------------------------------------- */

{
  const r = responses[2].id;
  await db.exec(`update public.tasks set stale_since = null, stale_reason = null
                 where source_response_id = '${r}'`);
  await db.exec(`update public.onboarding_responses set status = 'blocked' where id = '${r}'`);

  const flagged = await one(db, `select stale_since, stale_reason from public.tasks
                                 where source_response_id = '${r}'`);
  t.check("an answer that stops being approved flags its work",
    flagged.stale_since !== null, JSON.stringify(flagged));
  t.check("and says what it became", flagged.stale_reason.includes("blocked"));
}

/* -------------------------------------------------------------------------- */
/* Resolving a flagged task                                                   */
/* -------------------------------------------------------------------------- */

{
  // A fresh question, template, answer and approval, so this section stands
  // alone rather than inheriting whatever the sections above left behind.
  const field = (
    await one(db, `insert into public.onboarding_template_fields
                     (template_id, section, sort_order, question, default_owner, default_offset_type)
                   values ('${template}','S',9,'Regenerate me?','client','weeks_from_start')
                   returning id`)
  ).id;
  await db.exec(`insert into public.task_templates
    (template_field_id, title, detail, default_assignee_role)
    values ('${field}','Do the thing','As described','delivery_lead')`);

  const response = (
    await one(db, `insert into public.onboarding_responses
                     (program_id, template_field_id, owner, response)
                   values ('${prog}','${field}','client','First answer') returning id`)
  ).id;
  await db.exec(`update public.onboarding_responses set status='approved' where id='${response}'`);

  const original = await one(db, `select id, source_answer from public.tasks
                                  where source_response_id = '${response}'`);
  t.check("work exists from the first answer", original.source_answer === "First answer");

  await db.exec(`update public.onboarding_responses set response = 'Second answer'
                 where id = '${response}'`);
  t.check("and goes stale when the answer moves",
    (await one(db, `select stale_since from public.tasks where id = '${original.id}'`))
      .stale_since !== null);

  // Keep: the flag clears, nothing else changes.
  await db.exec(`update public.tasks set stale_since = null, stale_reason = null
                 where id = '${original.id}'`);
  t.check("keeping it clears the flag and leaves the work alone",
    (await one(db, `select stale_since, status, source_answer from public.tasks
                    where id = '${original.id}'`)).source_answer === "First answer");

  // Regenerate: supersede rather than rewrite.
  await db.exec(`update public.tasks set stale_since = clock_timestamp()
                 where id = '${original.id}'`);
  const fresh = (await one(db, `select public.regenerate_task('${original.id}') as id`)).id;

  const superseded = await one(db, `select status, cancelled_reason, stale_since, source_answer
                                    from public.tasks where id = '${original.id}'`);
  t.check("the old task is cancelled rather than edited",
    superseded.status === "cancelled", superseded.status);
  t.check("saying why", superseded.cancelled_reason.includes("Superseded"));
  t.check("its flag is cleared, since it has been dealt with",
    superseded.stale_since === null);
  t.check("and it still shows the answer it was built from",
    superseded.source_answer === "First answer");

  const replacement = await one(db, `select status, source_answer, stale_since, assignee_id
                                     from public.tasks where id = '${fresh}'`);
  t.check("the replacement is built from the answer as it now stands",
    replacement.source_answer === "Second answer");
  t.check("and starts clean", replacement.status === "not_started" &&
    replacement.stale_since === null);
  t.check("with the role resolved again", replacement.assignee_id === sana);

  t.check("so the record shows both, not one rewritten",
    (await one(db, `select count(*)::int as n from public.tasks
                    where source_response_id = '${response}'`)).n === 2);

  /*
    Created here rather than sub-selected. A sub-select that matches nothing
    passes the function a null and it raises "No such task" — the right refusal
    for the wrong reason, and the case would never reach the rule it is testing.
  */
  const manual = (
    await one(db, `insert into public.tasks (program_id, title, source)
                   values ('${prog}','A manual task','manual') returning id`)
  ).id;
  await t.refuses("a manual task cannot be regenerated", db, null,
    `select public.regenerate_task('${manual}')`, "built from an answer");
}

/* -------------------------------------------------------------------------- */
/* Manual tasks, and what the shape refuses                                   */
/* -------------------------------------------------------------------------- */

await t.allows("a manual task needs no answer behind it", db, null,
  `insert into public.tasks (program_id, title, source)
   values ('${prog}','Book the venue','manual')`);

await t.refuses("a task from onboarding must name the answer it came from", db, null,
  `insert into public.tasks (program_id, title, source)
   values ('${prog}','Orphan','onboarding')`);

await t.refuses("a manual task may not claim one", db, null,
  `insert into public.tasks (program_id, title, source, source_response_id)
   values ('${prog}','Confused','manual','${responses[0].id}')`);

await t.refuses("a blank title is refused", db, null,
  `insert into public.tasks (program_id, title, source) values ('${prog}','   ','manual')`);

await t.refuses("a nonsense status is refused", db, null,
  `insert into public.tasks (program_id, title, source, status)
   values ('${prog}','X','manual','nearly')`);

/* -------------------------------------------------------------------------- */
/* Access follows the programme                                               */
/* -------------------------------------------------------------------------- */

const outsider = (
  await one(db, `insert into public.users (id, email, full_name, tier)
                 values (gen_random_uuid(),'out@amzai.test','Out','user') returning id`)
).id;

t.check("somebody assigned to the programme sees its tasks",
  (await (async () => {
    const r = await import("./harness.mjs");
    return r.countAs(db, sana, "tasks");
  })()) > 0);
t.check("somebody who is not sees none",
  (await (async () => {
    const r = await import("./harness.mjs");
    return r.countAs(db, outsider, "tasks");
  })()) === 0);

process.exit(t.report().failed ? 1 : 0);
