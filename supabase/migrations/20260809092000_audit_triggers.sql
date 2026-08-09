-- =============================================================================
-- Audit triggers. SPEC.md section 3 and section 8.
--
-- Every create, update and delete is logged with actor, timestamp, and before
-- and after values. Built into the write path rather than added later, and
-- populated by trigger rather than by application code, so a write that forgets
-- to audit itself is not possible.
--
-- The actor comes from a session variable the route sets, not from auth.uid().
-- Client-facing routes run under the service role and have no database identity
-- at all, so auth.uid() is null for exactly the writes that matter most.
--
-- audit_events gets no trigger of its own. Auditing the audit table recurses.
--
-- Re-runnable: triggers are dropped before being created.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Setting the actor
--
-- A route calls this once, before it writes. `true` scopes the setting to the
-- current transaction, so it cannot leak into the next request on a pooled
-- connection.
-- -----------------------------------------------------------------------------

create or replace function public.set_actor(
  p_actor_type text,
  p_actor_id uuid default null,
  p_actor_contact_id uuid default null
)
returns void
language plpgsql
as $$
begin
  if p_actor_type not in ('staff', 'client_contact', 'system') then
    raise exception 'Unknown actor type: %', p_actor_type;
  end if;

  perform set_config('app.actor_type', p_actor_type, true);
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  perform set_config('app.actor_contact_id', coalesce(p_actor_contact_id::text, ''), true);
end;
$$;

comment on function public.set_actor(text, uuid, uuid) is
  'Call before writing. Transaction-scoped, so it cannot leak across pooled requests. SPEC.md section 3.';


-- -----------------------------------------------------------------------------
-- Redaction
--
-- A bearer token copied into audit_events is a bearer token in a table that
-- more people can read than can read the original. CLAUDE.md hard rule 7: never
-- write a token anywhere it does not need to be.
-- -----------------------------------------------------------------------------

create or replace function public.redact_secrets(p_row jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    (
      select jsonb_object_agg(
        key,
        case
          when key in ('dashboard_token', 'token_hash') and value <> 'null'::jsonb
            then '"[redacted]"'::jsonb
          else value
        end
      )
      from jsonb_each(p_row)
    ),
    p_row
  )
$$;


-- -----------------------------------------------------------------------------
-- The trigger
-- -----------------------------------------------------------------------------

create or replace function public.record_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_type       text;
  v_actor_id         uuid;
  v_actor_contact_id uuid;
  v_before           jsonb;
  v_after            jsonb;
  v_record_id        uuid;
begin
  -- The session variable the route set, if it set one.
  v_actor_type := nullif(current_setting('app.actor_type', true), '');
  v_actor_id := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_actor_contact_id := nullif(current_setting('app.actor_contact_id', true), '')::uuid;

  -- Fall back to the signed-in staff member, then to system. A write is never
  -- recorded with no actor at all: an unattributed audit row is barely better
  -- than no audit row.
  if v_actor_type is null then
    if auth.uid() is not null then
      v_actor_type := 'staff';
      v_actor_id := auth.uid();
    else
      v_actor_type := 'system';
    end if;
  end if;

  -- Keep the actor columns consistent with the type, matching the check
  -- constraint on audit_events.
  if v_actor_type = 'staff' then
    v_actor_contact_id := null;
  elsif v_actor_type = 'client_contact' then
    v_actor_id := null;
  else
    v_actor_id := null;
    v_actor_contact_id := null;
  end if;

  if tg_op <> 'INSERT' then
    v_before := public.redact_secrets(to_jsonb(old));
  end if;
  if tg_op <> 'DELETE' then
    v_after := public.redact_secrets(to_jsonb(new));
  end if;

  v_record_id := coalesce(v_after ->> 'id', v_before ->> 'id')::uuid;

  insert into public.audit_events (
    actor_type, actor_id, actor_contact_id,
    action, table_name, record_id, before, after, occurred_at
  )
  values (
    v_actor_type, v_actor_id, v_actor_contact_id,
    lower(tg_op), tg_table_name, v_record_id, v_before, v_after,
    -- clock_timestamp(), not now(). now() is the transaction start time, so
    -- every row written in one transaction would share a timestamp and the
    -- order of events inside it would be lost.
    clock_timestamp()
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.record_audit_event() is
  'Writes one audit_events row per create, update or delete. SECURITY DEFINER so it can write even where the actor cannot read audit_events.';


-- -----------------------------------------------------------------------------
-- Append-only enforcement
--
-- SPEC.md section 3: update and delete revoked at database level. The revoke in
-- the row level security migration stops the application roles. This trigger
-- stops everyone else as well, including the service role and the table owner,
-- for whom a revoke does nothing.
-- -----------------------------------------------------------------------------

create or replace function public.audit_events_are_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'audit_events is append-only: % is not permitted', tg_op
    using hint = 'Correct the record, do not rewrite its history.';
end;
$$;

drop trigger if exists audit_events_no_update on public.audit_events;
create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function public.audit_events_are_append_only();

drop trigger if exists audit_events_no_delete on public.audit_events;
create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function public.audit_events_are_append_only();

-- TRUNCATE is not a DELETE and does not fire row triggers. Without this, the
-- whole trail could be emptied in one statement while the other two guards
-- looked like they were doing their job.
drop trigger if exists audit_events_no_truncate on public.audit_events;
create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function public.audit_events_are_append_only();


-- -----------------------------------------------------------------------------
-- Attach to every table except audit_events
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'organisations',
    'users',
    'onboarding_templates',
    'onboarding_template_fields',
    'programs',
    'program_assignments',
    'program_role_resolutions',
    'client_contacts',
    'onboarding_responses',
    'client_link_requests',
    'client_sessions',
    'companies',
    'contacts',
    'engagement_events'
  ]
  loop
    execute format('drop trigger if exists record_audit on public.%I', t);
    execute format(
      'create trigger record_audit
         after insert or update or delete on public.%I
         for each row execute function public.record_audit_event()', t);
  end loop;
end;
$$;
