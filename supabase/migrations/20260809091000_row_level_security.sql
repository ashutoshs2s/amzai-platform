-- =============================================================================
-- Row level security. SPEC.md section 5.
--
--   admin, engagement_lead   see everything
--   delivery_lead, specialist see only programmes they are assigned to
--   data_ops                 sees contacts, companies and engagement_events in
--                            full, and reaches organisations and programs only
--                            through a restricted view
--   anon                     sees nothing, anywhere
--
-- No policy reads a role directly out of `users`; that recurses, because
-- reading `users` would trigger the policy on `users`. Every policy asks a
-- SECURITY DEFINER helper instead, which runs as its owner and is therefore not
-- subject to the policy it is being consulted for.
--
-- Client-facing routes are not covered by any of this. They run under the
-- service role, which bypasses row level security entirely, and their token and
-- session checks are the whole access control. SPEC.md section 5.
--
-- Re-runnable: policies are dropped before being created.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Helpers
--
-- SECURITY DEFINER, with search_path pinned so nothing can be shadowed by a
-- caller-controlled schema.
-- -----------------------------------------------------------------------------

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role from public.users u where u.id = auth.uid() and u.active
$$;

comment on function public.current_user_role() is
  'The signed-in staff member''s role. SECURITY DEFINER so policies on users do not recurse.';

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() is not null
$$;

create or replace function public.sees_all_programs()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'engagement_lead')
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin'
$$;

-- Who may create and change programmes, organisations and assignments.
create or replace function public.can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'engagement_lead')
$$;

create or replace function public.can_see_program(p_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.current_user_role()
    when 'admin' then true
    when 'engagement_lead' then true
    when 'delivery_lead' then exists (
      select 1 from public.program_assignments pa
      where pa.program_id = p_program_id and pa.user_id = auth.uid()
    )
    when 'specialist' then exists (
      select 1 from public.program_assignments pa
      where pa.program_id = p_program_id and pa.user_id = auth.uid()
    )
    else false
  end
$$;

comment on function public.can_see_program(uuid) is
  'delivery_lead and specialist see only programmes they are assigned to. data_ops sees none, and reaches programmes through programs_restricted instead.';

-- data_ops sees the audience database in full.
create or replace function public.can_see_audience()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'engagement_lead', 'data_ops')
$$;


-- -----------------------------------------------------------------------------
-- Grants
--
-- anon gets nothing at all. SPEC.md section 5: no anonymous access to any
-- table. Revoking is what makes that true; a missing policy alone would not,
-- because a future policy could quietly open it up.
-- -----------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- audit_events is append-only. Insert only, for everyone.
revoke update, delete on public.audit_events from authenticated;
revoke update, delete on public.audit_events from anon;


-- -----------------------------------------------------------------------------
-- Enable RLS on every table
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'organisations', 'users', 'programs', 'program_assignments',
    'program_role_resolutions', 'onboarding_templates',
    'onboarding_template_fields', 'onboarding_responses', 'client_contacts',
    'client_link_requests', 'client_sessions', 'companies', 'contacts',
    'engagement_events', 'audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- Policies
--
-- Written as drop-then-create so this migration can run twice.
-- -----------------------------------------------------------------------------

-- users --------------------------------------------------------------------
-- Every staff member can read the staff list; names appear all over the app.
-- Only an admin can change it.
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (public.is_staff());

drop policy if exists users_write on public.users;
create policy users_write on public.users
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- organisations ------------------------------------------------------------
-- Leads see all. delivery_lead and specialist see an organisation only if they
-- are assigned to one of its programmes. data_ops sees none of this table and
-- uses organisations_restricted.
drop policy if exists organisations_select on public.organisations;
create policy organisations_select on public.organisations
  for select to authenticated
  using (
    public.sees_all_programs()
    or exists (
      select 1
      from public.programs p
      join public.program_assignments pa on pa.program_id = p.id
      where p.organisation_id = organisations.id
        and pa.user_id = auth.uid()
        and public.current_user_role() in ('delivery_lead', 'specialist')
    )
  );

drop policy if exists organisations_write on public.organisations;
create policy organisations_write on public.organisations
  for all to authenticated
  using (public.can_manage())
  with check (public.can_manage());

-- programs -----------------------------------------------------------------
drop policy if exists programs_select on public.programs;
create policy programs_select on public.programs
  for select to authenticated
  using (public.can_see_program(id));

drop policy if exists programs_write on public.programs;
create policy programs_write on public.programs
  for all to authenticated
  using (public.can_manage())
  with check (public.can_manage());

-- program_assignments ------------------------------------------------------
drop policy if exists program_assignments_select on public.program_assignments;
create policy program_assignments_select on public.program_assignments
  for select to authenticated
  using (public.can_see_program(program_id));

drop policy if exists program_assignments_write on public.program_assignments;
create policy program_assignments_write on public.program_assignments
  for all to authenticated
  using (public.can_manage())
  with check (public.can_manage());

-- program_role_resolutions -------------------------------------------------
drop policy if exists prr_select on public.program_role_resolutions;
create policy prr_select on public.program_role_resolutions
  for select to authenticated
  using (public.can_see_program(program_id));

