-- =============================================================================
-- Row level security test. Run this in the Supabase SQL editor.
--
-- Prints one row per case with PASS or FAIL, including every case that is
-- supposed to be denied. A policy that is too generous and a policy that is too
-- strict both show up here.
--
-- It impersonates each role the way Supabase does at run time: by setting the
-- Postgres role to `authenticated` and putting a user id into the JWT claim
-- that auth.uid() reads. No real auth users are created.
--
-- It creates a handful of fixtures with names beginning "ZZ Test" and deletes
-- them again at the end. If the audit trigger migration is already applied, the
-- audit rows those fixtures generated will remain, because audit_events is
-- append-only. That is correct behaviour, not residue.
-- =============================================================================

create or replace function pg_temp.rls_test()
returns table (area text, scenario text, expected text, actual text, result text)
language plpgsql
as $$
declare
  v_admin      uuid := '00000000-0000-4000-a000-000000000001';
  v_lead       uuid := '00000000-0000-4000-a000-000000000002';
  v_delivery   uuid := '00000000-0000-4000-a000-000000000003';
  v_specialist uuid := '00000000-0000-4000-a000-000000000004';
  v_stranger   uuid := '00000000-0000-4000-a000-000000000005';
  v_dataops    uuid := '00000000-0000-4000-a000-000000000006';

  v_org_a uuid;
  v_org_b uuid;
  v_prog1 uuid;

  v_case   jsonb;
  v_cases  jsonb;
  v_actual text;
  v_who    uuid;
