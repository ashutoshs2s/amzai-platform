-- =============================================================================
-- Phase one schema. SPEC.md section 3.
--
-- This migration creates tables, keys, constraints, indexes and the updated_at
-- triggers. It deliberately does NOT create:
--
--   * row level security policies  -> next migration
--   * audit triggers               -> the migration after that
--
-- They are separated so each can be tested on its own. A schema that fails and
-- a policy that fails look identical from the application side, and debugging
-- them together is how you end up disabling one to make the other work.
--
-- Re-runnable: every statement is guarded, so applying this twice is a no-op
-- rather than an error. Note that a guarded CREATE TABLE skips the whole table,
-- constraints included, so changes to an existing table belong in a new
-- migration file rather than in edits to this one.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

-- Sets updated_at on every UPDATE. Attached to every table except audit_events.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Maintains updated_at. Attached to every table except audit_events, which is append-only.';


-- The vertical taxonomy, in one place. SPEC.md section 3.
--
-- Used by the check constraints on organisations and onboarding_templates so
-- the sixteen B2B Tech slugs are written once rather than twice. Slugs are
-- stored; their display labels live in lib/verticals.ts and are never stored.
--
-- Changing this list does not re-validate existing rows. A migration that
-- removes a slug must also migrate the rows using it.
create or replace function public.sub_vertical_belongs_to(
  p_vertical text,
  p_sub_vertical text
)
returns boolean
language sql
immutable
as $$
  select case
    when p_vertical is null then p_sub_vertical is null
    when p_vertical = 'law_firms' then p_sub_vertical is null
    when p_vertical = 'b2b_tech' then
      p_sub_vertical is null or p_sub_vertical in (
        'cybersecurity',
        'identity_access',
        'cloud_infrastructure',
        'data_analytics',
        'ai_ml',
        'devops_engineering',
        'networking',
        'observability',
        'storage_backup',
        'fintech',
        'martech',
        'hr_tech',
        'supply_chain_tech',
        'healthcare_tech',
        'erp_business_applications',
        'customer_experience'
      )
    when p_vertical = 'conference_organizers' then
      p_sub_vertical is null or p_sub_vertical in (
        'associations',
        'amcs',
        'b2b_media',
        'trade_show_organizers'
      )
    else false
  end
$$;

comment on function public.sub_vertical_belongs_to(text, text) is
  'True when a sub-vertical slug belongs to its vertical. Law Firms must be null.';


-- -----------------------------------------------------------------------------
-- organisations
-- -----------------------------------------------------------------------------

create table if not exists public.organisations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  trading_name      text,
  slug              text not null,
  slug_locked_at    timestamptz,
  vertical          text not null,
  sub_vertical      text,
  status            text not null default 'prospect',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint organisations_slug_unique unique (slug),
  constraint organisations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint organisations_vertical_valid check (
    vertical in ('b2b_tech', 'law_firms', 'conference_organizers')
  ),
  constraint organisations_sub_vertical_valid check (
    public.sub_vertical_belongs_to(vertical, sub_vertical)
  ),
  constraint organisations_status_valid check (
    status in ('prospect', 'active', 'dormant', 'closed')
  )
);

comment on column public.organisations.slug is
  'Lowercase hyphenated, appears in every client-facing URL. Readability only, never an access control.';
comment on column public.organisations.slug_locked_at is
  'Stamped when the first client-facing link is generated. After that the slug cannot change without breaking sent links.';
comment on column public.organisations.sub_vertical is
  'Slug, not a label. Null for law_firms, which is not subdivided.';


-- -----------------------------------------------------------------------------
-- users
--
-- id matches the Supabase auth user id. No foreign key to auth.users: this
-- migration must run before any staff account exists, and the two are linked by
-- convention at sign-up rather than by a constraint that would block seeding.
-- -----------------------------------------------------------------------------

create table if not exists public.users (
  id           uuid primary key,
  full_name    text not null,
  email        text not null,
  role         text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint users_role_valid check (
    role in ('engagement_lead', 'delivery_lead', 'specialist', 'data_ops', 'admin')
  )
);

create unique index if not exists users_email_unique
  on public.users (lower(email));


