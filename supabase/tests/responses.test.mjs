/**
 * Editing a response: status, due date, and the bulk reassign.
 *
 * Everything the programme detail derives — the section counts, the answered
 * line, the blocking bar — and the four portfolio counts on the list are
 * functions of `status`, so this is the column the interface leans on hardest.
 *
 * The counts themselves are computed in the browser and cannot be asserted
 * here. What can be asserted is that the writes land, that they are audited,
 * that row level security scopes them, and that the constraint refuses a status
 * that does not exist.
 */

import { asUser, freshDatabase, one, rows, suite } from "./harness.mjs";

const t = suite("Response edits");
const db = await freshDatabase();

const admin = (await one(db, `select id from public.users where tier = 'super_admin'`)).id;
const sana = (
  await one(db, `insert into public.users (id, email, full_name, tier)
                 values (gen_random_uuid(),'sana@amzai.test','Sana','user') returning id`)
).id;
const tom = (
  await one(db, `insert into public.users (id, email, full_name, tier)
                 values (gen_random_uuid(),'tom@amzai.test','Tom','user') returning id`)
).id;
const outsider = (
  await one(db, `insert into public.users (id, email, full_name, tier)
                 values (gen_random_uuid(),'out@amzai.test','Outsider','user') returning id`)
).id;

const b2b = (await one(db, `select id from public.client_types where slug = 'b2b_tech'`)).id;
const org = (
  await one(db, `insert into public.organisations (name, slug, client_type_id)
                 values ('Acme','acme','${b2b}') returning id`)
).id;
const progA = (
  await one(db, `insert into public.programs (organisation_id, name, slug, type)
                 values ('${org}','A','a','event') returning id`)
).id;
const progB = (
  await one(db, `insert into public.programs (organisation_id, name, slug, type)
                 values ('${org}','B','b','event') returning id`)
).id;

await db.exec(`insert into public.program_assignments (program_id, user_id, role_on_program)
               values ('${progA}','${sana}','delivery_lead'), ('${progB}','${sana}','delivery_lead')`);

const template = (
  await one(db, `insert into public.onboarding_templates (name, slug, kind, version)
                 values ('Core','core','core',1) returning id`)
).id;
const fields = await rows(
  db,
  `insert into public.onboarding_template_fields
     (template_id, section, sort_order, question, default_owner, default_offset_type)
   values ('${template}','S',1,'Q one','amzai','weeks_from_start'),
          ('${template}','S',2,'Q two','amzai','weeks_from_start'),
          ('${template}','S',3,'Q three','amzai','weeks_from_start')
   returning id`,
);

// Three on programme A, one of them blocking; one on programme B.
const responses = await rows(
  db,
  `insert into public.onboarding_responses
     (program_id, template_field_id, owner, assignee_id, blocking, status)
   values ('${progA}','${fields[0].id}','amzai','${sana}',true,'not_started'),
          ('${progA}','${fields[1].id}','amzai','${sana}',false,'not_started'),
          ('${progA}','${fields[2].id}','amzai','${tom}',false,'not_started')
   returning id`,
);
await db.exec(`insert into public.onboarding_responses
                 (program_id, template_field_id, owner, assignee_id)
               values ('${progB}','${fields[0].id}','amzai','${sana}')`);

const auditCount = async () =>
  (await one(db, `select count(*)::int as n from public.audit_events
                  where table_name = 'onboarding_responses' and action = 'update'`)).n;

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

const beforeStatus = await auditCount();
await t.allows("a status change writes", db, sana,
  `update public.onboarding_responses set status = 'blocked' where id = '${responses[0].id}'`);
t.check("and it stuck",
  (await one(db, `select status from public.onboarding_responses where id = '${responses[0].id}'`))
    .status === "blocked");
t.check("and it is audited", (await auditCount()) === beforeStatus + 1);

for (const status of ["not_started", "in_progress", "submitted", "approved", "blocked", "na"]) {
  await t.allows(`status ${status} is accepted`, db, sana,
    `update public.onboarding_responses set status = '${status}' where id = '${responses[0].id}'`);
}
await t.refuses("a status that does not exist is refused", db, sana,
  `update public.onboarding_responses set status = 'nearly' where id = '${responses[0].id}'`);

/*
  Row level security FILTERS, it does not refuse. An outsider's update runs
  without error and matches no rows, which is why every server action here
  checks the returned row count rather than the error: no rows is the denial.
  A suite that expected an exception would have been asserting the wrong thing
  and would pass against a policy that had been removed.
*/
// A known starting point: the loop above left it wherever it finished.
await db.exec(`update public.onboarding_responses set status = 'in_progress'
               where id = '${responses[0].id}'`);

