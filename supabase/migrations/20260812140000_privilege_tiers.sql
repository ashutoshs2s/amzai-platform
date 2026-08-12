-- =============================================================================
-- Four privilege tiers, and functions alongside them.
--
-- Two questions were being answered by one column. Seniority decides HOW MANY
-- programmes a person sees; function decides WHICH TABLES AND COLUMNS they may
-- touch within that. `data_ops` was never a seniority level, and sitting it in
-- a ladder beside `admin` forced a choice between giving a data ops person too
-- much and giving them nothing.
--
--   tier      super_admin > admin > manager > user
--   function  data_ops today, finance next, held alongside any tier
--
-- A third axis already existed and is untouched: program_assignments.
-- role_on_program is the JOB somebody does on a programme, which is what
-- onboarding questions are assigned by. Sana stays the delivery lead on her
-- programme while sitting at tier `user`; the tier only decides how much she
-- can see.
--
-- The column is renamed role -> tier for that reason. Three things called
-- "role" in one schema is one too many.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The tier column
-- -----------------------------------------------------------------------------

do $rename$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'role'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'tier'
  ) then
    alter table public.users rename column role to tier;
  end if;
end;
$rename$;

alter table public.users drop constraint if exists users_role_valid;
alter table public.users drop constraint if exists users_tier_valid;

/*
  The mapping.

    admin           -> admin          unchanged
    engagement_lead -> manager        scoped to their organisations below
    delivery_lead   -> user           still the delivery lead ON the programme
    specialist      -> user           behaviour identical
    data_ops        -> user           plus the data ops function

  Guarded on the old values so a second run finds nothing to do.
*/
update public.users
set tier = case tier
             when 'engagement_lead' then 'manager'
             when 'delivery_lead'   then 'user'
             when 'specialist'      then 'user'
             when 'data_ops'        then 'user'
             else tier
           end
where tier in ('engagement_lead', 'delivery_lead', 'specialist', 'data_ops');

-- The promotion happens below, once the guard exists, so that the same guarded
-- path establishes it and any later change to it.

alter table public.users
  add constraint users_tier_valid
  check (tier in ('super_admin', 'admin', 'manager', 'user'));

comment on column public.users.tier is
  'Privilege tier: super_admin, admin, manager, user. How many programmes a person sees. Not to be confused with program_assignments.role_on_program, which is the job they do on one.';

-- One super admin. Not a convention, an index.
create unique index if not exists users_one_super_admin
  on public.users ((tier = 'super_admin')) where tier = 'super_admin';


-- -----------------------------------------------------------------------------
-- 2. The super admin cannot be demoted, deactivated or deleted
--
-- By anyone, including themselves, including the service role, including a
-- session that has somehow acquired the table owner's rights. A trigger is the
-- only place that holds against all of those.
--
-- The consequence, stated plainly: changing who the super admin is takes a
-- migration. That is what "cannot be demoted by anyone including themselves"
-- means, and the alternative is a control that can be clicked by mistake.
-- -----------------------------------------------------------------------------

create or replace function public.protect_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.tier = 'super_admin' then
      raise exception 'The super admin cannot be deleted. Changing who it is takes a migration.';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.tier = 'super_admin'
     and coalesce(current_setting('app.allow_super_admin', true), '') <> 'on' then
    if new.tier is distinct from old.tier then
      raise exception 'The super admin cannot be demoted, by anyone, including themselves.';
    end if;
    if new.active is distinct from old.active then
      raise exception 'The super admin cannot be deactivated, by anyone, including themselves.';
    end if;
  end if;

  /*
    Nobody is promoted INTO it either, which is what stops an admin minting a
    second one.

    The one exception is set_super_admin() below, which raises a session flag
    only it can raise. Execute on it is revoked from every application role, so
    the flag can be set from a SQL editor with owner rights and from nowhere
    else. Without that hatch, a database restored before its first user existed
    would have no super admin and no way to appoint one.
  */
  if new.tier = 'super_admin'
     and (tg_op = 'INSERT' or old.tier is distinct from 'super_admin')
     and coalesce(current_setting('app.allow_super_admin', true), '') <> 'on'
  then
    raise exception 'A second super admin cannot be created. There is exactly one, and only set_super_admin() can move it.';
  end if;

  return new;
