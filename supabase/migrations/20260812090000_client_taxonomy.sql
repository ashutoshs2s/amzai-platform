-- =============================================================================
-- Client taxonomy: client type, sub-segment, category.
--
-- Replaces the flat vertical / sub_vertical pair, which had two problems. It
-- lived in a CHECK constraint and a TypeScript file, so neither an admin nor
-- anyone else could change it without a deploy; and it had no room for the
-- specific category beneath a sub-segment, which changes every quarter.
--
-- Three levels now:
--   client type    Law Firms, B2B Tech, Conference Organizers
--   sub-segment    a row in client_sub_segments, admin editable
--   category       free text, deliberately unconstrained
--
-- The category is not an enum and never will be. Privileged Access Management
-- sits under Security today; next quarter there will be three more like it, and
-- a migration per category is not a workable way to run a taxonomy.
--
-- Belonging is enforced by a composite foreign key rather than a trigger, so a
-- sub-segment from the wrong client type is impossible rather than merely
-- discouraged. That also enforces "Law Firms has no sub-segments" for free:
-- no sub-segment row carries the Law Firms type, so any value at all fails.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.client_types (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null,
  label      text not null,
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint client_types_slug_unique unique (slug),
  constraint client_types_slug_format check (slug ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  -- Referenced by the composite key on client_sub_segments.
  constraint client_types_id_slug_unique unique (id, slug)
);

create table if not exists public.client_sub_segments (
  id             uuid primary key default gen_random_uuid(),
  client_type_id uuid not null references public.client_types (id) on delete restrict,
  slug           text not null,
  label          text not null,
  sort_order     integer not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint client_sub_segments_slug_unique unique (client_type_id, slug),
  constraint client_sub_segments_slug_format check (slug ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  -- Lets organisations prove a sub-segment belongs to its client type.
  constraint client_sub_segments_id_type_unique unique (id, client_type_id)
);

comment on table public.client_sub_segments is
  'Level one beneath the client type. Admin editable: adding one is a row, not a deploy.';

create index if not exists client_sub_segments_type_idx
  on public.client_sub_segments (client_type_id, sort_order);


-- -----------------------------------------------------------------------------
-- Reference data
--
-- In the migration rather than the seed because the application cannot work
-- without it and every environment must agree. An admin edits it afterwards;
-- these are the starting values, not the permitted ones.
-- -----------------------------------------------------------------------------

insert into public.client_types (slug, label, sort_order) values
  ('law_firms', 'Law Firms', 1),
  ('b2b_tech', 'B2B Tech', 2),
  ('conference_organizers', 'Conference Organizers', 3)
on conflict (slug) do update set label = excluded.label, sort_order = excluded.sort_order;

insert into public.client_sub_segments (client_type_id, slug, label, sort_order)
select t.id, v.slug, v.label, v.sort_order
from public.client_types t
join (values
  ('artificial_intelligence',   'Artificial Intelligence',            1),
  ('security',                  'Security',                           2),
  ('analytics',                 'Analytics',                          3),
  ('data_privacy',              'Data Privacy',                       4),
  ('development_devops',        'Development and DevOps',             5),
  ('collaboration_productivity','Collaboration and Productivity',      6),
  ('content_management',        'Content Management',                 7),
  ('customer_service',          'Customer Service',                   8),
  ('sales_tools',               'Sales Tools',                        9),
  ('marketing',                 'Marketing',                         10),
  ('commerce',                  'Commerce',                          11),
  ('erp',                       'ERP',                               12),
  ('governance_risk_compliance','Governance Risk and Compliance',     13),
  ('digital_advertising',       'Digital Advertising',               14),
  ('ar_vr',                     'AR and VR',                         15),
  ('cad_plm',                   'CAD and PLM',                       16),
  ('design',                    'Design',                            17),
  ('it_infrastructure',         'IT Infrastructure',                 18),
  ('it_management',             'IT Management',                     19),
  ('hr',                        'HR',                                20),
  ('vertical_industry_software','Vertical Industry Software',        21),
  ('supply_chain_logistics',    'Supply Chain and Logistics',        22),
  ('hosting',                   'Hosting',                           23),
  ('b2b_marketplaces',          'B2B Marketplaces',                  24),
  ('other',                     'Other',                             25)
) as v(slug, label, sort_order) on t.slug = 'b2b_tech'
on conflict (client_type_id, slug) do update
  set label = excluded.label, sort_order = excluded.sort_order;

insert into public.client_sub_segments (client_type_id, slug, label, sort_order)
select t.id, v.slug, v.label, v.sort_order
from public.client_types t
join (values
  ('b2b_media',                'B2B Media',                1),
  ('association',              'Association',              2),
  ('amc',                      'AMC',                      3),
  ('trade_show_organizer',     'Trade Show Organizer',     4),
  ('hosted_buyer_organizer',   'Hosted Buyer Organizer',   5),
  ('community_event_organizer','Community Event Organizer', 6)
) as v(slug, label, sort_order) on t.slug = 'conference_organizers'
on conflict (client_type_id, slug) do update
  set label = excluded.label, sort_order = excluded.sort_order;

-- Law Firms is not subdivided. No rows, on purpose: the composite key below
-- then makes a sub-segment on a law firm impossible rather than merely wrong.


-- -----------------------------------------------------------------------------
-- organisations
-- -----------------------------------------------------------------------------

alter table public.organisations
  add column if not exists client_type_id uuid references public.client_types (id) on delete restrict,
  add column if not exists sub_segment_id uuid,
  add column if not exists category text;

comment on column public.organisations.category is
  'Level two, free text. Privileged Access Management under Security. Never constrained: these change every quarter.';


-- -----------------------------------------------------------------------------
-- Backfill
--
-- The old sub-verticals were coarser in some places and finer in others. Where
-- the new sub-segment is coarser, the old value is preserved as the category
-- rather than thrown away.
-- -----------------------------------------------------------------------------

/*
  A one-time backfill, guarded so the migration can run twice. The second run
  finds no `vertical` column, because the first run dropped it, and skips the
  whole block. PL/pgSQL only resolves column references when a statement
  actually executes, so the unreachable branch costs nothing.
*/
do $backfill$
declare unmapped integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organisations'
      and column_name = 'vertical'
  ) then
    return;
  end if;

  update public.organisations o
  set client_type_id = t.id
  from public.client_types t
  where t.slug = o.vertical and o.client_type_id is null;

  update public.organisations o
  set sub_segment_id = s.id,
      category = coalesce(o.category, m.category)
  from (values
  ('cybersecurity',             'security',                   null),
  ('identity_access',           'security',                   'Identity and Access Management'),
  ('cloud_infrastructure',      'it_infrastructure',          'Cloud Infrastructure'),
  ('data_analytics',            'analytics',                  null),
  ('ai_ml',                     'artificial_intelligence',    null),
  ('devops_engineering',        'development_devops',         null),
  ('networking',                'it_infrastructure',          'Networking'),
  ('observability',             'it_management',              'Observability'),
  ('storage_backup',            'it_infrastructure',          'Storage and Backup'),
  ('fintech',                   'vertical_industry_software', 'FinTech'),
  ('martech',                   'marketing',                  'MarTech'),
  ('hr_tech',                   'hr',                         null),
  ('supply_chain_tech',         'supply_chain_logistics',     null),
  ('healthcare_tech',           'vertical_industry_software', 'Healthcare Tech'),
  ('erp_business_applications', 'erp',                        null),
  ('customer_experience',       'customer_service',           'Customer Experience'),
  ('associations',              'association',                null),
  ('amcs',                      'amc',                        null),
  ('b2b_media',                 'b2b_media',                  null),
  ('trade_show_organizers',     'trade_show_organizer',       null)
) as m(old_slug, new_slug, category)
  join public.client_sub_segments s on s.slug = m.new_slug
  join public.client_types t on t.id = s.client_type_id
  -- t.slug = o.vertical belongs here, not in the JOIN: the update target is not
  -- in scope inside a FROM-clause join condition.
  where o.sub_vertical = m.old_slug
    and t.slug = o.vertical
    and o.sub_segment_id is null;

  -- BeyondTrust is privileged access management specifically, which is finer
  -- than the generic mapping can know. Named because it is a one-off
  -- correction to seeded data, not a rule.
  update public.organisations
  set category = 'Privileged Access Management'
  where slug = 'beyondtrust' and category = 'Identity and Access Management';

  -- Anything unclassified would fail the not-null below, so say so here where
  -- the reason is visible rather than as a constraint violation.
  select count(*) into unmapped
  from public.organisations where client_type_id is null;
  if unmapped > 0 then
    raise exception 'Cannot set client_type_id not null: % organisations did not map', unmapped;
  end if;
end;
$backfill$;

alter table public.organisations alter column client_type_id set not null;

alter table public.organisations
  drop constraint if exists organisations_sub_segment_belongs_to;
alter table public.organisations
  add constraint organisations_sub_segment_belongs_to
  foreign key (sub_segment_id, client_type_id)
  references public.client_sub_segments (id, client_type_id)
  on delete restrict;

create index if not exists organisations_client_type_idx
  on public.organisations (client_type_id);


-- -----------------------------------------------------------------------------
-- onboarding_templates
--
-- Selection keys on the same taxonomy. SPEC.md section 4.1.
-- -----------------------------------------------------------------------------

alter table public.onboarding_templates
  add column if not exists client_type_id uuid references public.client_types (id) on delete restrict,
  add column if not exists sub_segment_id uuid;

do $tpl$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'onboarding_templates'
      and column_name = 'vertical'
  ) then
    update public.onboarding_templates ot
    set client_type_id = t.id
    from public.client_types t
    where t.slug = ot.vertical and ot.client_type_id is null;
  end if;
