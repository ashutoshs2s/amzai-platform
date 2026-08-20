-- =============================================================================
-- One row per (answer, template) that has generated, replacing a boolean.
--
-- onboarding_responses.tasks_generated was a single flag for a set of facts.
-- Once a question produced any task at all the flag was true, and a template
-- authored afterwards could never fire for that answer — no dance recovered it.
--
-- Authoring templates as work is understood is the normal way this product is
-- used, not an edge case, so the guard has to be per pair.
--
-- The unique constraint below is the guard. Not a convention: a second attempt
-- for the same pair cannot be written, by the trigger, by a backfill, or by a
-- statement run by hand.
-- =============================================================================

create table if not exists public.task_generations (
  id               uuid primary key default gen_random_uuid(),
  response_id      uuid not null references public.onboarding_responses (id) on delete cascade,
  task_template_id uuid not null references public.task_templates (id) on delete cascade,
  generated_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint task_generations_pair_unique unique (response_id, task_template_id)
);

create index if not exists task_generations_response_idx
  on public.task_generations (response_id);

comment on table public.task_generations is
  'One row per answer and template that has generated. The unique pair is what stops a template firing twice for the same answer, and what lets a template authored later fire once.';

/*
  Existing tasks, so nothing already generated fires again.

  A task whose template was HARD deleted has a null source_task_template_id and
  cannot be reconstructed here; that template would fire again. The application
  only ever deactivates a template, so this is theoretical — but it is the one
  hole in this backfill and it is better written down than discovered.
*/
insert into public.task_generations (response_id, task_template_id, generated_at)
select t.source_response_id, t.source_task_template_id, min(t.created_at)
from public.tasks t
where t.source = 'onboarding'
  and t.source_response_id is not null
  and t.source_task_template_id is not null
group by t.source_response_id, t.source_task_template_id
on conflict (response_id, task_template_id) do nothing;

alter table public.task_generations enable row level security;
grant select, insert, update, delete on public.task_generations to authenticated;
grant all privileges on public.task_generations to service_role;
revoke all on public.task_generations from anon;

drop policy if exists task_generations_select on public.task_generations;
create policy task_generations_select on public.task_generations
  for select to authenticated using ((select public.is_staff()));

drop policy if exists task_generations_write on public.task_generations;
create policy task_generations_write on public.task_generations
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

do $$
begin
  execute 'drop trigger if exists set_updated_at on public.task_generations';
  execute 'create trigger set_updated_at before update on public.task_generations
             for each row execute function public.set_updated_at()';
  execute 'drop trigger if exists record_audit on public.task_generations';
  execute 'create trigger record_audit after insert or update or delete
             on public.task_generations
             for each row execute function public.record_audit_event()';
end;
$$;


-- -----------------------------------------------------------------------------
-- The trigger, asking the table instead of the flag
--
-- Two changes beyond swapping the guard.
--
-- The insert and its generation rows are one data-modifying statement, so a
-- task cannot exist without the row that records it, or the reverse.
--
-- Generation and staleness are now SEQUENTIAL rather than exclusive. Once an
-- answer can generate while it already holds tasks, an update that both adds
-- work and changes the answer has to do both. Staleness gained a sharper
-- condition to make that safe: a task is flagged only where the answer it was
-- built from differs from the answer as it now stands, so a task created
-- moments earlier in the same statement cannot flag itself. That removes the
-- ordering hazard rather than working around it.
-- -----------------------------------------------------------------------------

