-- =============================================================================
-- Managers generate within their own organisations, and clients can be
-- archived or, rarely, deleted.
--
-- Generation queuing behind two admins defeats the point of the tier. The
-- preview-then-freeze step already makes generation deliberate rather than
-- accidental, so the gate moves from "admin and above" to "admin and above, or
-- the manager who holds this organisation".
--
-- That is done by widening the policies rather than by reaching past them with
-- a SECURITY DEFINER writer. Generation touches five tables; each one now asks
-- can_manage_program, which is the same question the screen asks.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. What generation writes
-- -----------------------------------------------------------------------------

/*
  programs, split by action.

  Creating and deleting a programme stays admin and above: those are client
  administration. Updating one moves to the organisation's manager, because
  generation writes onboarding_fill_mode and onboarding_generated_at to this
  table, and because a manager who can generate but cannot correct a date is a
  manager in name only.
*/
drop policy if exists programs_write on public.programs;
drop policy if exists programs_insert on public.programs;
drop policy if exists programs_update on public.programs;
drop policy if exists programs_delete on public.programs;

create policy programs_insert on public.programs
  for insert to authenticated with check ((select public.can_manage()));

create policy programs_update on public.programs
  for update to authenticated
  using ((select public.can_manage_program(id)))
  with check ((select public.can_manage_program(id)));

create policy programs_delete on public.programs
  for delete to authenticated using ((select public.can_manage()));

-- The three tables generation writes alongside the responses.
do $$
declare t text;
begin
  foreach t in array array[
    'program_situational_modules', 'program_onboarding_sources', 'program_role_resolutions'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', substr(t, 1, 3) || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select public.can_manage_program(program_id)))
         with check ((select public.can_manage_program(program_id)))',
      t || '_write', t);
  end loop;
end;
$$;

-- Older split policies from earlier migrations, superseded by the above.
drop policy if exists psm_insert on public.program_situational_modules;
drop policy if exists psm_update on public.program_situational_modules;
drop policy if exists psm_delete on public.program_situational_modules;
drop policy if exists pos_insert on public.program_onboarding_sources;
drop policy if exists pos_update on public.program_onboarding_sources;
drop policy if exists pos_delete on public.program_onboarding_sources;
drop policy if exists prr_insert on public.program_role_resolutions;
drop policy if exists prr_update on public.program_role_resolutions;
drop policy if exists prr_delete on public.program_role_resolutions;


-- -----------------------------------------------------------------------------
-- 2. Archive
--
-- The normal way something leaves the interface. Nothing is removed, the
-- history stays whole, and it is reversible by clearing one column. Deleting is
-- the exception, not the default, because a deleted client takes its audit
-- trail's meaning with it.
-- -----------------------------------------------------------------------------

alter table public.organisations add column if not exists archived_at timestamptz;
alter table public.programs      add column if not exists archived_at timestamptz;

comment on column public.organisations.archived_at is
  'Archived: hidden from the interface, history intact, reversible. Null means live.';
comment on column public.programs.archived_at is
  'Archived: hidden from the interface, history intact, reversible. Null means live.';

create index if not exists organisations_live_idx on public.organisations (archived_at)
  where archived_at is null;
create index if not exists programs_live_idx on public.programs (archived_at)
  where archived_at is null;


-- -----------------------------------------------------------------------------
-- 3. Deleting, and when it is refused
--
-- Enforced by triggers rather than by the screen that offers it, because the
-- rule is about what the data means, not about which button was pressed. The
-- service role and a hand-run statement are held to it too.
--
--   A programme with generated onboarding is never deleted. Its answers are
--   the record of what a client was asked and said. Archive it.
--
--   An organisation with programmes is never deleted, archived ones included.
--   Deleting the client of a live programme would orphan work in progress, and
--   the archived ones are exactly the history archiving was meant to keep.
-- -----------------------------------------------------------------------------

create or replace function public.refuse_delete_generated_programme()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_responses integer;
begin
  select count(*) into v_responses
  from public.onboarding_responses where program_id = old.id;

  if old.onboarding_generated_at is not null or v_responses > 0 then
    raise exception
      'This programme has generated onboarding, so it cannot be deleted. Its answers are the record of what the client was asked. Archive it instead.';
  end if;

  return old;
end;
$$;

create or replace function public.refuse_delete_organisation_with_programmes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_programmes integer;
begin
  select count(*) into v_programmes
  from public.programs where organisation_id = old.id;

  if v_programmes > 0 then
    raise exception
      'This client has % programme(s), archived ones included, so it cannot be deleted. Archive it instead.', v_programmes;
  end if;

  return old;
end;
$$;

do $$
begin
  execute 'drop trigger if exists refuse_delete_generated on public.programs';
  execute 'create trigger refuse_delete_generated
             before delete on public.programs
             for each row execute function public.refuse_delete_generated_programme()';

  execute 'drop trigger if exists refuse_delete_with_programmes on public.organisations';
  execute 'create trigger refuse_delete_with_programmes
             before delete on public.organisations
             for each row execute function public.refuse_delete_organisation_with_programmes()';
end;
$$;


-- -----------------------------------------------------------------------------
-- 4. Reading the audit trail
--
-- The staff screen shows who changed a tier, a function or an organisation
-- assignment. That is admin business, and audit_events was already readable
-- only by those who see everything, which is now exactly admin and above.
-- Restated here so the change of meaning is deliberate rather than inherited.
-- -----------------------------------------------------------------------------

drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated using ((select public.is_admin()));

create index if not exists audit_events_table_time_idx
  on public.audit_events (table_name, occurred_at desc);