end;
$$;

do $$
begin
  execute 'drop trigger if exists protect_super_admin on public.users';
  execute 'create trigger protect_super_admin
             before insert or update or delete on public.users
             for each row execute function public.protect_super_admin()';
end;
$$;


/*
  Appointing the super admin. The only way the tier ever moves.

  SECURITY DEFINER, and execute is revoked from anon, authenticated and
  service_role, so no application path can reach it — not a route, not a server
  action, not the service role key. Running it means being in the SQL editor
  with owner rights, which is the same bar as writing a migration, which is
  what "cannot be demoted by anyone including themselves" was asking for.
*/
create or replace function public.set_super_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
begin
  select id into v_target from public.users where email = p_email;
  if v_target is null then
    raise exception 'No staff member with the email %.', p_email;
  end if;

  perform set_config('app.allow_super_admin', 'on', true);
  update public.users set tier = 'admin' where tier = 'super_admin' and id <> v_target;
  update public.users set tier = 'super_admin', active = true where id = v_target;
  perform set_config('app.allow_super_admin', 'off', true);
end;
$$;

revoke all on function public.set_super_admin(text) from public, anon, authenticated, service_role;

comment on function public.set_super_admin(text) is
  'Appoints the one super admin. Deliberately unreachable from the application: execute is revoked from every application role, so it takes owner rights in the SQL editor.';

-- Establish the one super admin. Silent if that person has no staff row yet, so
-- a database seeded after its migrations is not blocked; run set_super_admin
-- once the row exists.
do $promote$
begin
  if exists (select 1 from public.users where email = 'ash@amzai.ai') then
    perform public.set_super_admin('ash@amzai.ai');
  else
    raise notice 'No staff row for ash@amzai.ai yet. Run: select public.set_super_admin(''ash@amzai.ai'');';
  end if;
end;
$promote$;


-- -----------------------------------------------------------------------------
-- 3. Functions
--
-- A catalogue table, not an enum, so a new function is an INSERT rather than a
-- migration. The capability columns are chosen so that finance — commercial
-- across every programme, no onboarding answers — needs no schema change:
--
--   data_ops   audience full, commercial none, onboarding none, scope tier
--   finance    audience none, commercial full, onboarding none, scope all
--
-- A function needing a capability outside these four would still need a
-- migration. No column list is general enough to avoid that, and pretending
-- otherwise would be worse than saying so.
-- -----------------------------------------------------------------------------

create table if not exists public.staff_functions (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null,
  label             text not null,
  description       text,
  /** contacts, companies and engagement_events */
  audience_access   text not null default 'none',
  /** currency, approver, dashboard token, and the commercial split to come */
  commercial_access text not null default 'none',
  onboarding_access text not null default 'none',
  /** tier: whatever the tier allows. all: every programme, regardless of tier. */
  program_scope     text not null default 'tier',
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint staff_functions_slug_unique unique (slug),
  constraint staff_functions_slug_format check (slug ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  constraint staff_functions_audience_valid check (audience_access in ('none', 'full')),
  constraint staff_functions_commercial_valid check (commercial_access in ('none', 'full')),
  constraint staff_functions_onboarding_valid check (onboarding_access in ('none', 'scoped', 'full')),
  constraint staff_functions_scope_valid check (program_scope in ('tier', 'all'))
);

create table if not exists public.user_staff_functions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  function_id uuid not null references public.staff_functions (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint user_staff_functions_unique unique (user_id, function_id)
);

create index if not exists user_staff_functions_user_idx
  on public.user_staff_functions (user_id);

insert into public.staff_functions
  (slug, label, description, audience_access, commercial_access, onboarding_access, program_scope)
values
  ('data_ops', 'Data ops',
   'Contacts and engagement history in full. No commercial columns anywhere, and organisations and programmes only through the restricted views.',
   'full', 'none', 'none', 'tier')
on conflict (slug) do update
  set label = excluded.label,
      description = excluded.description,
      audience_access = excluded.audience_access,
      commercial_access = excluded.commercial_access,
      onboarding_access = excluded.onboarding_access,
      program_scope = excluded.program_scope;

-- The one person who held the old data_ops role.
insert into public.user_staff_functions (user_id, function_id)
select u.id, f.id
from public.users u, public.staff_functions f
where u.email = 'ana.beltran@amzai.ai' and f.slug = 'data_ops'
on conflict (user_id, function_id) do nothing;


-- -----------------------------------------------------------------------------
-- 4. Which organisations a manager holds
--
-- Access is derived through the organisation, never copied onto a programme, so
-- a new programme under a managed organisation is visible the moment it exists.
-- Nobody has to remember to grant it, so nobody can forget to.
--
-- Membership only. The job somebody does is program_assignments' business.
-- -----------------------------------------------------------------------------

create table if not exists public.organisation_managers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint organisation_managers_unique unique (user_id, organisation_id)
);

