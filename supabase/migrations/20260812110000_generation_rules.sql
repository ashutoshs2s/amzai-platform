-- =============================================================================
-- What generation resolves against.
--
-- Generation is driven entirely by rows. No route, screen or script may hold a
-- list of which questions belong to which client. Everything a resolution
-- depends on lives here, so adding a sub-segment, repointing a mapping or
-- importing a new workbook changes what future programmes generate with no
-- code change and no deploy.
--
-- Two things are added:
--
--   1. Where a sub-segment with no question set of its own borrows one.
--   2. The guarantee that a generated set is frozen, enforced rather than
--      merely intended.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Borrowed question sets
--
-- Hosted Buyer Organizer and Community Event Organizer have no sheet in the
-- workbook. Rather than generation naming them in code, each sub-segment says
-- which other sub-segment's questions it borrows. Repointing one is an update
-- to one row, and writing a sheet for one later means clearing the column.
--
-- Every response taken from a borrowed set is marked is_generic, so nobody
-- mistakes a question written for a trade show organiser for one written with
-- hosted buyer events in mind.
-- -----------------------------------------------------------------------------

alter table public.client_sub_segments
  add column if not exists questions_from_sub_segment_id uuid;

comment on column public.client_sub_segments.questions_from_sub_segment_id is
  'Borrow this other sub-segment''s question set. Null means this sub-segment has its own. Responses generated through it are marked is_generic.';

alter table public.client_sub_segments
  drop constraint if exists css_borrow_not_self;
alter table public.client_sub_segments
  add constraint css_borrow_not_self
  check (questions_from_sub_segment_id is distinct from id);

/*
  The composite reference, rather than a plain one to id, is what stops a
  conference organiser borrowing a law firm's questions: the target must share
  this row's client type. client_sub_segments_id_type_unique exists for it.
*/
alter table public.client_sub_segments
  drop constraint if exists css_borrow_same_client_type;
alter table public.client_sub_segments
  add constraint css_borrow_same_client_type
  foreign key (questions_from_sub_segment_id, client_type_id)
  references public.client_sub_segments (id, client_type_id)
  on delete restrict;

-- The two sub-segments the workbook does not cover. This is data, and an admin
-- can repoint it without asking a developer.
update public.client_sub_segments target
set questions_from_sub_segment_id = source.id
from public.client_sub_segments source, public.client_types t
where target.client_type_id = t.id
  and source.client_type_id = t.id
  and t.slug = 'conference_organizers'
  and source.slug = 'trade_show_organizer'
  and target.slug in ('hosted_buyer_organizer', 'community_event_organizer')
  and target.questions_from_sub_segment_id is null;


-- -----------------------------------------------------------------------------
-- Frozen once generated
--
-- A generated response points at the template field it came from, and the
-- question text lives on that field. So "a later import never alters a live
-- programme" holds only for as long as nothing edits a field in place. The
-- importer never does; it writes new versions. But an intention is not a
-- guarantee, and a single UPDATE run by hand would silently reword a question
-- on every programme ever generated from it.
--
-- Template fields are therefore append-only, the same treatment audit_events
-- gets and for the same reason.
-- -----------------------------------------------------------------------------

create or replace function public.template_fields_are_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception
    'onboarding_template_fields is append-only. Programmes already generated read their questions from these rows, so editing one would rewrite history. Import the workbook again; a changed sheet becomes a new version.';
end;
$$;

create or replace function public.template_fields_no_truncate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'onboarding_template_fields is append-only and cannot be truncated.';
end;
$$;

do $$
begin
  execute 'drop trigger if exists template_fields_immutable on public.onboarding_template_fields';
  execute 'create trigger template_fields_immutable
             before update or delete on public.onboarding_template_fields
             for each row execute function public.template_fields_are_immutable()';

  -- A row trigger does not fire on TRUNCATE. Same gap the audit table had.
  execute 'drop trigger if exists template_fields_immutable_truncate on public.onboarding_template_fields';
  execute 'create trigger template_fields_immutable_truncate
             before truncate on public.onboarding_template_fields
             for each statement execute function public.template_fields_no_truncate()';
end;
$$;