-- -----------------------------------------------------------------------------
-- onboarding_templates
--
-- Created before programs, which references it.
-- -----------------------------------------------------------------------------

create table if not exists public.onboarding_templates (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  program_type   text not null,
  vertical       text,
  sub_vertical   text,
  version        integer not null default 1,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint onboarding_templates_program_type_valid check (
    program_type in ('event', 'retainer', 'dedicated_team', 'series', 'research')
  ),
  constraint onboarding_templates_vertical_valid check (
    vertical is null
    or vertical in ('b2b_tech', 'law_firms', 'conference_organizers')
  ),
  -- A sub-vertical only has meaning inside its vertical.
  constraint onboarding_templates_sub_vertical_needs_vertical check (
    sub_vertical is null or vertical is not null
  ),
  constraint onboarding_templates_sub_vertical_valid check (
    public.sub_vertical_belongs_to(vertical, sub_vertical)
  ),
  constraint onboarding_templates_version_positive check (version >= 1)
);

comment on table public.onboarding_templates is
  'Null vertical means applies to every vertical; null sub_vertical means the whole vertical. SPEC.md section 4.1.';

-- Selection reads by programme type then narrows by vertical. SPEC.md 4.1.
create index if not exists onboarding_templates_selection_idx
  on public.onboarding_templates (program_type, vertical, sub_vertical, version desc)
  where active;


-- -----------------------------------------------------------------------------
-- onboarding_template_fields
-- -----------------------------------------------------------------------------

create table if not exists public.onboarding_template_fields (
  id                    uuid primary key default gen_random_uuid(),
  template_id           uuid not null
                          references public.onboarding_templates (id) on delete cascade,
  section               text not null,
  sort_order            integer not null default 0,
  question              text not null,
  guidance              text,
  default_owner         text not null,
  default_assignee_role text,
  default_offset_type   text not null,
  default_offset_value  integer not null default 0,
  blocking              boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint otf_default_owner_valid check (
    default_owner in ('client', 'amzai', 'both')
  ),
  constraint otf_default_assignee_role_valid check (
    default_assignee_role is null
    or default_assignee_role in ('engagement_lead', 'delivery_lead', 'specialist', 'data_ops')
  ),
  constraint otf_offset_type_valid check (
    default_offset_type in ('weeks_from_start', 'days_before_milestone')
  )
);

comment on column public.onboarding_template_fields.default_assignee_role is
  'The job on the programme, not the person. Resolved to a user at generation. SPEC.md section 4.3.';

create index if not exists otf_template_idx
  on public.onboarding_template_fields (template_id, section, sort_order);


-- -----------------------------------------------------------------------------
-- programs
-- -----------------------------------------------------------------------------

create table if not exists public.programs (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null
                              references public.organisations (id) on delete restrict,
  name                      text not null,
  slug                      text not null,
  type                      text not null,
  status                    text not null default 'onboarding',
  currency                  text,
  start_date                date,
  end_date                  date,
  fixed_milestone_date      date,
  gate_date                 date,
  onboarding_template_id    uuid
                              references public.onboarding_templates (id) on delete restrict,
  approver_name             text,
  approver_email            text,
  engagement_lead_id        uuid references public.users (id) on delete restrict,
  delivery_lead_id          uuid references public.users (id) on delete restrict,
  dashboard_token           text,
  dashboard_token_issued_at timestamptz,
  slug_locked_at            timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- Unique within an organisation, not globally. SPEC.md section 3.
  constraint programs_slug_unique_per_org unique (organisation_id, slug),
  constraint programs_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Lets client_contacts prove its organisation matches its programme's, which
  -- a CHECK cannot do because it may not read another table.
  constraint programs_id_org_unique unique (id, organisation_id),
  constraint programs_type_valid check (
    type in ('event', 'retainer', 'dedicated_team', 'series', 'research')
  ),
  constraint programs_status_valid check (
    status in ('onboarding', 'active', 'paused', 'complete')
  ),
  constraint programs_dates_ordered check (
    start_date is null or end_date is null or end_date >= start_date
  ),
  constraint programs_gate_within_range check (
    gate_date is null
    or (
      (start_date is null or gate_date >= start_date)
      and (end_date is null or gate_date <= end_date)
    )
  )
);