create index if not exists organisation_managers_user_idx
  on public.organisation_managers (user_id);
create index if not exists organisation_managers_org_idx
  on public.organisation_managers (organisation_id);

/*
  Backfill. An engagement lead saw every programme before this migration and a
  manager sees only their own organisations, so this is the one place where
  somebody loses access.

  Narrow on purpose: each new manager gets the organisations they were already
  connected to, through programs.engagement_lead_id or an assignment. Handing
  them every organisation would preserve access exactly, but that is an admin
  with extra steps, and the point of the tier is that it is narrower.
*/
insert into public.organisation_managers (user_id, organisation_id)
select distinct u.id, p.organisation_id
from public.users u
join public.programs p on p.engagement_lead_id = u.id
where u.tier = 'manager'
on conflict (user_id, organisation_id) do nothing;

insert into public.organisation_managers (user_id, organisation_id)
select distinct u.id, p.organisation_id
from public.users u
join public.program_assignments pa on pa.user_id = u.id
join public.programs p on p.id = pa.program_id
where u.tier = 'manager'
on conflict (user_id, organisation_id) do nothing;


-- -----------------------------------------------------------------------------
-- 5. The helpers every policy asks
--
-- Still SECURITY DEFINER, still the only place a policy asks who the caller is.
-- A policy that read the tier out of users directly would recurse.
-- -----------------------------------------------------------------------------

create or replace function public.current_user_tier()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select u.tier from public.users u where u.id = (select auth.uid()) and u.active
$$;

comment on function public.current_user_tier() is
  'The signed-in staff member''s privilege tier. SECURITY DEFINER so policies on users do not recurse.';

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_tier() is not null
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_tier() = 'super_admin'
$$;

-- Admin and above. The name is kept: 28 policies ask it, and its meaning is
-- unchanged — the tier that sees everything and creates clients.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_tier() in ('super_admin', 'admin')
$$;

create or replace function public.can_manage()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_tier() in ('super_admin', 'admin')
$$;

comment on function public.can_manage() is
  'Creating organisations and programmes, and generating onboarding: admin and above. A manager manages the team inside their own organisations; ask can_manage_program for that.';

/*
  A function may widen scope beyond the tier. finance will: commercial across
  every programme. Nothing today does.
*/
create or replace function public.sees_all_programs()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_tier() in ('super_admin', 'admin')
      or exists (
        select 1 from public.user_staff_functions uf
        join public.staff_functions f on f.id = uf.function_id
        where uf.user_id = (select auth.uid()) and f.active and f.program_scope = 'all'
      )
$$;