/*
  A template row itself may still be deactivated, because withdrawing a bad
  version is a legitimate thing to need. Nothing else about it may change: its
  slug, kind, version, hash and taxonomy are what a generated programme's
  provenance is read from a year later.
*/
create or replace function public.templates_only_active_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.slug is distinct from old.slug
     or new.kind is distinct from old.kind
     or new.version is distinct from old.version
     or new.content_hash is distinct from old.content_hash
     or new.source_sheet is distinct from old.source_sheet
     or new.program_type is distinct from old.program_type
     or new.client_type_id is distinct from old.client_type_id
     or new.sub_segment_id is distinct from old.sub_segment_id
  then
    raise exception
      'An onboarding template version is immutable apart from its active flag. Import the workbook again; a changed sheet becomes a new version.';
  end if;
  return new;
end;
$$;

do $$
begin
  execute 'drop trigger if exists templates_immutable on public.onboarding_templates';
  execute 'create trigger templates_immutable
             before update on public.onboarding_templates
             for each row execute function public.templates_only_active_changes()';
end;
$$;


-- -----------------------------------------------------------------------------
-- Which situational modules a programme was offered, and what it chose
--
-- Recorded on the programme rather than worked out from the responses, because
-- choosing no module and a module contributing nothing are different facts and
-- only one of them is a mistake.
-- -----------------------------------------------------------------------------

alter table public.programs
  add column if not exists onboarding_fill_mode text;

alter table public.programs
  drop constraint if exists programs_fill_mode_valid;
alter table public.programs
  add constraint programs_fill_mode_valid
  check (onboarding_fill_mode is null
         or onboarding_fill_mode in ('amzai', 'client'));

comment on column public.programs.onboarding_fill_mode is
  'Who fills this programme''s onboarding, chosen at generation. Null until generated.';

alter table public.programs
  add column if not exists onboarding_generated_at timestamptz;

comment on column public.programs.onboarding_generated_at is
  'When onboarding was generated. Non-null means the question set is frozen; see program_onboarding_sources for what it was built from.';

/*
  The modules chosen at programme creation, held until generation, which is
  where they are turned into a specific version.

  By slug rather than by template id, because the choice is "ask the New Market
  Entry questions" and not "ask version 3 of them". Which version answers that
  is settled at generation and recorded in program_onboarding_sources.
*/
create table if not exists public.program_situational_modules (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs (id) on delete cascade,
  module_slug text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint psm_unique unique (program_id, module_slug)
);

create index if not exists psm_program_idx
  on public.program_situational_modules (program_id);

-- A slug alone is not unique across versions, so a foreign key cannot say this.
-- Without the check, a typo would sit in the table looking like a real choice
-- and quietly contribute nothing at generation.
create or replace function public.situational_module_must_exist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.onboarding_templates
    where slug = new.module_slug and kind = 'situational'
  ) then
    raise exception 'There is no situational module with slug %.', new.module_slug;
  end if;
  return new;
end;
$$;

do $$
begin
  execute 'drop trigger if exists psm_module_must_exist on public.program_situational_modules';
  execute 'create trigger psm_module_must_exist
             before insert or update on public.program_situational_modules
             for each row execute function public.situational_module_must_exist()';
  execute 'drop trigger if exists set_updated_at on public.program_situational_modules';
  execute 'create trigger set_updated_at before update on public.program_situational_modules
             for each row execute function public.set_updated_at()';
  execute 'drop trigger if exists record_audit on public.program_situational_modules';
  execute 'create trigger record_audit after insert or update or delete
             on public.program_situational_modules
             for each row execute function public.record_audit_event()';
end;
$$;

grant select, insert, update, delete on public.program_situational_modules to authenticated;
grant all privileges on public.program_situational_modules to service_role;
revoke all on public.program_situational_modules from anon;

alter table public.program_situational_modules enable row level security;

drop policy if exists psm_select on public.program_situational_modules;
create policy psm_select on public.program_situational_modules
  for select to authenticated using (public.can_see_program(program_id));
drop policy if exists psm_insert on public.program_situational_modules;
create policy psm_insert on public.program_situational_modules
  for insert to authenticated with check ((select public.can_manage()));
drop policy if exists psm_update on public.program_situational_modules;
create policy psm_update on public.program_situational_modules
  for update to authenticated
  using ((select public.can_manage())) with check ((select public.can_manage()));