end;
$tpl$;

alter table public.onboarding_templates
  drop constraint if exists onboarding_templates_sub_segment_belongs_to;
alter table public.onboarding_templates
  add constraint onboarding_templates_sub_segment_belongs_to
  foreign key (sub_segment_id, client_type_id)
  references public.client_sub_segments (id, client_type_id)
  on delete restrict;

-- A sub-segment only has meaning inside its client type, as before.
alter table public.onboarding_templates
  drop constraint if exists onboarding_templates_sub_segment_needs_type;
alter table public.onboarding_templates
  add constraint onboarding_templates_sub_segment_needs_type
  check (sub_segment_id is null or client_type_id is not null);

create index if not exists onboarding_templates_taxonomy_idx
  on public.onboarding_templates (program_type, client_type_id, sub_segment_id, version desc)
  where active;


-- -----------------------------------------------------------------------------
-- Retire the old columns
--
-- The restricted view selects them, so it has to be rebuilt first or the drop
-- is refused.
-- -----------------------------------------------------------------------------

drop view if exists public.organisations_restricted;

alter table public.organisations
  drop constraint if exists organisations_sub_vertical_valid,
  drop constraint if exists organisations_vertical_valid;
alter table public.onboarding_templates
  drop constraint if exists onboarding_templates_sub_vertical_valid,
  drop constraint if exists onboarding_templates_vertical_valid,
  drop constraint if exists onboarding_templates_sub_vertical_needs_vertical;