comment on column public.programs.dashboard_token is
  'Long-lived bearer token for the client dashboard. Stored in full because operators re-send the same link. Service role reads only; never log it.';
comment on column public.programs.gate_date is
  'Point in a retainer after which remaining time is short. Drives the countdown colour. SPEC.md section 7.2.';

create index if not exists programs_organisation_idx on public.programs (organisation_id);
create index if not exists programs_delivery_lead_idx on public.programs (delivery_lead_id);
create index if not exists programs_status_idx on public.programs (status);


-- -----------------------------------------------------------------------------
-- program_assignments
-- -----------------------------------------------------------------------------

create table if not exists public.program_assignments (
  id                 uuid primary key default gen_random_uuid(),
  program_id         uuid not null references public.programs (id) on delete cascade,
  user_id            uuid not null references public.users (id) on delete restrict,
  role_on_program    text not null,
  allocation_percent integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint program_assignments_unique unique (program_id, user_id, role_on_program),
  -- admin is a system role, not a job on a programme. SPEC.md section 3.
  constraint program_assignments_role_valid check (
    role_on_program in ('engagement_lead', 'delivery_lead', 'specialist', 'data_ops')
  ),
  constraint program_assignments_allocation_range check (
    allocation_percent is null
    or (allocation_percent >= 0 and allocation_percent <= 100)
  )
);

create index if not exists program_assignments_program_idx
  on public.program_assignments (program_id);
create index if not exists program_assignments_user_idx
  on public.program_assignments (user_id);


-- -----------------------------------------------------------------------------
-- program_role_resolutions
--
-- One answer per role per programme, recorded so the admin is never asked the
-- same ambiguous role twice. SPEC.md section 4.5.
-- -----------------------------------------------------------------------------

create table if not exists public.program_role_resolutions (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references public.programs (id) on delete cascade,
  role_on_program text not null,
  user_id         uuid references public.users (id) on delete restrict,
  resolved_by     uuid not null references public.users (id) on delete restrict,
  resolved_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint prr_unique_per_role unique (program_id, role_on_program),
  constraint prr_role_valid check (
    role_on_program in ('engagement_lead', 'delivery_lead', 'specialist', 'data_ops')
  )
);

comment on column public.program_role_resolutions.user_id is
  'Null means the admin deliberately chose to leave this role unassigned. Different from having no row, which means the question was never asked.';


-- -----------------------------------------------------------------------------
-- client_contacts
--
-- Named people at the client who may be sent an onboarding link. Not accounts.
-- -----------------------------------------------------------------------------

create table if not exists public.client_contacts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  program_id      uuid not null,
  name            text not null,
  email           text not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Composite reference, so organisation_id can never drift from the
  -- programme's organisation. SPEC.md section 3.
  constraint client_contacts_program_org_fk
    foreign key (program_id, organisation_id)
    references public.programs (id, organisation_id)
    on delete cascade
);

comment on table public.client_contacts is
  'Client-side counterparts. Deliberately separate from contacts, which is the marketable audience. Never treat a client contact as marketable.';

-- Access is always scoped to one programme, so a person on three programmes
-- has three rows.
create unique index if not exists client_contacts_program_email_unique
  on public.client_contacts (program_id, lower(email));

create index if not exists client_contacts_organisation_idx
  on public.client_contacts (organisation_id);


-- -----------------------------------------------------------------------------
-- onboarding_responses
-- -----------------------------------------------------------------------------