drop policy if exists psm_delete on public.program_situational_modules;
create policy psm_delete on public.program_situational_modules
  for delete to authenticated using ((select public.can_manage()));


-- -----------------------------------------------------------------------------
-- Committing a generation
--
-- Generation writes responses, the record of which sets they came from, the
-- role resolutions and the programme itself. Through PostgREST that is four
-- round trips and four transactions, and a failure at the third leaves a
-- programme half generated: questions present, provenance missing, and the
-- generated_at flag unset so the next attempt writes them all again.
--
-- So the writes happen here instead, in one transaction that either all lands
-- or none does. The decision of WHICH questions is not made here; it is made in
-- lib/generation/resolve.ts and arrives already decided. This function only
-- writes, and refuses when the rules in SPEC.md section 4.2 are not met.
--
-- SECURITY INVOKER, deliberately. It runs as the signed-in staff member, so row
-- level security still decides what they may write and the audit triggers still
-- record them as the actor.
-- -----------------------------------------------------------------------------

create or replace function public.commit_onboarding_generation(
  p_program_id  uuid,
  p_fill_mode   text,
  p_modules     text[],
  p_responses   jsonb,
  p_sources     jsonb,
  p_resolutions jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_generated_at timestamptz;
  v_assignments  integer;
  v_written      integer;
  v_actor        uuid := auth.uid();
begin
  select onboarding_generated_at into v_generated_at
  from public.programs where id = p_program_id for update;

  if not found then
    raise exception 'That programme does not exist, or you cannot see it.';
  end if;

  -- Frozen. A second generation would rewrite a live programme's questions.
  if v_generated_at is not null then
    raise exception 'Onboarding for this programme was already generated on %. A generated set is frozen.', v_generated_at;
  end if;

  -- SPEC.md 4.2. Without a team every field generates unassigned, and
  -- unassigned work is invisible work.
  select count(*) into v_assignments
  from public.program_assignments where program_id = p_program_id;

  if v_assignments = 0 then
    raise exception 'Assign at least one person to this programme before generating onboarding.';
  end if;

  delete from public.program_situational_modules where program_id = p_program_id;
  if p_modules is not null and array_length(p_modules, 1) > 0 then
    insert into public.program_situational_modules (program_id, module_slug)
    select p_program_id, unnest(p_modules);
  end if;

  insert into public.onboarding_responses (
    program_id, template_field_id, owner, assignee_id, due_date, blocking, is_generic
  )
  select
    p_program_id, r.template_field_id, r.owner, r.assignee_id, r.due_date,
    r.blocking, r.is_generic
  from jsonb_to_recordset(p_responses) as r(
    template_field_id uuid,
    owner             text,
    assignee_id       uuid,
    due_date          date,
    blocking          boolean,
    is_generic        boolean
  );
  get diagnostics v_written = row_count;

  if v_written = 0 then
    raise exception 'That would generate no questions at all. Import the workbook first.';
  end if;

  insert into public.program_onboarding_sources (program_id, template_id, role)
  select p_program_id, s.template_id, s.role
  from jsonb_to_recordset(p_sources) as s(template_id uuid, role text);

  /*
    Recorded so the next generation does not ask again, including a deliberate
    "leave unassigned", which is a decision and not a failure to decide.
    SPEC.md 4.5.
  */
  if p_resolutions is not null and jsonb_array_length(p_resolutions) > 0 then
    insert into public.program_role_resolutions
      (program_id, role_on_program, user_id, resolved_by)
    select p_program_id, x.role_on_program, x.user_id, v_actor
    from jsonb_to_recordset(p_resolutions) as x(role_on_program text, user_id uuid)
    on conflict (program_id, role_on_program)
      do update set user_id = excluded.user_id,
                    resolved_by = excluded.resolved_by,
                    resolved_at = clock_timestamp();
  end if;

  update public.programs
  set onboarding_fill_mode = p_fill_mode,
      onboarding_generated_at = clock_timestamp()
  where id = p_program_id;

  return v_written;
end;
$$;

revoke all on function public.commit_onboarding_generation(uuid, text, text[], jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.commit_onboarding_generation(uuid, text, text[], jsonb, jsonb, jsonb) to authenticated;
