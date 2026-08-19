-- =============================================================================
-- A programme's named leads follow from its team.
--
-- The new client form captures who holds engagement lead and delivery lead in
-- program_assignments, but never set programs.engagement_lead_id or
-- delivery_lead_id. The programme list reads its Owner column from
-- delivery_lead_id, so a programme created through the form read "Unassigned"
-- while having a delivery lead sitting in its team.
--
-- Derived rather than asked. The form already collects the answer, and asking
-- the same question twice invites the two to disagree — at which point nobody
-- can say which one is true.
--
-- Where more than one person holds the role, the column is left null rather
-- than picking one. That is the same rule generation follows for assigning
-- questions (SPEC.md 4.3): the platform does not break a tie by order or by
-- allocation, because a wrong guess about who owns something stays invisible
-- until somebody misses a deadline. An admin naming the lead on the programme
-- is the fix, and "Unassigned" beside a two-lead team is at least true.
-- =============================================================================


/**
 * The one person holding a role on a programme, or null if it is nobody or
 * more than one.
 */
create or replace function public.sole_holder_of(p_program_id uuid, p_role text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- array_agg rather than min: Postgres has no min() for uuid.
  select case when count(*) = 1 then (array_agg(pa.user_id))[1] end
  from public.program_assignments pa
  where pa.program_id = p_program_id and pa.role_on_program = p_role
$$;

comment on function public.sole_holder_of(uuid, text) is
  'The single holder of a role on a programme, or null where nobody or more than one holds it. Never breaks a tie.';


create or replace function public.create_client_programme(
  p_organisation_name text,
  p_organisation_slug text,
  p_client_type_id    uuid,
  p_sub_segment_id    uuid,
  p_category          text,
  p_programme_name    text,
  p_programme_slug    text,
  p_programme_type    text,
  p_start_date        date,
  p_end_date          date,
  p_milestone_date    date,
  p_gate_date         date,
  p_modules           text[],
  p_assignments       jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_organisation_id uuid;
  v_programme_id    uuid;
  v_assignments     integer;
begin
  if coalesce(trim(p_organisation_name), '') = '' then
    raise exception 'The organisation needs a name.';
  end if;
  if coalesce(trim(p_programme_name), '') = '' then
    raise exception 'The programme needs a name.';
  end if;

  -- SPEC.md 4.2, checked before anything is written rather than after.
  select count(*) into v_assignments
  from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb));

  if v_assignments = 0 then
    raise exception 'Assign at least one person to the programme. Without a team every onboarding field generates unassigned, and unassigned work is invisible work.';
  end if;

  /*
    An existing organisation is reused rather than duplicated. Two programmes
    for the same client is the normal case, and a second organisation row for
    the same company would split their history in half.
  */
  select id into v_organisation_id
  from public.organisations where slug = p_organisation_slug;

  if v_organisation_id is null then
    insert into public.organisations
      (name, slug, client_type_id, sub_segment_id, category, status)
    values
      (trim(p_organisation_name), p_organisation_slug, p_client_type_id,
       p_sub_segment_id, nullif(trim(coalesce(p_category, '')), ''), 'active')
    returning id into v_organisation_id;
  end if;

  insert into public.programs
    (organisation_id, name, slug, type, status,
     start_date, end_date, fixed_milestone_date, gate_date)
  values
    (v_organisation_id, trim(p_programme_name), p_programme_slug, p_programme_type,
     'onboarding', p_start_date, p_end_date, p_milestone_date, p_gate_date)
  returning id into v_programme_id;

  insert into public.program_assignments (program_id, user_id, role_on_program)
  select v_programme_id, (a->>'user_id')::uuid, a->>'role_on_program'
  from jsonb_array_elements(p_assignments) as a;

  -- The named leads follow from the team just written. Null where the role is
  -- held by nobody, or by more than one person.
  update public.programs
  set engagement_lead_id = public.sole_holder_of(v_programme_id, 'engagement_lead'),
      delivery_lead_id   = public.sole_holder_of(v_programme_id, 'delivery_lead')
  where id = v_programme_id;

  /*
    Situational modules are chosen at programme creation and held by slug until
    generation settles which version answers them. SPEC.md 4.1.
  */
  if p_modules is not null and array_length(p_modules, 1) > 0 then
    insert into public.program_situational_modules (program_id, module_slug)
    select v_programme_id, unnest(p_modules);
  end if;

  return v_programme_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- The programmes already created without them
--
-- Only where the column is empty, so a lead somebody named by hand is never
-- overwritten by a derivation, and only where exactly one person holds the role.
-- -----------------------------------------------------------------------------

update public.programs p
set engagement_lead_id = public.sole_holder_of(p.id, 'engagement_lead')
where p.engagement_lead_id is null
  and public.sole_holder_of(p.id, 'engagement_lead') is not null;

update public.programs p
set delivery_lead_id = public.sole_holder_of(p.id, 'delivery_lead')
where p.delivery_lead_id is null
  and public.sole_holder_of(p.id, 'delivery_lead') is not null;