create table if not exists public.onboarding_responses (
  id                    uuid primary key default gen_random_uuid(),
  program_id            uuid not null references public.programs (id) on delete cascade,
  template_field_id     uuid not null
                          references public.onboarding_template_fields (id) on delete restrict,
  response              text,
  owner                 text not null,
  assignee_id           uuid references public.users (id) on delete restrict,
  due_date              date,
  status                text not null default 'not_started',
  blocking              boolean not null default false,
  answer_source         text,
  answered_by           uuid references public.users (id) on delete restrict,
  answered_by_contact_id uuid references public.client_contacts (id) on delete set null,
  answered_at           timestamptz,
  tasks_generated       boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint onboarding_responses_unique_field unique (program_id, template_field_id),
  constraint onboarding_responses_owner_valid check (
    owner in ('client', 'amzai', 'both')
  ),
  constraint onboarding_responses_status_valid check (
    status in ('not_started', 'in_progress', 'submitted', 'approved', 'blocked', 'na')
  ),
  constraint onboarding_responses_answer_source_valid check (
    answer_source is null
    or answer_source in ('amzai_written', 'client_written', 'imported')
  ),
  -- At most one author. Who answered is recorded, never inferred.
  constraint onboarding_responses_single_author check (
    answered_by is null or answered_by_contact_id is null
  ),
  -- A client-written answer names the contact; an Amzai-written one names the
  -- staff member.
  constraint onboarding_responses_author_matches_source check (
    answer_source is distinct from 'client_written' or answered_by is null
  )
);

comment on column public.onboarding_responses.assignee_id is
  'The individual responsible. Drives the awaiting-me count. Distinct from owner, which is the party.';

create index if not exists onboarding_responses_program_idx
  on public.onboarding_responses (program_id);
-- The awaiting-me count in the top bar. SPEC.md section 7.3.
create index if not exists onboarding_responses_assignee_open_idx
  on public.onboarding_responses (assignee_id)
  where status not in ('approved', 'na');
-- The blocking count and the at-risk count.
create index if not exists onboarding_responses_blocking_idx
  on public.onboarding_responses (program_id, due_date)
  where blocking and status <> 'approved';


-- -----------------------------------------------------------------------------
-- client_link_requests
--
-- One row per one-time onboarding link issued. Only ever written for a known,
-- active client contact, so an unrecognised address leaves no row.
-- -----------------------------------------------------------------------------

create table if not exists public.client_link_requests (
  id                uuid primary key default gen_random_uuid(),
  program_id        uuid not null references public.programs (id) on delete cascade,
  client_contact_id uuid not null
                      references public.client_contacts (id) on delete cascade,
  token_hash        text not null,
  expires_at        timestamptz not null,
  consumed_at       timestamptz,
  request_ip        inet,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint client_link_requests_token_hash_unique unique (token_hash),
  constraint client_link_requests_expiry_future check (expires_at > created_at)
);

comment on column public.client_link_requests.token_hash is
  'SHA-256 of the token. The raw token exists only in the emailed URL and is never stored.';

create index if not exists client_link_requests_contact_idx
  on public.client_link_requests (client_contact_id, created_at desc);


-- -----------------------------------------------------------------------------
-- client_sessions
--
-- The email-verified session created by following a valid one-time link.
-- Ours, in our own tables. Not Supabase Auth and not an account.
-- -----------------------------------------------------------------------------

create table if not exists public.client_sessions (
  id                uuid primary key default gen_random_uuid(),
  client_contact_id uuid not null
                      references public.client_contacts (id) on delete cascade,
  program_id        uuid not null references public.programs (id) on delete cascade,
  token_hash        text not null,
  issued_at         timestamptz not null default now(),
  expires_at        timestamptz not null,
  last_seen_at      timestamptz not null default now(),
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint client_sessions_token_hash_unique unique (token_hash),
  constraint client_sessions_expiry_after_issue check (expires_at > issued_at)
);

comment on column public.client_sessions.last_seen_at is
  'Written at most once an hour. This table carries an audit trigger like every other, and updating it per request would fill audit_events with page views.';

create index if not exists client_sessions_contact_idx
  on public.client_sessions (client_contact_id);


-- -----------------------------------------------------------------------------
-- companies
--
-- Target companies in the audience database. companies.industry is NOT the
-- vertical taxonomy: these are the companies we market to on a client's
-- behalf, described however the source described them. organisations.vertical
-- classifies Amzai's own clients. Two populations, two vocabularies.
-- -----------------------------------------------------------------------------

create table if not exists public.companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  domain         text,
  revenue_band   text,
  employee_band  text,
  industry       text,
  country        text,
  signals        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists companies_domain_idx on public.companies (lower(domain));


-- -----------------------------------------------------------------------------
-- contacts
-- -----------------------------------------------------------------------------

