/**
 * What each privilege tier can see and do, and nothing more.
 *
 * SPEC.md section 5. Every case that is meant to be refused is asserted as
 * refused: a policy that is too generous and one that is too strict are both
 * bugs, and only one of them gets reported by a user.
 */

import { asUser, countAs, freshDatabase, one, rows, suite } from "./harness.mjs";

const t = suite("Privilege tiers");
const db = await freshDatabase();

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const staff = {};
for (const [key, email, name, tier] of [
  ["admin", "priya@amzai.test", "Priya", "admin"],
  ["manager", "daniel@amzai.test", "Daniel", "manager"],
  ["userA", "sana@amzai.test", "Sana", "user"],
  ["userB", "tom@amzai.test", "Tom", "user"],
  ["dataOps", "ana@amzai.test", "Ana", "user"],
]) {
  staff[key] = (
    await one(
      db,
      `insert into public.users (id, email, full_name, tier)
       values (gen_random_uuid(), '${email}', '${name}', '${tier}') returning id`,
    )
  ).id;
}
const superAdmin = (await one(db, `select id from public.users where tier = 'super_admin'`)).id;

const b2b = (await one(db, `select id from public.client_types where slug = 'b2b_tech'`)).id;
const orgA = (
  await one(db, `insert into public.organisations (name, slug, client_type_id)
                 values ('Org A','org-a','${b2b}') returning id`)
).id;
const orgB = (
  await one(db, `insert into public.organisations (name, slug, client_type_id)
                 values ('Org B','org-b','${b2b}') returning id`)
).id;

const progA = (
  await one(db, `insert into public.programs (organisation_id, name, slug, type, currency)
                 values ('${orgA}','Prog A','prog-a','event','GBP') returning id`)
).id;
const progB = (
  await one(db, `insert into public.programs (organisation_id, name, slug, type, currency)
                 values ('${orgB}','Prog B','prog-b','event','GBP') returning id`)
).id;

await db.exec(`insert into public.organisation_managers (user_id, organisation_id)
               values ('${staff.manager}', '${orgA}')`);
await db.exec(`insert into public.program_assignments (program_id, user_id, role_on_program) values
  ('${progA}','${staff.userA}','delivery_lead'),
  ('${progB}','${staff.userB}','specialist'),
  ('${progB}','${staff.dataOps}','data_ops')`);
await db.exec(`insert into public.user_staff_functions (user_id, function_id)
               select '${staff.dataOps}', id from public.staff_functions where slug = 'data_ops'`);

const template = (
  await one(db, `insert into public.onboarding_templates (name, slug, kind, version)
                 values ('Core','core','core',1) returning id`)
).id;
const field = (
  await one(
    db,
    `insert into public.onboarding_template_fields
       (template_id, section, question, default_owner, default_offset_type)
     values ('${template}','S','Q?','client','weeks_from_start') returning id`,
  )
).id;
await db.exec(`insert into public.onboarding_responses (program_id, template_field_id, owner)
  values ('${progA}','${field}','client'), ('${progB}','${field}','client')`);
const company = (await one(db, `insert into public.companies (name) values ('Acme') returning id`)).id;
await db.exec(`insert into public.contacts (company_id, email) values ('${company}','x@acme.test')`);

const programmesSeenBy = async (userId) =>
  (await asUser(db, userId, `select name from public.programs order by name`)).rows.map((r) => r.name);

/* -------------------------------------------------------------------------- */
/* Super admin                                                                */
/* -------------------------------------------------------------------------- */

t.equal("super admin sees every programme", await programmesSeenBy(superAdmin), ["Prog A", "Prog B"]);
t.check("super admin reads commercial columns",
  (await asUser(db, superAdmin, `select currency from public.programs limit 1`)).rows[0].currency === "GBP");

/*
  Two independent layers protect the super admin, and only one of them raises.
  Row level security stops the signed-in path silently — the statement runs and
  matches nothing. The trigger is what holds where row level security does not:
  the service role, the table owner, a migration run by hand.
*/
await asUser(db, superAdmin, `update public.users set tier = 'user' where id = '${superAdmin}'`);
t.check("row level security: the super admin demoting themselves changes nothing",
  (await one(db, `select tier from public.users where id = '${superAdmin}'`)).tier === "super_admin");

await t.refuses("the trigger refuses a demotion with RLS bypassed", db, null,
  `update public.users set tier = 'user' where id = '${superAdmin}'`, "cannot be demoted");
await t.refuses("and a deactivation", db, null,
  `update public.users set active = false where id = '${superAdmin}'`, "cannot be deactivated");
