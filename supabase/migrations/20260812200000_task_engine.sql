-- =============================================================================
-- Delivery Operations: the task engine. SPEC.md section 2, module 3.
--
-- A task is a unit of delivery work — owner, due date, state. An onboarding
-- response is a question and its answer. One is information; the other is work
-- that follows from it, and conflating them would give four hundred tasks on
-- day one, most of them nothing to do.
--
-- So tasks come from TASK TEMPLATES attached to questions, and most questions
-- carry none. The mapping lives in rows, the same rule generation follows: no
-- route and no screen decides which question produces what work.
--
-- Nothing is seeded. A task template is a judgement about how Amzai delivers,
-- and inventing a starter set would hand the team work to unpick. The screens
-- say so plainly rather than reading as broken.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. What work a question produces
--
-- Attached to a template field, which is a specific question in a specific
-- version of a set. That is referentially exact, and it has one consequence
-- worth knowing: a workbook import that CHANGES a sheet writes new field rows,
-- and task templates do not follow to them. An unchanged sheet reuses its rows,
-- so they persist. Carrying them across a version needs a stable question key
-- and is deliberately not built yet.
-- -----------------------------------------------------------------------------

create table if not exists public.task_templates (
  id                    uuid primary key default gen_random_uuid(),
  template_field_id     uuid not null
                          references public.onboarding_template_fields (id) on delete cascade,
  title                 text not null,
  detail                text,
  /** Which job on the programme owns it. Resolved to a person at creation. */
  default_assignee_role text,
  default_offset_type   text not null default 'weeks_from_start',
  default_offset_value  integer not null default 2,
  blocking              boolean not null default false,
  sort_order            integer not null default 0,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint task_templates_title_present check (length(trim(title)) > 0),
  constraint task_templates_role_valid check (
    default_assignee_role is null
    or default_assignee_role in ('engagement_lead', 'delivery_lead', 'specialist', 'data_ops')
  ),
  constraint task_templates_offset_valid check (
    default_offset_type in ('weeks_from_start', 'days_before_milestone')
  )
);

create index if not exists task_templates_field_idx
  on public.task_templates (template_field_id) where active;

comment on table public.task_templates is
  'What work a question produces once its answer is approved. Most questions have none. Authored in the app at /question-sets, never seeded.';


-- -----------------------------------------------------------------------------
-- 2. The work itself
-- -----------------------------------------------------------------------------

create table if not exists public.tasks (
  id                      uuid primary key default gen_random_uuid(),
  program_id              uuid not null references public.programs (id) on delete cascade,

  title                   text not null,
  detail                  text,

  assignee_id             uuid references public.users (id) on delete restrict,
  /** The role it resolved from, kept so an unassigned task can say why. */
  role_on_program         text,
  due_date                date,
  status                  text not null default 'not_started',
  blocking                boolean not null default false,

  source                  text not null default 'manual',
  source_response_id      uuid references public.onboarding_responses (id) on delete cascade,
  source_task_template_id uuid references public.task_templates (id) on delete set null,

  /*
    The answer as it was when this task was made. A copy, deliberately: it is
    what turns "the answer changed" into "changed from this, to that", which is
    the only version an operator can act on.
  */
  source_answer           text,

  /** Set when the answer moved underneath it. Never set by the task itself. */
  stale_since             timestamptz,
  stale_reason            text,

  cancelled_reason        text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint tasks_title_present check (length(trim(title)) > 0),
  constraint tasks_status_valid check (
    status in ('not_started', 'in_progress', 'blocked', 'done', 'cancelled')
  ),
  constraint tasks_source_valid check (source in ('onboarding', 'manual')),
  -- A task from onboarding names the answer it came from; a manual one does not.
  constraint tasks_source_matches check (
    (source = 'onboarding' and source_response_id is not null)
    or (source = 'manual' and source_response_id is null)
  ),
  constraint tasks_role_valid check (
    role_on_program is null
    or role_on_program in ('engagement_lead', 'delivery_lead', 'specialist', 'data_ops')
  )
);