/** Admin and above, or a manager holding this organisation. */
create or replace function public.manages_organisation(p_organisation_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.can_manage()
      or (
        public.current_user_tier() = 'manager'
        and exists (
          select 1 from public.organisation_managers m
          where m.user_id = (select auth.uid())
            and m.organisation_id = p_organisation_id
        )
      )
$$;

/*
  What a tier can see, as the UNION of its scope and its assignments.

  The union matters. A manager who is personally assigned to a programme
  outside their organisations keeps seeing it, so promoting somebody can never
  quietly REMOVE access they had.
*/
create or replace function public.can_see_program(p_program_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.sees_all_programs()
      or exists (
        select 1 from public.program_assignments pa
        where pa.program_id = p_program_id and pa.user_id = (select auth.uid())
      )
      or (
        public.current_user_tier() = 'manager'
        and exists (
          select 1
          from public.programs p
          join public.organisation_managers m on m.organisation_id = p.organisation_id
          where p.id = p_program_id and m.user_id = (select auth.uid())
        )
      )
$$;

comment on function public.can_see_program(uuid) is
  'super_admin and admin see every programme. A manager sees their organisations, plus anything they are assigned to. A user sees only their assignments.';

create or replace function public.can_see_organisation(p_organisation_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.sees_all_programs()
      or exists (
        select 1 from public.organisation_managers m
        where m.user_id = (select auth.uid()) and m.organisation_id = p_organisation_id
      )
      or exists (
        select 1
        from public.programs p
        join public.program_assignments pa on pa.program_id = p.id
        where p.organisation_id = p_organisation_id and pa.user_id = (select auth.uid())
      )
$$;

/** Changing a programme's team: admin and above, or its organisation's manager. */
create or replace function public.can_manage_program(p_program_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.can_manage()
      or exists (
        select 1
        from public.programs p
        join public.organisation_managers m on m.organisation_id = p.organisation_id
        where p.id = p_program_id
          and m.user_id = (select auth.uid())
          and public.current_user_tier() = 'manager'
      )
$$;

/*
  Deny wins.

  If a permissive union decided this, adding an unrelated function to somebody
  would quietly lift a restriction that was imposed on purpose. The cost is
  that a data ops person cannot also hold finance without the data ops function
  being removed first — which is correct, and, more to the point, visible.
*/
create or replace function public.denied_commercial()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.user_staff_functions uf
    join public.staff_functions f on f.id = uf.function_id
    where uf.user_id = (select auth.uid()) and f.active and f.commercial_access = 'none'
  )
$$;

create or replace function public.denied_onboarding()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.user_staff_functions uf
    join public.staff_functions f on f.id = uf.function_id
    where uf.user_id = (select auth.uid()) and f.active and f.onboarding_access = 'none'
  )
$$;

/** The audience database: admin and above, managers, or an audience function. */
create or replace function public.can_see_audience()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_tier() in ('super_admin', 'admin', 'manager')
      or exists (
        select 1 from public.user_staff_functions uf
        join public.staff_functions f on f.id = uf.function_id
        where uf.user_id = (select auth.uid()) and f.active and f.audience_access = 'full'
      )
$$;


-- -----------------------------------------------------------------------------
-- 6. Policies
--
-- Only the ones whose meaning changes are rewritten. Every other policy asks
-- can_see_program, can_manage, is_admin or can_see_audience, and those were
-- redefined above, so they follow without being touched.
-- -----------------------------------------------------------------------------

-- users --------------------------------------------------------------------
-- Every staff member sees the staff list: they have to, to assign anyone.
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated using ((select public.is_staff()));

/*
  Admin and above manage users. "Below them" is enforced twice over: this
  policy refuses to touch a super_admin row at all, and the trigger above
  refuses promotion into the tier from any direction.
*/
drop policy if exists users_write on public.users;
drop policy if exists users_insert on public.users;
drop policy if exists users_update on public.users;
drop policy if exists users_delete on public.users;

create policy users_insert on public.users
  for insert to authenticated with check ((select public.can_manage()));
create policy users_update on public.users
  for update to authenticated
  using ((select public.can_manage()) and tier is distinct from 'super_admin')
  with check ((select public.can_manage()) and tier is distinct from 'super_admin');
create policy users_delete on public.users
  for delete to authenticated
  using ((select public.can_manage()) and tier is distinct from 'super_admin');

-- organisations ------------------------------------------------------------
-- Was a role test naming delivery_lead and specialist. Now the tier's own
-- question, asked in one place.
drop policy if exists organisations_select on public.organisations;
create policy organisations_select on public.organisations
  for select to authenticated
  using ((select public.can_see_organisation(id)) and not (select public.denied_commercial()));

-- programs -----------------------------------------------------------------
/*
  Row level security cannot hide a column, so somebody denied commercial access
  is kept off the base table entirely and reads programs_restricted instead.
  That is the same mechanism as before, asked of the function rather than the
  role.
*/
drop policy if exists programs_select on public.programs;
create policy programs_select on public.programs
  for select to authenticated
  using ((select public.can_see_program(id)) and not (select public.denied_commercial()));

-- program_assignments ------------------------------------------------------
-- A manager manages the team inside their own organisations. This is the one
-- write a manager has.
drop policy if exists program_assignments_write on public.program_assignments;
create policy program_assignments_write on public.program_assignments
  for all to authenticated
  using ((select public.can_manage_program(program_id)))
  with check ((select public.can_manage_program(program_id)));

-- onboarding ---------------------------------------------------------------
drop policy if exists onboarding_responses_select on public.onboarding_responses;
create policy onboarding_responses_select on public.onboarding_responses
  for select to authenticated
  using ((select public.can_see_program(program_id)) and not (select public.denied_onboarding()));

drop policy if exists onboarding_responses_write on public.onboarding_responses;
create policy onboarding_responses_write on public.onboarding_responses
  for all to authenticated
  using ((select public.can_see_program(program_id)) and not (select public.denied_onboarding()))
  with check ((select public.can_see_program(program_id)) and not (select public.denied_onboarding()));


-- -----------------------------------------------------------------------------
-- 7. The new tables
--
-- The catalogue and its memberships are reference data: every staff member
-- reads them, admin and above write them. A manager cannot grant themselves an
-- organisation, which would be the obvious way to widen your own scope.
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['staff_functions', 'user_staff_functions', 'organisation_managers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all privileges on public.%I to service_role', t);
    execute format('revoke all on public.%I from anon', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_staff()))',
      t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.can_manage())) with check ((select public.can_manage()))',
      t || '_write', t);

    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    execute format('drop trigger if exists record_audit on public.%I', t);
    execute format(
      'create trigger record_audit after insert or update or delete on public.%I for each row execute function public.record_audit_event()', t);
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- 8. The restricted views, keyed on function
--
-- Unchanged in purpose: row level security cannot hide a column, so the column
-- list is the mechanism. What changed is the question they ask. It was "is this
-- person the data_ops role", which tied the mechanism to one job title. It is
-- now "may this person see this programme, and are they denied its commercial
-- columns", which is the function's own question and works for the next one
-- without being rewritten.
--
-- They are also scoped now. A data ops person at tier `user` sees the
-- programmes they are assigned to, rather than every programme in the system
-- with its commercial columns stripped.
-- -----------------------------------------------------------------------------

drop view if exists public.organisations_restricted;
create view public.organisations_restricted
  with (security_barrier = true) as
  select o.id, o.name, o.trading_name, o.client_type_id, o.sub_segment_id,
         o.category, o.status
  from public.organisations o
  where public.denied_commercial() and public.can_see_organisation(o.id);

drop view if exists public.programs_restricted;
create view public.programs_restricted
  with (security_barrier = true) as
  select p.id, p.organisation_id, p.name, p.slug, p.type, p.status,
         p.start_date, p.end_date, p.fixed_milestone_date, p.gate_date
  from public.programs p
  where public.denied_commercial() and public.can_see_program(p.id);

comment on view public.programs_restricted is
  'For anyone whose function denies commercial access. Name, type and dates, scoped to the programmes their tier can see. No currency, no approver, no dashboard token.';
comment on view public.organisations_restricted is
  'For anyone whose function denies commercial access. Name and taxonomy only.';

revoke all on public.organisations_restricted from anon;
revoke all on public.programs_restricted from anon;
grant select on public.organisations_restricted to authenticated;
grant select on public.programs_restricted to authenticated;

-- Last, because policies above referenced it until they were replaced.
drop function if exists public.current_user_role();