await t.refuses("and a deletion", db, null,
  `delete from public.users where id = '${superAdmin}'`, "cannot be deleted");
await t.refuses("and promoting somebody else into it", db, null,
  `update public.users set tier = 'super_admin' where id = '${staff.admin}'`, "second super admin");

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

t.equal("admin sees every programme", await programmesSeenBy(staff.admin), ["Prog A", "Prog B"]);
await t.allows("admin can create a client", db, staff.admin,
  `insert into public.organisations (name, slug, client_type_id) values ('New','new-co','${b2b}')`);
await db.exec(`delete from public.organisations where slug = 'new-co'`);

await t.refuses("admin cannot promote themselves to super admin", db, staff.admin,
  `update public.users set tier = 'super_admin' where id = '${staff.admin}'`);
await asUser(db, staff.admin, `update public.users set full_name = 'Hacked' where id = '${superAdmin}'`);
t.check("admin cannot edit the super admin's row",
  (await one(db, `select full_name from public.users where id = '${superAdmin}'`)).full_name !== "Hacked");

/* -------------------------------------------------------------------------- */
/* Manager                                                                    */
/* -------------------------------------------------------------------------- */

t.equal("manager sees only their organisation's programme",
  await programmesSeenBy(staff.manager), ["Prog A"]);
t.check("and only that organisation", (await countAs(db, staff.manager, "organisations")) === 1);
t.check("and only its onboarding", (await countAs(db, staff.manager, "onboarding_responses")) === 1);

await t.allows("manager manages the team inside their organisation", db, staff.manager,
  `insert into public.program_assignments (program_id, user_id, role_on_program)
   values ('${progA}','${staff.userA}','specialist')`);
await t.refuses("but not a team outside it", db, staff.manager,
  `insert into public.program_assignments (program_id, user_id, role_on_program)
   values ('${progB}','${staff.userA}','specialist')`);
await t.refuses("manager cannot create a client", db, staff.manager,
  `insert into public.organisations (name, slug, client_type_id) values ('Sneaky','sneaky','${b2b}')`);
await t.refuses("manager cannot grant themselves another organisation", db, staff.manager,
  `insert into public.organisation_managers (user_id, organisation_id)
   values ('${staff.manager}','${orgB}')`);

await asUser(db, staff.manager, `update public.users set tier = 'admin' where id = '${staff.userA}'`);
t.check("manager cannot change anybody's tier",
  (await one(db, `select tier from public.users where id = '${staff.userA}'`)).tier === "user");

/* -- generating inside their own organisations, SPEC.md 5.1 --------------- */
await t.allows("manager can write their own programme, which generation does", db, staff.manager,
  `update public.programs set onboarding_fill_mode = 'amzai' where id = '${progA}'`);
await asUser(db, staff.manager,
  `update public.programs set onboarding_fill_mode = 'client' where id = '${progB}'`);
t.check("but not a programme outside their organisations",
  (await one(db, `select onboarding_fill_mode from public.programs where id = '${progB}'`))
    .onboarding_fill_mode === null);
await t.allows("manager records a role resolution on their own programme", db, staff.manager,
  `insert into public.program_role_resolutions (program_id, role_on_program, user_id, resolved_by)
   values ('${progA}','delivery_lead','${staff.userA}','${staff.manager}')`);
await t.refuses("but not on somebody else's", db, staff.manager,
  `insert into public.program_role_resolutions (program_id, role_on_program, user_id, resolved_by)
   values ('${progB}','delivery_lead','${staff.userA}','${staff.manager}')`);
await t.refuses("manager still cannot create a programme", db, staff.manager,
  `insert into public.programs (organisation_id, name, slug, type)
   values ('${orgA}','Second','second','event')`);
await db.exec(`update public.programs set onboarding_fill_mode = null where id = '${progA}'`);

/* -------------------------------------------------------------------------- */
/* THE UNION RULE                                                             */
/*                                                                            */
/* Promoting somebody must never take away access they already had.           */
/*                                                                            */
/* The load-bearing rule of the whole design, and the one failure nobody would */
/* report: the person affected would assume the programme was simply gone. So  */
/* it is asserted over the actual names, in both directions, and it names what */
/* was lost when it breaks. Verified against a deliberately broken policy.     */
/* -------------------------------------------------------------------------- */