alter table public.organisations
  drop column if exists vertical,
  drop column if exists sub_vertical;
alter table public.onboarding_templates
  drop column if exists vertical,
  drop column if exists sub_vertical;

drop function if exists public.sub_vertical_belongs_to(text, text);

create view public.organisations_restricted
  with (security_barrier = true) as
  select o.id, o.name, o.trading_name, o.client_type_id, o.sub_segment_id,
         o.category, o.status
  from public.organisations o
  where public.current_user_role() = 'data_ops';

comment on view public.organisations_restricted is
  'data_ops only. security_barrier so no caller-supplied predicate can be evaluated below the role check.';

revoke all on public.organisations_restricted from anon;
revoke all on public.organisations_restricted from service_role;
grant select on public.organisations_restricted to authenticated;


-- -----------------------------------------------------------------------------
-- Row level security on the taxonomy
--
-- Every staff member reads it; only an admin changes it. It is reference data
-- the whole product depends on, so a wrong edit is expensive.
-- -----------------------------------------------------------------------------

alter table public.client_types enable row level security;
alter table public.client_sub_segments enable row level security;

grant select, insert, update, delete on public.client_types to authenticated;
grant select, insert, update, delete on public.client_sub_segments to authenticated;
grant all privileges on public.client_types to service_role;
grant all privileges on public.client_sub_segments to service_role;
revoke all on public.client_types from anon;
revoke all on public.client_sub_segments from anon;

drop policy if exists client_types_select on public.client_types;
create policy client_types_select on public.client_types
  for select to authenticated using ((select public.is_staff()));
drop policy if exists client_types_insert on public.client_types;
create policy client_types_insert on public.client_types
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists client_types_update on public.client_types;
create policy client_types_update on public.client_types
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists client_types_delete on public.client_types;
create policy client_types_delete on public.client_types
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists client_sub_segments_select on public.client_sub_segments;
create policy client_sub_segments_select on public.client_sub_segments
  for select to authenticated using ((select public.is_staff()));
drop policy if exists client_sub_segments_insert on public.client_sub_segments;
create policy client_sub_segments_insert on public.client_sub_segments
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists client_sub_segments_update on public.client_sub_segments;
create policy client_sub_segments_update on public.client_sub_segments
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists client_sub_segments_delete on public.client_sub_segments;
create policy client_sub_segments_delete on public.client_sub_segments
  for delete to authenticated using ((select public.is_admin()));


-- -----------------------------------------------------------------------------
-- Conventions: updated_at and audit on both new tables
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['client_types', 'client_sub_segments']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
    execute format('drop trigger if exists record_audit on public.%I', t);
    execute format(
      'create trigger record_audit after insert or update or delete on public.%I
         for each row execute function public.record_audit_event()', t);
  end loop;
end;
$$;