drop policy if exists prr_write on public.program_role_resolutions;
create policy prr_write on public.program_role_resolutions
  for all to authenticated
  using (public.can_manage())
  with check (public.can_manage());

-- onboarding_templates and their fields ------------------------------------
-- Not programme-specific. Every staff member reads them; admins maintain them.
drop policy if exists onboarding_templates_select on public.onboarding_templates;
create policy onboarding_templates_select on public.onboarding_templates
  for select to authenticated
  using (public.is_staff());

drop policy if exists onboarding_templates_write on public.onboarding_templates;
create policy onboarding_templates_write on public.onboarding_templates
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists otf_select on public.onboarding_template_fields;
create policy otf_select on public.onboarding_template_fields
  for select to authenticated
  using (public.is_staff());

drop policy if exists otf_write on public.onboarding_template_fields;
create policy otf_write on public.onboarding_template_fields
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- onboarding_responses -----------------------------------------------------
-- Anyone who can see the programme can read and edit its onboarding. That is
-- the point of an assignment.
drop policy if exists onboarding_responses_select on public.onboarding_responses;
create policy onboarding_responses_select on public.onboarding_responses
  for select to authenticated
  using (public.can_see_program(program_id));

drop policy if exists onboarding_responses_write on public.onboarding_responses;
create policy onboarding_responses_write on public.onboarding_responses
  for all to authenticated
  using (public.can_see_program(program_id))
  with check (public.can_see_program(program_id));

-- client_contacts, link requests and sessions ------------------------------
-- Scoped to the programme. Client-facing routes reach these under the service
-- role and are not covered by these policies.
drop policy if exists client_contacts_select on public.client_contacts;
create policy client_contacts_select on public.client_contacts
  for select to authenticated
  using (public.can_see_program(program_id));

drop policy if exists client_contacts_write on public.client_contacts;
create policy client_contacts_write on public.client_contacts
  for all to authenticated
  using (public.can_see_program(program_id))
  with check (public.can_see_program(program_id));

drop policy if exists client_link_requests_select on public.client_link_requests;
create policy client_link_requests_select on public.client_link_requests
  for select to authenticated
  using (public.can_see_program(program_id));

drop policy if exists client_sessions_select on public.client_sessions;
create policy client_sessions_select on public.client_sessions
  for select to authenticated
  using (public.can_see_program(program_id));

-- companies, contacts, engagement_events -----------------------------------
-- The audience database. data_ops sees it in full, alongside the leads.
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select to authenticated
  using (public.can_see_audience());

drop policy if exists companies_write on public.companies;
create policy companies_write on public.companies
  for all to authenticated
  using (public.can_see_audience())
  with check (public.can_see_audience());

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select to authenticated
  using (public.can_see_audience());

drop policy if exists contacts_write on public.contacts;
create policy contacts_write on public.contacts
  for all to authenticated
  using (public.can_see_audience())
  with check (public.can_see_audience());

-- Engagement history: the audience roles see all of it, and a delivery lead or
-- specialist sees the events belonging to their own programmes.
drop policy if exists engagement_events_select on public.engagement_events;
create policy engagement_events_select on public.engagement_events
  for select to authenticated
  using (
    public.can_see_audience()
    or (program_id is not null and public.can_see_program(program_id))
  );

drop policy if exists engagement_events_write on public.engagement_events;
create policy engagement_events_write on public.engagement_events
  for all to authenticated
  using (public.can_see_audience())
  with check (public.can_see_audience());

-- audit_events -------------------------------------------------------------
-- Readable by the roles accountable for the record. Insert is open to staff so
-- the trigger can write on anyone's behalf; update and delete have no policy at
-- all and are revoked besides.
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (public.sees_all_programs());

drop policy if exists audit_events_insert on public.audit_events;
create policy audit_events_insert on public.audit_events
  for insert to authenticated
  with check (true);


-- -----------------------------------------------------------------------------
-- Restricted views for data_ops
--
-- SPEC.md section 5: data_ops reaches organisations and programs only through a
-- restricted view exposing name, type and dates, and has no access to the base
-- tables. Row level security cannot hide a column, so the column list is the
-- mechanism and these views are it.
--
-- The views run with their owner's rights, not the caller's, so they can read
-- past the base-table policies that exclude data_ops. The role check lives
-- inside the view, which is what stops anyone else using them as a way round
-- their own restrictions.
-- -----------------------------------------------------------------------------

create or replace view public.organisations_restricted as
  select o.id, o.name, o.trading_name, o.vertical, o.sub_vertical, o.status
  from public.organisations o
  where public.current_user_role() = 'data_ops';

create or replace view public.programs_restricted as
  select p.id, p.organisation_id, p.name, p.type, p.status,
         p.start_date, p.end_date, p.fixed_milestone_date
  from public.programs p
  where public.current_user_role() = 'data_ops';

comment on view public.programs_restricted is
  'data_ops only. Name, type and dates. No currency, no approver, no dashboard token.';

revoke all on public.organisations_restricted from anon;
revoke all on public.programs_restricted from anon;
grant select on public.organisations_restricted to authenticated;
grant select on public.programs_restricted to authenticated;