{
  const before = await programmesSeenBy(staff.userB);
  t.equal("UNION RULE: before promotion, the user sees their assignment", before, ["Prog B"]);

  // Promoted to manager of an organisation that does NOT contain that assignment.
  await db.exec(`update public.users set tier = 'manager' where id = '${staff.userB}'`);
  await db.exec(`insert into public.organisation_managers (user_id, organisation_id)
                 values ('${staff.userB}','${orgA}')`);

  const after = await programmesSeenBy(staff.userB);
  const lost = before.filter((name) => !after.includes(name));
  t.check(
    "UNION RULE: promotion to manager NEVER removes an existing assignment",
    lost.length === 0,
    `before ${JSON.stringify(before)}, after ${JSON.stringify(after)} — LOST ${JSON.stringify(lost)}`,
  );
  t.equal("UNION RULE: and the manager sees the union of both", after, ["Prog A", "Prog B"]);

  await db.exec(`update public.users set tier = 'user' where id = '${staff.userB}'`);
  const demoted = await programmesSeenBy(staff.userB);
  t.check("UNION RULE: demotion leaves the assignment intact", demoted.includes("Prog B"),
    JSON.stringify(demoted));
  t.check("UNION RULE: but takes the organisation away", !demoted.includes("Prog A"),
    JSON.stringify(demoted));

  await db.exec(`delete from public.organisation_managers where user_id = '${staff.userB}'`);
}

/* -------------------------------------------------------------------------- */
/* User                                                                       */
/* -------------------------------------------------------------------------- */

t.equal("user sees only their assigned programme", await programmesSeenBy(staff.userA), ["Prog A"]);
t.equal("another user sees only theirs", await programmesSeenBy(staff.userB), ["Prog B"]);
await t.refuses("user cannot change a team", db, staff.userB,
  `insert into public.program_assignments (program_id, user_id, role_on_program)
   values ('${progB}','${staff.userA}','specialist')`);
t.check("user cannot read the audience database", (await countAs(db, staff.userB, "contacts")) === 0);

/* -------------------------------------------------------------------------- */
/* The data ops function                                                      */
/* -------------------------------------------------------------------------- */

t.check("data ops is tier user",
  (await one(db, `select tier from public.users where id = '${staff.dataOps}'`)).tier === "user");
t.check("data ops cannot read the programs table at all",
  (await countAs(db, staff.dataOps, "programs")) === 0);
t.check("nor the organisations table",
  (await countAs(db, staff.dataOps, "organisations")) === 0);
t.equal("data ops reads programmes through the restricted view",
  (await asUser(db, staff.dataOps, `select name from public.programs_restricted`)).rows.map((r) => r.name),
  ["Prog B"]);
t.check("scoped to their assignments, not everything",
  (await countAs(db, staff.dataOps, "programs_restricted")) === 1);

const restrictedColumns = (
  await rows(db, `select column_name from information_schema.columns
                  where table_name = 'programs_restricted'`)
).map((c) => c.column_name);
t.check("the view carries no commercial column",
  !["currency", "approver_email", "dashboard_token"].some((c) => restrictedColumns.includes(c)),
  restrictedColumns.join(", "));

t.check("data ops sees the audience", (await countAs(db, staff.dataOps, "contacts")) === 1);
t.check("data ops sees no onboarding answers",
  (await countAs(db, staff.dataOps, "onboarding_responses")) === 0);
t.check("a plain user gets nothing from the restricted view",
  (await countAs(db, staff.userA, "programs_restricted")) === 0);
t.check("an admin gets nothing from it either",
  (await countAs(db, staff.admin, "programs_restricted")) === 0);

/* -------------------------------------------------------------------------- */
/* A second function, added without a migration                               */
/* -------------------------------------------------------------------------- */

await db.exec(`insert into public.staff_functions
  (slug, label, audience_access, commercial_access, onboarding_access, program_scope)
  values ('finance','Finance','none','full','none','all')`);
await db.exec(`insert into public.user_staff_functions (user_id, function_id)
  select '${staff.userA}', id from public.staff_functions where slug = 'finance'`);

t.equal("finance widens scope to every programme with one INSERT",
  await programmesSeenBy(staff.userA), ["Prog A", "Prog B"]);
t.check("finance reads commercial columns",
  (await asUser(db, staff.userA, `select currency from public.programs limit 1`)).rows[0].currency === "GBP");
t.check("finance sees no onboarding answers",
  (await countAs(db, staff.userA, "onboarding_responses")) === 0);

await db.exec(`insert into public.user_staff_functions (user_id, function_id)
  select '${staff.userA}', id from public.staff_functions where slug = 'data_ops'`);
t.check("deny wins: adding a denying function takes commercial away again",
  (await countAs(db, staff.userA, "programs")) === 0);

process.exit(t.report().failed ? 1 : 0);