const outsiderUpdate = await asUser(
  db, outsider,
  `update public.onboarding_responses set status = 'approved'
   where id = '${responses[0].id}' returning id`,
);
t.check("an outsider's status change matches no rows", outsiderUpdate.rows?.length === 0,
  JSON.stringify(outsiderUpdate));
t.check("so the status is unchanged",
  (await one(db, `select status from public.onboarding_responses where id = '${responses[0].id}'`))
    .status === "in_progress");

/* -------------------------------------------------------------------------- */
/* What the blocking bar is derived from                                      */
/* -------------------------------------------------------------------------- */

/*
  The bar counts responses that are blocking AND still open, where open means
  not approved and not N/A. These assert the data behind it; the bar appearing
  and disappearing is the browser's half.
*/
const openBlocking = async () =>
  (await one(db, `select count(*)::int as n from public.onboarding_responses
                  where program_id = '${progA}' and blocking
                    and status not in ('approved','na')`)).n;

await db.exec(`update public.onboarding_responses set status = 'blocked'
               where id = '${responses[0].id}'`);
t.check("a blocking question that is blocked counts towards the bar", (await openBlocking()) === 1);

await db.exec(`update public.onboarding_responses set status = 'approved'
               where id = '${responses[0].id}'`);
t.check("approving the last open blocking item empties it", (await openBlocking()) === 0);

await db.exec(`update public.onboarding_responses set status = 'na'
               where id = '${responses[0].id}'`);
t.check("and N/A empties it too", (await openBlocking()) === 0);

/* -------------------------------------------------------------------------- */
/* Due date                                                                   */
/* -------------------------------------------------------------------------- */

await t.allows("a due date can be set", db, sana,
  `update public.onboarding_responses set due_date = '2026-09-14' where id = '${responses[1].id}'`);
t.check("and it stuck",
  (await one(db, `select due_date from public.onboarding_responses where id = '${responses[1].id}'`))
    .due_date !== null);
await t.allows("and cleared, which is an honest state", db, sana,
  `update public.onboarding_responses set due_date = null where id = '${responses[1].id}'`);
t.check("leaving no date at all",
  (await one(db, `select due_date from public.onboarding_responses where id = '${responses[1].id}'`))
    .due_date === null);

/* -------------------------------------------------------------------------- */
/* Bulk reassign. SPEC.md 4.6                                                 */
/* -------------------------------------------------------------------------- */

const assignedTo = async (userId, programmeId) =>
  (await one(db, `select count(*)::int as n from public.onboarding_responses
                  where program_id = '${programmeId}' and assignee_id = '${userId}'`)).n;

t.check("Sana holds two on this programme", (await assignedTo(sana, progA)) === 2);
t.check("and one on the other", (await assignedTo(sana, progB)) === 1);

const beforeReassign = await auditCount();
const moved = await asUser(
  db, admin,
  `update public.onboarding_responses set assignee_id = '${tom}'
   where program_id = '${progA}' and assignee_id = '${sana}' returning id`,
);
t.check("reassigning moves both of Sana's", moved.rows?.length === 2, JSON.stringify(moved.error));
t.check("Tom now holds all three on this programme", (await assignedTo(tom, progA)) === 3);
t.check("Sana holds none here", (await assignedTo(sana, progA)) === 0);
t.check("and her other programme is untouched", (await assignedTo(sana, progB)) === 1);

/*
  One audit row per response, not one for the bulk action. SPEC.md 4.6: the
  trail stays complete rather than recording a single vague event, so "who was
  this assigned to in September" has an answer a year later.
*/
t.check("the trail carries one row per response changed, not one for the action",
  (await auditCount()) === beforeReassign + 2,
  `${(await auditCount()) - beforeReassign} rows for 2 responses`);

const trail = await rows(
  db,
  `select before->>'assignee_id' as was, after->>'assignee_id' as now
   from public.audit_events
   where table_name = 'onboarding_responses' and action = 'update'
   order by occurred_at desc limit 2`,
);
t.check("and each row names who it moved from and to",
  trail.every((r) => r.was === sana && r.now === tom),
  JSON.stringify(trail));

const outsiderBulk = await asUser(
  db, outsider,
  `update public.onboarding_responses set assignee_id = '${outsider}'
   where program_id = '${progA}' returning id`,
);
t.check("an outsider's bulk reassign matches no rows", outsiderBulk.rows?.length === 0,
  JSON.stringify(outsiderBulk));
t.check("so Tom still holds them", (await assignedTo(tom, progA)) === 3);

process.exit(t.report().failed ? 1 : 0);
