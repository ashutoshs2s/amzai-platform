-- =============================================================================
-- Creating a client and its first programme, in one transaction.
--
-- SPEC.md section 4 gives the creation sequence as an order, not a preference:
-- organisation, then programme, then team, then generate. Done out of order a
-- programme generates with every field unassigned, and the awaiting-me count
-- that drives the platform reads zero for everyone from day one.
--
-- Through PostgREST that order is four round trips and four transactions. A
-- failure at the third leaves an organisation and a programme with no team,
-- which is the exact half-built state the sequence exists to prevent, and the
-- operator would have to notice and finish it by hand.
--
-- So it happens here. Either all of it lands or none of it does. Generation is
-- deliberately NOT part of this: it is a separate step with a preview the admin
-- approves, per section 4.1a.
--
-- SECURITY INVOKER, so row level security still decides who may write and the
-- audit triggers still record the actor.
-- =============================================================================

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

revoke all on function public.create_client_programme(
  text, text, uuid, uuid, text, text, text, text, date, date, date, date, text[], jsonb
) from public, anon;

grant execute on function public.create_client_programme(
  text, text, uuid, uuid, text, text, text, text, date, date, date, date, text[], jsonb
) to authenticated;

comment on function public.create_client_programme(
  text, text, uuid, uuid, text, text, text, text, date, date, date, date, text[], jsonb
) is
  'Creates an organisation (or reuses one by slug), its programme, its team and its situational module choices in one transaction. Refuses a programme with no team, per SPEC.md 4.2. Does not generate onboarding; that is a separate step with its own preview.';