create index if not exists tasks_program_idx on public.tasks (program_id);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id)
  where status not in ('done', 'cancelled');
create index if not exists tasks_stale_idx on public.tasks (program_id)
  where stale_since is not null;
create index if not exists tasks_source_idx on public.tasks (source_response_id);


-- -----------------------------------------------------------------------------
-- 3. When a task is due
--
-- The same offset arithmetic generation uses, so a task and the question it
-- came from count from the same dates. Null when the programme has no date to
-- count from: a blank due date is honest, an invented one puts a deadline in
-- front of somebody that nothing justifies.
-- -----------------------------------------------------------------------------

create or replace function public.task_due_date(
  p_program_id   uuid,
  p_offset_type  text,
  p_offset_value integer
)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
begin
  select type, start_date, end_date, fixed_milestone_date, gate_date
  into p from public.programs where id = p_program_id;

  if not found then return null; end if;

  if p_offset_type = 'weeks_from_start' then
    return case when p.start_date is null
                then null
                else p.start_date + (p_offset_value * 7) end;
  end if;

  -- The date that does not move for an event; the end of the engagement
  -- otherwise. SPEC.md section 7.2.
  return case
    when p.type in ('event', 'series') then
      case when p.fixed_milestone_date is null
           then null
           else p.fixed_milestone_date - p_offset_value end
    else
      case when coalesce(p.gate_date, p.end_date) is null
           then null
           else coalesce(p.gate_date, p.end_date) - p_offset_value end
  end;
end;
$$;


-- -----------------------------------------------------------------------------
-- 4. Approval generates work, and a later change flags it
--
-- A trigger rather than a step somebody has to remember. Unlike onboarding
-- generation, which freezes four hundred questions in one act and earns a
-- preview, this is one answer at a time and every outcome is reversible: a task
-- created wrongly is cancelled with a reason.
--
-- Staleness follows SPEC.md section 8, which carries commercial weight:
--
--   "When an answer changes after generation, flag the tasks built from it and
--    notify. Do not regenerate silently and do not lock the answer."
--
-- So the answer stays editable, the tasks are flagged rather than rewritten,
-- and a person decides what to do with each one.
-- -----------------------------------------------------------------------------

create or replace function public.tasks_from_approved_answer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created integer;
begin
  /*
    Newly approved, and nothing generated from it before. tasks_generated is
    only set when work was actually created, so authoring a template for a
    question that has already been approved and re-approving it does generate —
    rather than the flag having silently closed the door.
  */
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and not coalesce(old.tasks_generated, false)
  then
    insert into public.tasks (
      program_id, title, detail, assignee_id, role_on_program, due_date,
      blocking, source, source_response_id, source_task_template_id, source_answer
    )
    select
      new.program_id,
      t.title,
      t.detail,
      -- Never broken by a guess. One holder assigns, nobody or several leaves
      -- it visibly unassigned. SPEC.md 4.3.
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
    order by t.sort_order;

    get diagnostics v_created = row_count;

    if v_created > 0 then
      new.tasks_generated := true;
    end if;

    return new;
  end if;

  /*
    The answer moved after work was built from it. Flag, never rewrite, and
    never touch the answer itself.

    Cancelled tasks are left alone — somebody already decided they do not apply.
    Completed ones are NOT: work done against an answer that has since changed
    is exactly what somebody needs to know about.
  */
  if coalesce(old.tasks_generated, false) then
    if new.response is distinct from old.response then
      update public.tasks
      set stale_since = clock_timestamp(),
          stale_reason = 'The answer this was built from has changed.'
      where source_response_id = new.id
        and stale_since is null
        and status <> 'cancelled';

    elsif new.status is distinct from old.status and new.status <> 'approved' then
      update public.tasks
      set stale_since = clock_timestamp(),
          stale_reason = format('The answer is no longer approved; it is now %s.', new.status)
      where source_response_id = new.id
        and stale_since is null
        and status <> 'cancelled';
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  execute 'drop trigger if exists tasks_from_approved_answer on public.onboarding_responses';
  execute 'create trigger tasks_from_approved_answer
             before update on public.onboarding_responses
             for each row execute function public.tasks_from_approved_answer()';
