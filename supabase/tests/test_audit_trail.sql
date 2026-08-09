-- =============================================================================
-- Audit trail test. Run this in the Supabase SQL editor.
--
-- Proves three things:
--   1. an audit row appears on every create, update and delete
--   2. the actor is recorded, from the session variable a route sets
--   3. an audit row cannot be changed or deleted, by anyone
--
-- Creates fixtures named "ZZ Audit" and deletes them at the end. The audit rows
-- they produced stay, because that is the entire point of the table.
-- =============================================================================

create or replace function pg_temp.audit_test()
returns table (scenario text, expected text, actual text, result text)
language plpgsql
as $$
declare
  v_actor    uuid := '00000000-0000-4000-b000-000000000001';
  v_org      uuid;
  v_prog     uuid;
  v_contact  uuid;
  v_audit_id bigint;
  v_actual   text;
  v_count    int;
  v_row      jsonb;
begin
  perform set_config('request.jwt.claims', '', true);

  insert into public.users (id, full_name, email, role)
    values (v_actor, 'ZZ Audit Actor', 'zz-audit@example.test', 'admin');

  ---------------------------------------------------------------------------
  -- 1. Insert produces one audit row
  ---------------------------------------------------------------------------
  perform public.set_actor('staff', v_actor);
  insert into public.organisations (name, slug, vertical)
    values ('ZZ Audit Org', 'zz-audit-org', 'b2b_tech')
    returning id into v_org;

  select count(*) into v_count from public.audit_events
    where table_name = 'organisations' and record_id = v_org and action = 'insert';
  scenario := 'INSERT writes exactly one audit row';
  expected := '1'; actual := v_count::text;
  result := case when v_count = 1 then 'PASS' else 'FAIL' end;
  return next;

  select after into v_row from public.audit_events
    where record_id = v_org and action = 'insert';
  scenario := 'the inserted values are recorded in `after`';
  expected := 'ZZ Audit Org'; actual := coalesce(v_row ->> 'name', 'null');
  result := case when v_row ->> 'name' = 'ZZ Audit Org' then 'PASS' else 'FAIL' end;
  return next;

  scenario := 'the actor from set_actor() is recorded';
  select actor_id::text into v_actual from public.audit_events
    where record_id = v_org and action = 'insert';
  expected := v_actor::text; actual := coalesce(v_actual, 'null');
  result := case when v_actual = v_actor::text then 'PASS' else 'FAIL' end;
  return next;

  ---------------------------------------------------------------------------
  -- 2. Update records both sides
  ---------------------------------------------------------------------------
  update public.organisations set name = 'ZZ Audit Org Renamed' where id = v_org;

  select (before ->> 'name') || ' -> ' || (after ->> 'name') into v_actual
    from public.audit_events where record_id = v_org and action = 'update';
  scenario := 'UPDATE records before and after';
  expected := 'ZZ Audit Org -> ZZ Audit Org Renamed';
  actual := coalesce(v_actual, 'null');
  result := case when v_actual = expected then 'PASS' else 'FAIL' end;
  return next;

  ---------------------------------------------------------------------------
  -- 3. Bearer secrets are redacted, never copied into the audit trail
  ---------------------------------------------------------------------------
  insert into public.programs (organisation_id, name, slug, type, dashboard_token)
    values (v_org, 'ZZ Audit Programme', 'zz-audit-prog', 'event', 'super-secret-token')
    returning id into v_prog;

  select after ->> 'dashboard_token' into v_actual
    from public.audit_events where record_id = v_prog and action = 'insert';
  scenario := 'dashboard_token is redacted in the audit row';
  expected := '[redacted]'; actual := coalesce(v_actual, 'null');
  result := case when v_actual = '[redacted]' then 'PASS' else 'FAIL' end;
  return next;

  scenario := 'the real token is nowhere in the audit trail';
  select count(*) into v_count from public.audit_events
    where after::text like '%super-secret-token%' or before::text like '%super-secret-token%';
  expected := '0'; actual := v_count::text;
  result := case when v_count = 0 then 'PASS' else 'FAIL' end;
  return next;

  ---------------------------------------------------------------------------
  -- 4. A client contact is recorded as the actor
  ---------------------------------------------------------------------------
  insert into public.client_contacts (organisation_id, program_id, name, email)
    values (v_org, v_prog, 'ZZ Audit Contact', 'zz-audit-contact@example.test')
    returning id into v_contact;

  perform public.set_actor('client_contact', null, v_contact);
  update public.client_contacts set name = 'ZZ Audit Contact Renamed' where id = v_contact;

  select actor_type || ':' || coalesce(actor_contact_id::text, 'null') into v_actual
    from public.audit_events where record_id = v_contact and action = 'update';
  scenario := 'a client contact is recorded as the actor';
  expected := 'client_contact:' || v_contact::text;
  actual := coalesce(v_actual, 'null');
  result := case when v_actual = expected then 'PASS' else 'FAIL' end;
  return next;

  ---------------------------------------------------------------------------
  -- 5. With no actor set and no signed-in user, the row is attributed to system
  ---------------------------------------------------------------------------
  perform set_config('app.actor_type', '', true);
  perform set_config('app.actor_id', '', true);
  perform set_config('app.actor_contact_id', '', true);
  update public.organisations set trading_name = 'ZZ' where id = v_org;

  select actor_type into v_actual from public.audit_events
    where record_id = v_org and action = 'update'
    order by id desc limit 1;
  scenario := 'an unattributed write is recorded as system, never as nobody';
  expected := 'system'; actual := coalesce(v_actual, 'null');
  result := case when v_actual = 'system' then 'PASS' else 'FAIL' end;
  return next;

  ---------------------------------------------------------------------------
  -- 6. Delete records the row that went
  ---------------------------------------------------------------------------
  perform public.set_actor('staff', v_actor);
  delete from public.client_contacts where id = v_contact;

  select before ->> 'name' into v_actual from public.audit_events
    where record_id = v_contact and action = 'delete';
  scenario := 'DELETE records what was removed';
  expected := 'ZZ Audit Contact Renamed'; actual := coalesce(v_actual, 'null');
  result := case when v_actual = expected then 'PASS' else 'FAIL' end;
  return next;

  ---------------------------------------------------------------------------
  -- 7. Audit rows cannot be changed or removed
  ---------------------------------------------------------------------------
  select id into v_audit_id from public.audit_events
    where record_id = v_org and action = 'insert';

  begin
    update public.audit_events set action = 'tampered' where id = v_audit_id;
    v_actual := 'ALLOWED';
  exception when others then
    v_actual := 'BLOCKED';
  end;
  scenario := 'UPDATE on audit_events is blocked';
  expected := 'BLOCKED'; actual := v_actual;
  result := case when v_actual = 'BLOCKED' then 'PASS' else 'FAIL' end;
  return next;

  begin
    delete from public.audit_events where id = v_audit_id;
    v_actual := 'ALLOWED';
  exception when others then
    v_actual := 'BLOCKED';
  end;
  scenario := 'DELETE on audit_events is blocked';
  expected := 'BLOCKED'; actual := v_actual;
  result := case when v_actual = 'BLOCKED' then 'PASS' else 'FAIL' end;
  return next;

  begin
    truncate public.audit_events;
    v_actual := 'ALLOWED';
  exception when others then
    v_actual := 'BLOCKED';
  end;
  scenario := 'TRUNCATE on audit_events is blocked';
  expected := 'BLOCKED'; actual := v_actual;
  result := case when v_actual = 'BLOCKED' then 'PASS' else 'FAIL' end;
  return next;

  select count(*) into v_count from public.audit_events where id = v_audit_id;
  scenario := 'the audit row is still there after both attempts';
  expected := '1'; actual := v_count::text;
  result := case when v_count = 1 then 'PASS' else 'FAIL' end;
  return next;

  ---------------------------------------------------------------------------
  -- 8. No recursion: auditing does not audit itself
  ---------------------------------------------------------------------------
  select count(*) into v_count from information_schema.triggers
    where event_object_table = 'audit_events' and trigger_name = 'record_audit';
  scenario := 'audit_events carries no audit trigger of its own';
  expected := '0'; actual := v_count::text;
  result := case when v_count = 0 then 'PASS' else 'FAIL' end;
  return next;

  select count(*) into v_count from information_schema.columns
    where table_name = 'audit_events' and column_name = 'updated_at';
  scenario := 'audit_events has no updated_at';
  expected := '0'; actual := v_count::text;
  result := case when v_count = 0 then 'PASS' else 'FAIL' end;
  return next;

  ---------------------------------------------------------------------------
  -- 9. Coverage: every table that should audit, does
  ---------------------------------------------------------------------------
  select count(*) into v_count from information_schema.triggers
    where trigger_name = 'record_audit' and event_manipulation = 'INSERT';
  scenario := 'all 14 auditable tables carry the trigger';
  expected := '14'; actual := v_count::text;
  result := case when v_count = 14 then 'PASS' else 'FAIL' end;
  return next;

  ---------------------------------------------------------------------------
  -- Clean up the fixtures. Their audit rows stay, by design.
  ---------------------------------------------------------------------------
  delete from public.programs where slug = 'zz-audit-prog';
  delete from public.organisations where slug = 'zz-audit-org';
  delete from public.users where email = 'zz-audit@example.test';
end;
$$;

select * from pg_temp.audit_test();