create table if not exists public.contacts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid references public.companies (id) on delete set null,
  first_name        text,
  last_name         text,
  email             text,
  title             text,
  seniority         text,
  function          text,
  country           text,
  consent_basis     text,
  source            text,
  suppressed        boolean not null default false,
  suppressed_at     timestamptz,
  suppressed_reason text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Suppression is permanent and global. If it is set, say when.
  constraint contacts_suppressed_has_timestamp check (
    not suppressed or suppressed_at is not null
  )
);

comment on column public.contacts.suppressed is
  'Global. A suppressed contact is never contacted again on any programme for any client. Compliance, not reporting.';

-- One row per person. Multiple NULL emails are permitted by Postgres.
create unique index if not exists contacts_email_unique
  on public.contacts (lower(email));

create index if not exists contacts_company_idx on public.contacts (company_id);
create index if not exists contacts_suppressed_idx on public.contacts (suppressed)
  where suppressed;


-- -----------------------------------------------------------------------------
-- engagement_events
--
-- The history spine. One row per thing that ever happened to a contact.
-- -----------------------------------------------------------------------------

create table if not exists public.engagement_events (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references public.contacts (id) on delete cascade,
  program_id    uuid references public.programs (id) on delete cascade,
  event_type    text not null,
  occurred_at   timestamptz not null default now(),
  source_system text not null default 'platform',
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint engagement_events_type_valid check (
    event_type in (
      'invited', 'opened', 'replied', 'registered',
      'confirmed', 'attended', 'no_show', 'opted_out'
    )
  ),
  constraint engagement_events_source_valid check (
    source_system in ('platform', 'instantly', 'smartlead', 'manual')
  )
);

comment on column public.engagement_events.occurred_at is
  'When it happened in the world. created_at is when we learned about it. For a sync these differ, and the gap matters when reconciling.';

create index if not exists engagement_events_contact_idx
  on public.engagement_events (contact_id, occurred_at desc);
create index if not exists engagement_events_program_idx
  on public.engagement_events (program_id, occurred_at desc);


-- -----------------------------------------------------------------------------
-- audit_events
--
-- THE ONE TABLE WITH NO updated_at AND NO AUDIT TRIGGER, AND THE REASON:
--
--   * Nothing ever updates an append-only table. An updated_at column would be
--     permanently equal to occurred_at and would imply a mutability that does
--     not exist.
--   * An audit trigger on the audit table would recurse.
--
-- Every other table in the platform has both. Do not "fix" this one.
--
-- There are also deliberately no foreign keys on actor_id or actor_contact_id.
-- An audit row must survive the deletion of whoever caused it; a foreign key
-- would either block the delete or rewrite history to hide it.
-- -----------------------------------------------------------------------------

create table if not exists public.audit_events (
  id                bigserial primary key,
  actor_type        text not null default 'system',
  actor_id          uuid,
  actor_contact_id  uuid,
  action            text not null,
  table_name        text,
  record_id         uuid,
  before            jsonb,
  after             jsonb,
  occurred_at       timestamptz not null default now(),

  constraint audit_events_actor_type_valid check (
    actor_type in ('staff', 'client_contact', 'system')
  ),
  -- A staff actor names a user; a client actor names a contact; never both.
  constraint audit_events_actor_matches_type check (
    (actor_type = 'staff' and actor_contact_id is null)
    or (actor_type = 'client_contact' and actor_id is null)
    or (actor_type = 'system' and actor_id is null and actor_contact_id is null)
  )
);

comment on table public.audit_events is
  'Append-only. No updated_at and no audit trigger, on purpose: nothing updates it, and auditing the audit table would recurse. Update and delete are revoked in the row level security migration.';

create index if not exists audit_events_record_idx
  on public.audit_events (table_name, record_id, occurred_at desc);
create index if not exists audit_events_occurred_idx
  on public.audit_events (occurred_at desc);


-- -----------------------------------------------------------------------------
-- updated_at triggers
--
-- Every table except audit_events. See the comment above that table.
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'organisations',
    'users',
    'onboarding_templates',
    'onboarding_template_fields',
    'programs',
    'program_assignments',
    'program_role_resolutions',
    'client_contacts',
    'onboarding_responses',
    'client_link_requests',
    'client_sessions',
    'companies',
    'contacts',
    'engagement_events'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;