begin
  ---------------------------------------------------------------------------
  -- Fixtures. Created as the current (privileged) role, before any switch.
  ---------------------------------------------------------------------------
  insert into public.users (id, full_name, email, role) values
    (v_admin,      'ZZ Test Admin',      'zz-admin@example.test',      'admin'),
    (v_lead,       'ZZ Test Lead',       'zz-lead@example.test',       'engagement_lead'),
    (v_delivery,   'ZZ Test Delivery',   'zz-delivery@example.test',   'delivery_lead'),
    (v_specialist, 'ZZ Test Specialist', 'zz-specialist@example.test', 'specialist'),
    (v_stranger,   'ZZ Test Stranger',   'zz-stranger@example.test',   'specialist'),
    (v_dataops,    'ZZ Test DataOps',    'zz-dataops@example.test',    'data_ops');

  insert into public.organisations (name, slug, vertical, sub_vertical)
    values ('ZZ Test Org A', 'zz-test-org-a', 'b2b_tech', 'cybersecurity')
    returning id into v_org_a;
  insert into public.organisations (name, slug, vertical)
    values ('ZZ Test Org B', 'zz-test-org-b', 'law_firms')
    returning id into v_org_b;

  insert into public.programs (organisation_id, name, slug, type)
    values (v_org_a, 'ZZ Test Programme 1', 'zz-test-1', 'event')
    returning id into v_prog1;
  insert into public.programs (organisation_id, name, slug, type)
    values (v_org_a, 'ZZ Test Programme 2', 'zz-test-2', 'retainer');
  insert into public.programs (organisation_id, name, slug, type)
    values (v_org_b, 'ZZ Test Programme 3', 'zz-test-3', 'event');

  insert into public.program_assignments (program_id, user_id, role_on_program) values
    (v_prog1, v_delivery,   'delivery_lead'),
    (v_prog1, v_specialist, 'specialist');

  insert into public.companies (name) values ('ZZ Test Company');
  insert into public.contacts (email, first_name)
    values ('zz-contact@example.test', 'ZZ Test Contact');

  ---------------------------------------------------------------------------
  -- Cases. `who` null means anonymous.
  ---------------------------------------------------------------------------
  v_cases := jsonb_build_array(
    -- anonymous sees nothing, anywhere
    jsonb_build_object('area','anon','who','none','scenario','anon reads organisations',
      'sql','select count(*)::text from public.organisations','expect','DENIED'),
    jsonb_build_object('area','anon','who','none','scenario','anon reads programs',
      'sql','select count(*)::text from public.programs','expect','DENIED'),
    jsonb_build_object('area','anon','who','none','scenario','anon reads contacts',
      'sql','select count(*)::text from public.contacts','expect','DENIED'),
    jsonb_build_object('area','anon','who','none','scenario','anon reads audit_events',
      'sql','select count(*)::text from public.audit_events','expect','DENIED'),

    -- leads see everything
    jsonb_build_object('area','programs','who','admin','scenario','admin sees all 3 programmes',
      'sql','select count(*)::text from public.programs where name like ''ZZ Test%''','expect','3'),
    jsonb_build_object('area','programs','who','lead','scenario','engagement_lead sees all 3 programmes',
      'sql','select count(*)::text from public.programs where name like ''ZZ Test%''','expect','3'),
    jsonb_build_object('area','organisations','who','admin','scenario','admin sees both organisations',
      'sql','select count(*)::text from public.organisations where name like ''ZZ Test%''','expect','2'),

    -- assignment-scoped roles
    jsonb_build_object('area','programs','who','delivery','scenario','delivery_lead sees only their assigned programme',
      'sql','select count(*)::text from public.programs where name like ''ZZ Test%''','expect','1'),
    jsonb_build_object('area','programs','who','specialist','scenario','specialist sees only their assigned programme',
      'sql','select count(*)::text from public.programs where name like ''ZZ Test%''','expect','1'),
    jsonb_build_object('area','programs','who','stranger','scenario','unassigned specialist sees no programmes',
      'sql','select count(*)::text from public.programs where name like ''ZZ Test%''','expect','0'),
    jsonb_build_object('area','organisations','who','delivery','scenario','delivery_lead sees only the org of their programme',
      'sql','select count(*)::text from public.organisations where name like ''ZZ Test%''','expect','1'),
    jsonb_build_object('area','organisations','who','stranger','scenario','unassigned specialist sees no organisations',
      'sql','select count(*)::text from public.organisations where name like ''ZZ Test%''','expect','0'),

    -- data_ops: audience yes, programmes no, restricted view yes
    jsonb_build_object('area','data_ops','who','dataops','scenario','data_ops cannot read the programs table',
      'sql','select count(*)::text from public.programs where name like ''ZZ Test%''','expect','0'),
    jsonb_build_object('area','data_ops','who','dataops','scenario','data_ops cannot read the organisations table',
      'sql','select count(*)::text from public.organisations where name like ''ZZ Test%''','expect','0'),
    jsonb_build_object('area','data_ops','who','dataops','scenario','data_ops sees programmes through the restricted view',
      'sql','select count(*)::text from public.programs_restricted where name like ''ZZ Test%''','expect','3'),
    jsonb_build_object('area','data_ops','who','dataops','scenario','restricted view exposes no dashboard_token column',
      'sql','select count(*)::text from information_schema.columns where table_name=''programs_restricted'' and column_name in (''dashboard_token'',''currency'',''approver_email'')','expect','0'),
    jsonb_build_object('area','data_ops','who','dataops','scenario','data_ops reads contacts',
      'sql','select count(*)::text from public.contacts where email like ''zz-%''','expect','1'),
    jsonb_build_object('area','data_ops','who','dataops','scenario','data_ops reads companies',
      'sql','select count(*)::text from public.companies where name like ''ZZ Test%''','expect','1'),

    -- the restricted view is not a back door for anyone else
    jsonb_build_object('area','data_ops','who','stranger','scenario','non data_ops gets nothing from the restricted view',
      'sql','select count(*)::text from public.programs_restricted where name like ''ZZ Test%''','expect','0'),

    -- audience database is not open to programme roles
    jsonb_build_object('area','audience','who','delivery','scenario','delivery_lead cannot read contacts',
      'sql','select count(*)::text from public.contacts where email like ''zz-%''','expect','0'),
    jsonb_build_object('area','audience','who','specialist','scenario','specialist cannot read companies',
      'sql','select count(*)::text from public.companies where name like ''ZZ Test%''','expect','0'),

    -- writes
    jsonb_build_object('area','writes','who','specialist','scenario','specialist cannot create an organisation',
      'sql','insert into public.organisations (name,slug,vertical) values (''ZZ Test Sneak'',''zz-test-sneak'',''b2b_tech'') returning ''1''','expect','DENIED'),
    jsonb_build_object('area','writes','who','delivery','scenario','delivery_lead cannot create a programme',
      'sql','insert into public.programs (organisation_id,name,slug,type) values ('''||v_org_a||''',''ZZ Test Sneak'',''zz-sneak'',''event'') returning ''1''','expect','DENIED'),
    jsonb_build_object('area','writes','who','stranger','scenario','unassigned specialist cannot edit a programme they cannot see',
      'sql','with u as (update public.programs set name=''hacked'' where id='''||v_prog1||''' returning 1) select count(*)::text from u','expect','0'),
    jsonb_build_object('area','writes','who','admin','scenario','admin can create an organisation',
      'sql','insert into public.organisations (name,slug,vertical) values (''ZZ Test Admin Made'',''zz-test-admin-made'',''b2b_tech'') returning ''1''','expect','1'),

    -- the restricted views, probed the way an attacker would
    jsonb_build_object('area','views','who','none','scenario','anon cannot read programs_restricted',
      'sql','select count(*)::text from public.programs_restricted','expect','DENIED'),
    jsonb_build_object('area','views','who','none','scenario','anon cannot read organisations_restricted',
      'sql','select count(*)::text from public.organisations_restricted','expect','DENIED'),
    jsonb_build_object('area','views','who','specialist','scenario','error-oracle through programs_restricted leaks nothing',
      'sql','select count(*)::text from (select 1 from public.programs_restricted where 1 / (case when name like ''ZZ Test%'' then 0 else 1 end) = 1) x','expect','0'),
    jsonb_build_object('area','views','who','specialist','scenario','error-oracle through organisations_restricted leaks nothing',
      'sql','select count(*)::text from (select 1 from public.organisations_restricted where 1 / (case when name like ''ZZ Test%'' then 0 else 1 end) = 1) x','expect','0'),
    jsonb_build_object('area','views','who','admin','scenario','both restricted views are marked security_barrier',
      'sql','select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=''public'' and c.relname like ''%_restricted'' and ''security_barrier=true'' = any(c.reloptions)','expect','2'),
    jsonb_build_object('area','views','who','specialist','scenario','restricted view returns no rows to a non data_ops role',
      'sql','select count(*)::text from public.organisations_restricted where name like ''ZZ Test%''','expect','0'),

    -- audit visibility
    jsonb_build_object('area','audit','who','admin','scenario','admin can read audit_events',
      'sql','select case when count(*) >= 0 then ''readable'' end from public.audit_events','expect','readable'),
    jsonb_build_object('area','audit','who','specialist','scenario','specialist sees no audit_events',
      'sql','select count(*)::text from public.audit_events','expect','0')
  );

  ---------------------------------------------------------------------------
  -- Run them
  ---------------------------------------------------------------------------
  for v_case in select * from jsonb_array_elements(v_cases)
  loop
    v_who := case v_case ->> 'who'
      when 'admin' then v_admin
      when 'lead' then v_lead
      when 'delivery' then v_delivery
      when 'specialist' then v_specialist
      when 'stranger' then v_stranger
      when 'dataops' then v_dataops
      else null
    end;

    begin
      if v_who is null then
        perform set_config('request.jwt.claims', '', true);
        execute 'set local role anon';
      else
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
      end if;

      execute (v_case ->> 'sql') into v_actual;
      v_actual := coalesce(v_actual, '0');
    exception
      when insufficient_privilege then v_actual := 'DENIED';
      when others then v_actual := 'DENIED';
    end;

    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    area := v_case ->> 'area';
    scenario := v_case ->> 'scenario';
    expected := v_case ->> 'expect';
    actual := v_actual;
    result := case when v_actual = (v_case ->> 'expect') then 'PASS' else 'FAIL' end;
    return next;
  end loop;

  ---------------------------------------------------------------------------
  -- Clean up, in dependency order.
  ---------------------------------------------------------------------------
  delete from public.program_assignments
    where program_id in (select id from public.programs where name like 'ZZ Test%');
  delete from public.programs where name like 'ZZ Test%';
  delete from public.organisations where name like 'ZZ Test%';
  delete from public.contacts where email like 'zz-%@example.test';
  delete from public.companies where name like 'ZZ Test%';
  delete from public.users where email like 'zz-%@example.test';
end;
$$;

select * from pg_temp.rls_test();