create or replace function public.tasks_from_approved_answer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    with fired as (
      insert into public.tasks (
        program_id, title, detail, assignee_id, role_on_program, due_date,
        blocking, source, source_response_id, source_task_template_id, source_answer
      )
      select
        new.program_id,
        t.title,
        t.detail,
        -- Never broken by a guess. SPEC.md 4.3.
        public.sole_holder_of(new.program_id, t.default_assignee_role),
        t.default_assignee_role,
        public.task_due_date(new.program_id, t.default_offset_type, t.default_offset_value),
        t.blocking,
        'onboarding',
        new.id,
        t.id,
        new.response
      from public.task_templates t
      where t.template_field_id = new.template_field_id
        and t.active
        and not exists (
          select 1 from public.task_generations g
          where g.response_id = new.id and g.task_template_id = t.id
        )
      order by t.sort_order
      returning source_task_template_id
    )
    insert into public.task_generations (response_id, task_template_id)
    select new.id, source_task_template_id from fired;
  end if;

  /*
    The answer moved after work was built from it. Flag, never rewrite, and
    never touch the answer itself. SPEC.md section 8.

    Cancelled tasks are left alone — somebody already decided they do not apply.
    Completed ones are not: work done against an answer that has since changed
    is exactly what somebody needs to know about.
  */
  if new.response is distinct from old.response then
    update public.tasks
    set stale_since = clock_timestamp(),
        stale_reason = 'The answer this was built from has changed.'
    where source_response_id = new.id
      and stale_since is null
      and status <> 'cancelled'
      and source_answer is distinct from new.response;

  elsif new.status is distinct from old.status and new.status <> 'approved' then
    update public.tasks
    set stale_since = clock_timestamp(),
        stale_reason = format('The answer is no longer approved; it is now %s.', new.status)
    where source_response_id = new.id
      and stale_since is null
      and status <> 'cancelled';
  end if;

  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- Firing a template authored after the answer was approved
--
-- The recommended path, and the reason the other two were not taken.
--
-- Automatically on authoring would mean one template on a core question
-- silently creating work across every approved answer in every live programme,
-- with no sense of the scale beforehand. That is what SPEC.md section 8 guards
-- against, wearing a different hat.
--
-- Only on re-approval is worse than manual: un-approving flags every existing
-- task on that answer as no longer approved, and the round trip writes a status
-- change into the audit trail that nobody meant.
--
-- So: explicit, per template, returning how many it created. The screen that
-- calls this — showing how many answers are waiting before anybody presses
-- anything — is not built yet.
--
-- SECURITY INVOKER, so row level security decides which programmes are reached:
-- an admin backfills everywhere, a manager only their own clients.
-- -----------------------------------------------------------------------------

create or replace function public.backfill_task_template(p_template_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_field   uuid;
  v_created integer;
begin
  select template_field_id into v_field
  from public.task_templates
  where id = p_template_id and active;

  if v_field is null then
    raise exception 'No active task template with that id.';
  end if;

  with fired as (
    insert into public.tasks (
      program_id, title, detail, assignee_id, role_on_program, due_date,
      blocking, source, source_response_id, source_task_template_id, source_answer
    )
    select
      r.program_id,
      t.title,
      t.detail,
      public.sole_holder_of(r.program_id, t.default_assignee_role),
      t.default_assignee_role,
      public.task_due_date(r.program_id, t.default_offset_type, t.default_offset_value),
      t.blocking,
      'onboarding',
      r.id,
      t.id,
      r.response
    from public.onboarding_responses r
    join public.task_templates t on t.id = p_template_id
    where r.template_field_id = v_field
      and r.status = 'approved'
      and not exists (
        select 1 from public.task_generations g
        where g.response_id = r.id and g.task_template_id = t.id
      )
    returning source_response_id
  ),
  logged as (
    insert into public.task_generations (response_id, task_template_id)
    select source_response_id, p_template_id from fired
    returning 1
  )
  select count(*)::int into v_created from logged;

  return v_created;
end;
$$;

comment on function public.backfill_task_template(uuid) is
  'Fires a template against answers already approved before it existed. Once per pair, ever. Returns how many tasks it created.';

revoke all on function public.backfill_task_template(uuid) from public, anon;
grant execute on function public.backfill_task_template(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- The flag it replaces
--
-- Dropped rather than kept as a derived convenience, because nothing read it:
-- not a route, not a screen, not a query outside the trigger it belonged to.
-- Keeping it would leave two representations of one fact, free to disagree —
-- and a boolean standing in for a set is the bug being fixed.
-- -----------------------------------------------------------------------------

alter table public.onboarding_responses drop column if exists tasks_generated;
