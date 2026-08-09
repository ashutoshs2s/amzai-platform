-- =============================================================================
-- Two advisor performance findings. Neither is a security problem and neither
-- matters at this scale, but both fixes are cheap and neither weakens a policy.
--
-- 1. auth_rls_initplan, on organisations_select.
--
--    A policy calling auth.uid() directly has it re-evaluated once per row.
--    Wrapping it in a scalar subquery, (select auth.uid()), makes the planner
--    hoist it into an InitPlan evaluated once per statement. The same applies
--    to the no-argument helpers: is_staff(), can_manage(), sees_all_programs(),
--    is_admin(), can_see_audience(), current_user_role().
--
--    can_see_program(id) is deliberately left alone. It takes the row's own id,
--    so it genuinely depends on the row and cannot be hoisted.
--
-- 2. multiple_permissive_policies, on twelve (table, action) pairs.
--
--    Every write policy was written FOR ALL, and FOR ALL includes SELECT. So
--    each of those tables had two permissive policies covering SELECT, which
--    Postgres must evaluate and OR together for every row.
--
--    Splitting FOR ALL into explicit INSERT, UPDATE and DELETE policies leaves
--    exactly one policy per action. Nothing is lost: on every one of those
--    tables the write predicate was already a subset of the select predicate
--    (can_manage is a subset of sees_all_programs, is_admin of is_staff, and
--    the audience and programme predicates were identical), so the OR never
--    granted a read that the select policy did not already grant. The test
--    suite is what proves that rather than this comment.
--
--    The secondary benefit is readability: answering "who can read this table"
--    stops requiring two policies to be OR-ed together in your head.
--
-- Re-runnable: every policy is dropped before being created.
-- =============================================================================



-- Drop every policy this migration manages, old names and new, so it can be
-- applied twice. The first run clears the FOR ALL policies it replaces; every
-- later run clears what the previous run created.
do $$
declare
  p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and policyname in (
      'audit_events_select',
      'client_contacts_delete',
      'client_contacts_insert',
      'client_contacts_select',
      'client_contacts_update',
      'client_contacts_write',
      'client_link_requests_select',
      'client_sessions_select',
      'companies_delete',
      'companies_insert',
      'companies_select',
      'companies_update',
      'companies_write',
      'contacts_delete',
      'contacts_insert',
      'contacts_select',
      'contacts_update',
      'contacts_write',
      'engagement_events_delete',
      'engagement_events_insert',
      'engagement_events_select',
      'engagement_events_update',
      'engagement_events_write',
      'onboarding_responses_delete',
      'onboarding_responses_insert',
      'onboarding_responses_select',
      'onboarding_responses_update',
      'onboarding_responses_write',
      'onboarding_templates_delete',
      'onboarding_templates_insert',
      'onboarding_templates_select',
      'onboarding_templates_update',
      'onboarding_templates_write',
      'organisations_delete',
      'organisations_insert',
      'organisations_select',
      'organisations_update',
      'organisations_write',
      'otf_delete',
      'otf_insert',
      'otf_select',
      'otf_update',
      'otf_write',
      'program_assignments_delete',
      'program_assignments_insert',
      'program_assignments_select',
      'program_assignments_update',
      'program_assignments_write',
      'programs_delete',
      'programs_insert',
      'programs_select',
      'programs_update',
      'programs_write',
      'prr_delete',
      'prr_insert',
      'prr_select',
      'prr_update',
      'prr_write',
      'users_delete',
      'users_insert',
      'users_select',
      'users_update',
      'users_write'
    )
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end;
$$;


-- users ----------------------------------------------------------------------

create policy users_select on public.users
  for select to authenticated using ((select public.is_staff()));
create policy users_insert on public.users
  for insert to authenticated with check ((select public.is_admin()));
create policy users_update on public.users
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy users_delete on public.users
  for delete to authenticated using ((select public.is_admin()));


-- organisations --------------------------------------------------------------

create policy organisations_select on public.organisations
  for select to authenticated
  using (
    (select public.sees_all_programs())
    or exists (
      select 1
      from public.programs p
      join public.program_assignments pa on pa.program_id = p.id
      where p.organisation_id = organisations.id
        and pa.user_id = (select auth.uid())
        and (select public.current_user_role()) in ('delivery_lead', 'specialist')
    )
  );
create policy organisations_insert on public.organisations
  for insert to authenticated with check ((select public.can_manage()));
create policy organisations_update on public.organisations
  for update to authenticated
  using ((select public.can_manage())) with check ((select public.can_manage()));
create policy organisations_delete on public.organisations
  for delete to authenticated using ((select public.can_manage()));


-- programs -------------------------------------------------------------------

create policy programs_select on public.programs
  for select to authenticated using (public.can_see_program(id));
create policy programs_insert on public.programs
  for insert to authenticated with check ((select public.can_manage()));
create policy programs_update on public.programs
  for update to authenticated
  using ((select public.can_manage())) with check ((select public.can_manage()));
create policy programs_delete on public.programs
  for delete to authenticated using ((select public.can_manage()));


-- program_assignments --------------------------------------------------------

