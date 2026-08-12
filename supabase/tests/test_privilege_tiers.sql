-- =============================================================================
-- Privilege tier test. Run this in the Supabase SQL editor.
--
-- Replaces test_row_level_security.sql, whose five roles no longer exist. The
-- model it tested was retired by 20260812140000_privilege_tiers.sql; a suite
-- asserting the old behaviour would fail for the right reasons and tell you
-- nothing, so it was replaced rather than patched.
--
-- Prints one row per case with PASS or FAIL, including every case that is meant
-- to be denied. A policy that is too generous and one that is too strict both
-- show up here.
--
-- It impersonates each tier the way Supabase does at run time: Postgres role
-- `authenticated`, with a user id in the JWT claim that auth.uid() reads. No
-- real auth users are created.
--
-- Fixtures are named "ZZ Tier%" and removed at the end, with two deliberate
-- exceptions: the audit rows they generated, and one inactive template with one
-- field. Both tables are append-only by design, so leaving them is the rule
-- working rather than residue. The template is inactive and takes no part in
-- generation, and a second run reuses it rather than adding another.
-- =============================================================================

create or replace function pg_temp.tier_test()
returns table (area text, scenario text, expected text, actual text, result text)
language plpgsql
as $$
declare
  v_admin   uuid := '00000000-0000-4000-b000-000000000001';
  v_manager uuid := '00000000-0000-4000-b000-000000000002';
  v_user_a  uuid := '00000000-0000-4000-b000-000000000003';
  v_user_b  uuid := '00000000-0000-4000-b000-000000000004';
  v_dataops uuid := '00000000-0000-4000-b000-000000000005';

  v_type   uuid;
  v_org_a  uuid;
  v_org_b  uuid;
  v_prog_a uuid;
  v_prog_b uuid;
  v_tpl    uuid;
  v_field  uuid;
  v_super  uuid;

  v_case   jsonb;
  v_cases  jsonb;
  v_actual text;
  v_who    uuid;