end;
$$;

comment on function public.tasks_from_approved_answer() is
  'Approval creates the work a question defines; a later change to the answer flags that work rather than rewriting it. SPEC.md section 8.';


-- -----------------------------------------------------------------------------
-- 5. Access
--
-- Tasks follow their programme, exactly as onboarding responses do: anybody who
-- can see the programme can work its tasks. Task templates are reference data —
-- every staff member reads them, admin and above write them.
-- -----------------------------------------------------------------------------

alter table public.tasks enable row level security;
alter table public.task_templates enable row level security;

grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.task_templates to authenticated;
grant all privileges on public.tasks to service_role;
grant all privileges on public.task_templates to service_role;
revoke all on public.tasks from anon;
revoke all on public.task_templates from anon;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated using ((select public.can_see_program(program_id)));

drop policy if exists tasks_write on public.tasks;
create policy tasks_write on public.tasks
  for all to authenticated
  using ((select public.can_see_program(program_id)))
  with check ((select public.can_see_program(program_id)));

drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select on public.task_templates
  for select to authenticated using ((select public.is_staff()));

drop policy if exists task_templates_write on public.task_templates;
create policy task_templates_write on public.task_templates
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

do $$
declare t text;
begin
  foreach t in array array['tasks', 'task_templates'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                      for each row execute function public.set_updated_at()', t);
    execute format('drop trigger if exists record_audit on public.%I', t);
    execute format('create trigger record_audit after insert or update or delete
                      on public.%I for each row execute function public.record_audit_event()', t);
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- 6. Resolving a flagged task
--
-- Three outcomes, all explicit, none automatic. SPEC.md section 8 forbids
-- silent regeneration, so a person chooses:
--
--   keep        the work is still right. Clears the flag, changes nothing else.
--   regenerate  rebuild from the answer as it now stands.
--   cancel      with a reason.
--
-- Regenerating SUPERSEDES rather than rewrites. The old task is cancelled and a
-- new one created from the current answer, so the record still shows what was
-- built from the earlier answer and what happened to it. Editing the task in
-- place would erase the very history the flag exists to expose.
-- -----------------------------------------------------------------------------

create or replace function public.regenerate_task(p_task_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old      record;
  v_template record;
  v_answer   text;
  v_new      uuid;
begin
  select * into v_old from public.tasks where id = p_task_id;
  if not found then
    raise exception 'No such task.';
  end if;
  if v_old.source <> 'onboarding' then
    raise exception 'Only a task built from an answer can be regenerated.';
  end if;

  select * into v_template
  from public.task_templates where id = v_old.source_task_template_id;

  if not found then
    raise exception 'The template this task came from no longer exists. Cancel it and write a new one.';
  end if;

  select response into v_answer
  from public.onboarding_responses where id = v_old.source_response_id;

  insert into public.tasks (
    program_id, title, detail, assignee_id, role_on_program, due_date,
    blocking, source, source_response_id, source_task_template_id, source_answer
  )
  values (
    v_old.program_id,
    v_template.title,
    v_template.detail,
    -- Resolved again, because the team may have changed since.
    public.sole_holder_of(v_old.program_id, v_template.default_assignee_role),
    v_template.default_assignee_role,
    public.task_due_date(v_old.program_id, v_template.default_offset_type,
                         v_template.default_offset_value),
    v_template.blocking,
    'onboarding',
    v_old.source_response_id,
    v_template.id,
    v_answer
  )
  returning id into v_new;

  update public.tasks
  set status = 'cancelled',
      cancelled_reason = 'Superseded after the answer changed.',
      stale_since = null,
      stale_reason = null
  where id = p_task_id;

  return v_new;
end;
$$;

revoke all on function public.regenerate_task(uuid) from public, anon;
grant execute on function public.regenerate_task(uuid) to authenticated, service_role;