create policy program_assignments_select on public.program_assignments
  for select to authenticated using (public.can_see_program(program_id));
create policy program_assignments_insert on public.program_assignments
  for insert to authenticated with check ((select public.can_manage()));
create policy program_assignments_update on public.program_assignments
  for update to authenticated
  using ((select public.can_manage())) with check ((select public.can_manage()));
create policy program_assignments_delete on public.program_assignments
  for delete to authenticated using ((select public.can_manage()));


-- program_role_resolutions ---------------------------------------------------

create policy prr_select on public.program_role_resolutions
  for select to authenticated using (public.can_see_program(program_id));
create policy prr_insert on public.program_role_resolutions
  for insert to authenticated with check ((select public.can_manage()));
create policy prr_update on public.program_role_resolutions
  for update to authenticated
  using ((select public.can_manage())) with check ((select public.can_manage()));
create policy prr_delete on public.program_role_resolutions
  for delete to authenticated using ((select public.can_manage()));


-- onboarding_templates -------------------------------------------------------

create policy onboarding_templates_select on public.onboarding_templates
  for select to authenticated using ((select public.is_staff()));
create policy onboarding_templates_insert on public.onboarding_templates
  for insert to authenticated with check ((select public.is_admin()));
create policy onboarding_templates_update on public.onboarding_templates
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy onboarding_templates_delete on public.onboarding_templates
  for delete to authenticated using ((select public.is_admin()));


-- onboarding_template_fields -------------------------------------------------

create policy otf_select on public.onboarding_template_fields
  for select to authenticated using ((select public.is_staff()));
create policy otf_insert on public.onboarding_template_fields
  for insert to authenticated with check ((select public.is_admin()));
create policy otf_update on public.onboarding_template_fields
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy otf_delete on public.onboarding_template_fields
  for delete to authenticated using ((select public.is_admin()));


-- onboarding_responses -------------------------------------------------------

create policy onboarding_responses_select on public.onboarding_responses
  for select to authenticated using (public.can_see_program(program_id));
create policy onboarding_responses_insert on public.onboarding_responses
  for insert to authenticated with check (public.can_see_program(program_id));
create policy onboarding_responses_update on public.onboarding_responses
  for update to authenticated
  using (public.can_see_program(program_id))
  with check (public.can_see_program(program_id));
create policy onboarding_responses_delete on public.onboarding_responses
  for delete to authenticated using (public.can_see_program(program_id));


-- client_contacts ------------------------------------------------------------

create policy client_contacts_select on public.client_contacts
  for select to authenticated using (public.can_see_program(program_id));
create policy client_contacts_insert on public.client_contacts
  for insert to authenticated with check (public.can_see_program(program_id));
create policy client_contacts_update on public.client_contacts
  for update to authenticated
  using (public.can_see_program(program_id))
  with check (public.can_see_program(program_id));
create policy client_contacts_delete on public.client_contacts
  for delete to authenticated using (public.can_see_program(program_id));


-- client_link_requests and client_sessions -----------------------------------
-- Read-only to staff already; only the helper call needs hoisting.
create policy client_link_requests_select on public.client_link_requests
  for select to authenticated using (public.can_see_program(program_id));

create policy client_sessions_select on public.client_sessions
  for select to authenticated using (public.can_see_program(program_id));


-- companies ------------------------------------------------------------------

create policy companies_select on public.companies
  for select to authenticated using ((select public.can_see_audience()));
create policy companies_insert on public.companies
  for insert to authenticated with check ((select public.can_see_audience()));
create policy companies_update on public.companies
  for update to authenticated
  using ((select public.can_see_audience()))
  with check ((select public.can_see_audience()));
create policy companies_delete on public.companies
  for delete to authenticated using ((select public.can_see_audience()));


-- contacts -------------------------------------------------------------------

create policy contacts_select on public.contacts
  for select to authenticated using ((select public.can_see_audience()));
create policy contacts_insert on public.contacts
  for insert to authenticated with check ((select public.can_see_audience()));
create policy contacts_update on public.contacts
  for update to authenticated
  using ((select public.can_see_audience()))
  with check ((select public.can_see_audience()));
create policy contacts_delete on public.contacts
  for delete to authenticated using ((select public.can_see_audience()));


-- engagement_events ----------------------------------------------------------

create policy engagement_events_select on public.engagement_events
  for select to authenticated
  using (
    (select public.can_see_audience())
    or (program_id is not null and public.can_see_program(program_id))
  );
create policy engagement_events_insert on public.engagement_events
  for insert to authenticated with check ((select public.can_see_audience()));
create policy engagement_events_update on public.engagement_events
  for update to authenticated
  using ((select public.can_see_audience()))
  with check ((select public.can_see_audience()));
create policy engagement_events_delete on public.engagement_events
  for delete to authenticated using ((select public.can_see_audience()));


-- audit_events ---------------------------------------------------------------
-- Already one policy per action. Only the helper call needs hoisting, and
-- update and delete stay unpolicied and revoked.
create policy audit_events_select on public.audit_events
  for select to authenticated using ((select public.sees_all_programs()));