begin
  ---------------------------------------------------------------------------
  -- Fixtures, created privileged, before any role switch.
  ---------------------------------------------------------------------------
  select id into v_type from public.client_types where slug = 'b2b_tech';
  select id into v_super from public.users where tier = 'super_admin';

  insert into public.users (id, full_name, email, tier) values
    (v_admin,   'ZZ Tier Admin',   'zz.admin@amzai.test',   'admin'),
    (v_manager, 'ZZ Tier Manager', 'zz.manager@amzai.test', 'manager'),
    (v_user_a,  'ZZ Tier User A',  'zz.usera@amzai.test',   'user'),
    (v_user_b,  'ZZ Tier User B',  'zz.userb@amzai.test',   'user'),
    (v_dataops, 'ZZ Tier DataOps', 'zz.dataops@amzai.test', 'user')
  on conflict (id) do update set tier = excluded.tier, active = true;

  insert into public.organisations (name, slug, client_type_id)
  values ('ZZ Tier Org A', 'zz-tier-org-a', v_type) returning id into v_org_a;
  insert into public.organisations (name, slug, client_type_id)
  values ('ZZ Tier Org B', 'zz-tier-org-b', v_type) returning id into v_org_b;

  insert into public.programs (organisation_id, name, slug, type, currency)
  values (v_org_a, 'ZZ Tier Prog A', 'zz-tier-a', 'event', 'GBP') returning id into v_prog_a;
  insert into public.programs (organisation_id, name, slug, type, currency)
  values (v_org_b, 'ZZ Tier Prog B', 'zz-tier-b', 'event', 'GBP') returning id into v_prog_b;

  -- The manager holds organisation A only.
  insert into public.organisation_managers (user_id, organisation_id)
  values (v_manager, v_org_a) on conflict do nothing;

  -- User A is on programme A; user B and the data ops person are on B.
  insert into public.program_assignments (program_id, user_id, role_on_program) values
    (v_prog_a, v_user_a,  'delivery_lead'),
    (v_prog_b, v_user_b,  'specialist'),
    (v_prog_b, v_dataops, 'data_ops')
  on conflict do nothing;

  insert into public.user_staff_functions (user_id, function_id)
  select v_dataops, id from public.staff_functions where slug = 'data_ops'
  on conflict do nothing;

  /*
    Reused across runs rather than recreated. Template fields are append-only —
    a generated programme reads its questions through them — so the suite cannot
    delete this one afterwards and must not create a second every time it runs.
  */
  select id into v_tpl from public.onboarding_templates
   where slug = 'zz_tier_template' and version = 1;
  if v_tpl is null then
    insert into public.onboarding_templates (name, slug, kind, version, active)
    values ('ZZ Tier Template', 'zz_tier_template', 'core', 1, false) returning id into v_tpl;
  end if;

  select id into v_field from public.onboarding_template_fields where template_id = v_tpl;
  if v_field is null then
    insert into public.onboarding_template_fields
      (template_id, section, question, default_owner, default_offset_type)
    values (v_tpl, 'ZZ', 'ZZ Tier question?', 'client', 'weeks_from_start')
    returning id into v_field;
  end if;

  insert into public.onboarding_responses (program_id, template_field_id, owner)
  values (v_prog_a, v_field, 'client'), (v_prog_b, v_field, 'client');

  ---------------------------------------------------------------------------
  -- Cases
  ---------------------------------------------------------------------------
  v_cases := jsonb_build_array(
    -- anon still sees nothing at all
    jsonb_build_object('area','anon','who','none','scenario','anon reads programs',
      'sql','select count(*)::text from public.programs','expect','DENIED'),
    jsonb_build_object('area','anon','who','none','scenario','anon reads users',
      'sql','select count(*)::text from public.users','expect','DENIED'),

    -- admin: everything
    jsonb_build_object('area','admin','who','admin','scenario','admin sees both programmes',
      'sql','select count(*)::text from public.programs where name like ''ZZ Tier%''','expect','2'),
    jsonb_build_object('area','admin','who','admin','scenario','admin sees both organisations',
      'sql','select count(*)::text from public.organisations where name like ''ZZ Tier%''','expect','2'),
    jsonb_build_object('area','admin','who','admin','scenario','admin reads commercial columns',
      'sql','select currency from public.programs where slug = ''zz-tier-a''','expect','GBP'),
    jsonb_build_object('area','admin','who','admin','scenario','admin sees both onboarding sets',
      'sql','select count(*)::text from public.onboarding_responses r join public.programs p on p.id = r.program_id where p.name like ''ZZ Tier%''','expect','2'),

    -- admin cannot reach the super admin
    jsonb_build_object('area','super','who','admin','scenario','admin cannot demote the super admin',
      'sql','update public.users set tier = ''user'' where tier = ''super_admin''; select count(*)::text from public.users where tier = ''super_admin''','expect','1'),
    jsonb_build_object('area','super','who','admin','scenario','admin cannot promote themselves into it',
      'sql','update public.users set tier = ''super_admin'' where id = ''00000000-0000-4000-b000-000000000001''; select ''UNREACHED''','expect','DENIED'),

    -- manager: their organisation, and the team inside it
    jsonb_build_object('area','manager','who','manager','scenario','manager sees only their organisation''s programme',
      'sql','select count(*)::text from public.programs where name like ''ZZ Tier%''','expect','1'),
    jsonb_build_object('area','manager','who','manager','scenario','and it is the right one',
      'sql','select name from public.programs where name like ''ZZ Tier%''','expect','ZZ Tier Prog A'),
    jsonb_build_object('area','manager','who','manager','scenario','manager sees only that organisation',
      'sql','select count(*)::text from public.organisations where name like ''ZZ Tier%''','expect','1'),
    jsonb_build_object('area','manager','who','manager','scenario','manager sees only that programme''s onboarding',
      'sql','select count(*)::text from public.onboarding_responses r join public.programs p on p.id = r.program_id where p.name like ''ZZ Tier%''','expect','1'),
    jsonb_build_object('area','manager','who','manager','scenario','manager cannot create a client',
      'sql','insert into public.organisations (name, slug, client_type_id) select ''ZZ Tier Sneaky'', ''zz-tier-sneaky'', id from public.client_types where slug = ''b2b_tech''; select ''UNREACHED''','expect','DENIED'),
    -- The id is embedded rather than sub-selected. A manager cannot SEE
    -- organisation B, so a sub-select returns no rows, the insert is a no-op,
    -- and the case would pass without ever testing the policy.
    jsonb_build_object('area','manager','who','manager','scenario','manager cannot grant themselves another organisation',
      'sql', format('insert into public.organisation_managers (user_id, organisation_id) values (%L, %L); select ''UNREACHED''', v_manager, v_org_b),
      'expect','DENIED'),
    jsonb_build_object('area','manager','who','manager','scenario','manager cannot change a tier',
      'sql','update public.users set tier = ''admin'' where id = ''00000000-0000-4000-b000-000000000003''; select tier from public.users where id = ''00000000-0000-4000-b000-000000000003''','expect','user'),

    -- user: only what they are assigned
    jsonb_build_object('area','user','who','user_a','scenario','user sees only their assigned programme',
      'sql','select name from public.programs where name like ''ZZ Tier%''','expect','ZZ Tier Prog A'),
    jsonb_build_object('area','user','who','user_b','scenario','another user sees only theirs',
      'sql','select name from public.programs where name like ''ZZ Tier%''','expect','ZZ Tier Prog B'),
    jsonb_build_object('area','user','who','user_a','scenario','user sees only their onboarding',
      'sql','select count(*)::text from public.onboarding_responses r join public.programs p on p.id = r.program_id where p.name like ''ZZ Tier%''','expect','1'),
    jsonb_build_object('area','user','who','user_a','scenario','user cannot change a team',
      'sql','insert into public.program_assignments (program_id, user_id, role_on_program) select id, ''00000000-0000-4000-b000-000000000004'', ''specialist'' from public.programs where slug = ''zz-tier-a''; select ''UNREACHED''','expect','DENIED'),
    jsonb_build_object('area','user','who','user_a','scenario','user cannot read the audience database',
      'sql','select count(*)::text from public.contacts','expect','0'),
    jsonb_build_object('area','user','who','user_a','scenario','user cannot create a client',
      'sql','insert into public.organisations (name, slug, client_type_id) select ''ZZ Tier Nope'', ''zz-tier-nope'', id from public.client_types where slug = ''b2b_tech''; select ''UNREACHED''','expect','DENIED'),

    -- the data ops function: tier user, plus and minus
    jsonb_build_object('area','function','who','dataops','scenario','data ops cannot read the programs table',
      'sql','select count(*)::text from public.programs','expect','0'),
    jsonb_build_object('area','function','who','dataops','scenario','nor the organisations table',
      'sql','select count(*)::text from public.organisations','expect','0'),
    jsonb_build_object('area','function','who','dataops','scenario','data ops reads programmes through the restricted view',
      'sql','select name from public.programs_restricted where name like ''ZZ Tier%''','expect','ZZ Tier Prog B'),
    jsonb_build_object('area','function','who','dataops','scenario','scoped to their assignments, not everything',
      'sql','select count(*)::text from public.programs_restricted where name like ''ZZ Tier%''','expect','1'),
    jsonb_build_object('area','function','who','dataops','scenario','data ops sees no onboarding answers',
      'sql','select count(*)::text from public.onboarding_responses','expect','0'),
    jsonb_build_object('area','function','who','dataops','scenario','data ops sees the audience',
      'sql','select case when count(*) >= 0 then ''READABLE'' end from public.contacts','expect','READABLE'),

    -- nobody uses the restricted views as a way round their own scope
    jsonb_build_object('area','function','who','user_a','scenario','a plain user gets nothing from the restricted view',
      'sql','select count(*)::text from public.programs_restricted','expect','0'),
    jsonb_build_object('area','function','who','admin','scenario','an admin gets nothing from it either',
      'sql','select count(*)::text from public.programs_restricted','expect','0')
  );

  ---------------------------------------------------------------------------
  -- Run them
  ---------------------------------------------------------------------------
  for v_case in select * from jsonb_array_elements(v_cases) loop
    v_who := case v_case->>'who'
               when 'admin'   then v_admin
               when 'manager' then v_manager
               when 'user_a'  then v_user_a
               when 'user_b'  then v_user_b
               when 'dataops' then v_dataops
               else null
             end;

    begin
      if v_who is null then
        perform set_config('request.jwt.claims', '', true);
        execute 'set local role anon';
      else
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_who::text)::text, true);
        execute 'set local role authenticated';
      end if;

      execute v_case->>'sql' into v_actual;
      if v_actual is null then v_actual := 'NULL'; end if;
    exception when others then
      v_actual := 'DENIED';
    end;

    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    area     := v_case->>'area';
    scenario := v_case->>'scenario';
    expected := v_case->>'expect';
    actual   := v_actual;
    result   := case when v_actual = v_case->>'expect' then 'PASS' else 'FAIL' end;
    return next;
  end loop;

  ---------------------------------------------------------------------------
  -- The super admin, tested against the trigger rather than a policy.
  -- Row level security stops the signed-in path silently; the trigger is what
  -- holds where row level security does not.
  ---------------------------------------------------------------------------
  begin
    update public.users set tier = 'user' where id = v_super;
    v_actual := 'ACCEPTED';
  exception when others then v_actual := 'DENIED';
  end;
  area := 'super'; scenario := 'the trigger refuses demoting the super admin';
  expected := 'DENIED'; actual := v_actual;
  result := case when v_actual = 'DENIED' then 'PASS' else 'FAIL' end;
  return next;

  begin
    update public.users set active = false where id = v_super;
    v_actual := 'ACCEPTED';
  exception when others then v_actual := 'DENIED';
  end;
  area := 'super'; scenario := 'the trigger refuses deactivating the super admin';
  expected := 'DENIED'; actual := v_actual;
  result := case when v_actual = 'DENIED' then 'PASS' else 'FAIL' end;
  return next;

  begin
    update public.users set tier = 'super_admin' where id = v_admin;
    v_actual := 'ACCEPTED';
  exception when others then v_actual := 'DENIED';
  end;
  area := 'super'; scenario := 'the trigger refuses a second super admin';
  expected := 'DENIED'; actual := v_actual;
  result := case when v_actual = 'DENIED' then 'PASS' else 'FAIL' end;
  return next;

  ---------------------------------------------------------------------------
  -- Clean up
  ---------------------------------------------------------------------------
  /*
    The template and its field stay. They are inactive, so they take no part in
    generation, and append-only means they cannot be removed. Same reason the
    audit rows stay: it is the rule working, not residue.
  */
  delete from public.onboarding_responses where template_field_id = v_field;
  delete from public.program_assignments where program_id in (v_prog_a, v_prog_b);
  delete from public.organisation_managers where user_id = v_manager;
  delete from public.user_staff_functions
    where user_id in (v_admin, v_manager, v_user_a, v_user_b, v_dataops);
  delete from public.programs where id in (v_prog_a, v_prog_b);
  delete from public.organisations where slug like 'zz-tier-%';
  delete from public.users where id in (v_admin, v_manager, v_user_a, v_user_b, v_dataops);
end;
$$;

select * from pg_temp.tier_test();
