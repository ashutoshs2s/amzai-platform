-- =============================================================================
-- Question sets: what the workbook importer needs.
--
-- A template is now one sheet of the workbook, of one of three kinds:
--
--   core         applies to every programme
--   segment      applies to one client type or sub-segment
--   situational  applies only when chosen at programme creation
--
-- Versions are immutable. The importer never edits or deletes a template that
-- exists; if a sheet's content changed it writes a new version, and programmes
-- already generated keep pointing at the version they were generated from.
-- That is SPEC.md section 4.1's rule about later versions never reaching back,
-- and it is also what makes re-importing safe: an unchanged workbook is a
-- no-op because the content hash matches.
-- =============================================================================


alter table public.onboarding_templates
  add column if not exists slug text,
  add column if not exists kind text,
  add column if not exists source_sheet text,
  add column if not exists content_hash text;

comment on column public.onboarding_templates.content_hash is
  'Hash of the sheet as imported. Equal hash means nothing changed, so the import writes nothing.';

-- Existing rows predate the importer. Give them a slug so the unique key below
-- can be added without inventing history.
update public.onboarding_templates
set slug = coalesce(slug, regexp_replace(lower(name), '[^a-z0-9]+', '_', 'g')),
    kind = coalesce(kind, 'segment')
where slug is null or kind is null;

alter table public.onboarding_templates
  drop constraint if exists onboarding_templates_kind_valid;
alter table public.onboarding_templates
  add constraint onboarding_templates_kind_valid
  check (kind in ('core', 'segment', 'situational'));

alter table public.onboarding_templates alter column slug set not null;
alter table public.onboarding_templates alter column kind set not null;

-- One row per sheet per version. The importer upserts on this.
create unique index if not exists onboarding_templates_slug_version_unique
  on public.onboarding_templates (slug, version);

/*
  A core or situational set is not tied to a programme type: the same questions
  apply to an event and to a retainer. program_type therefore becomes nullable,
  meaning "any", consistent with client_type_id and sub_segment_id already
  meaning "any" when null.
*/
alter table public.onboarding_templates alter column program_type drop not null;
alter table public.onboarding_templates
  drop constraint if exists onboarding_templates_program_type_valid;
alter table public.onboarding_templates
  add constraint onboarding_templates_program_type_valid
  check (
    program_type is null
    or program_type in ('event', 'retainer', 'dedicated_team', 'series', 'research')
  );


-- -----------------------------------------------------------------------------
-- Overlapping questions
--
-- A situational module sometimes asks something Core already asks. Recorded on
-- the field rather than resolved at import, because whether a question is a
-- duplicate depends on which sets are combined, and only generation knows that.
--
--   exact  the same question, word for word. Generation drops it and keeps Core's.
--   near   close but not identical. Generation keeps BOTH and marks this one,
--          because a near-duplicate asked twice is annoying and a subtly
--          different question silently dropped is worse.
-- -----------------------------------------------------------------------------

alter table public.onboarding_template_fields
  add column if not exists duplicate_kind text,
  add column if not exists duplicate_of text;

alter table public.onboarding_template_fields
  drop constraint if exists otf_duplicate_kind_valid;
alter table public.onboarding_template_fields
  add constraint otf_duplicate_kind_valid
  check (duplicate_kind is null or duplicate_kind in ('exact', 'near'));

comment on column public.onboarding_template_fields.duplicate_of is
  'Where the same question already appears, as sheet / section. Set by the importer, acted on at generation.';


-- -----------------------------------------------------------------------------
-- Generic questions
--
-- Hosted Buyer Organizer and Community Event Organizer have no sheet of their
-- own. Generation falls back to a shared conference organiser set, and every
-- response taken from it is marked, so nobody mistakes a borrowed question for
-- one written for that segment.
--
-- On the response rather than the template field: the question is not generic
-- in its own set, only in the one it was borrowed into.
-- -----------------------------------------------------------------------------

alter table public.onboarding_responses
  add column if not exists is_generic boolean not null default false;

comment on column public.onboarding_responses.is_generic is
  'True when this question was borrowed from a shared set because the sub-segment has none of its own.';


-- -----------------------------------------------------------------------------
-- Which templates a programme was generated from
--
-- A generated set is Core plus a segment plus any situational modules, so a
-- single onboarding_template_id cannot describe it. This records every
-- contributing version, which is what makes "why is this question here?"
-- answerable a year later.
-- -----------------------------------------------------------------------------

create table if not exists public.program_onboarding_sources (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs (id) on delete cascade,
  template_id uuid not null references public.onboarding_templates (id) on delete restrict,
  role        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint pos_unique unique (program_id, template_id),
  constraint pos_role_valid check (role in ('core', 'segment', 'situational', 'fallback'))
);

create index if not exists pos_program_idx
  on public.program_onboarding_sources (program_id);

grant select, insert, update, delete on public.program_onboarding_sources to authenticated;
grant all privileges on public.program_onboarding_sources to service_role;
revoke all on public.program_onboarding_sources from anon;

alter table public.program_onboarding_sources enable row level security;

drop policy if exists pos_select on public.program_onboarding_sources;
create policy pos_select on public.program_onboarding_sources
  for select to authenticated using (public.can_see_program(program_id));
drop policy if exists pos_insert on public.program_onboarding_sources;
create policy pos_insert on public.program_onboarding_sources
  for insert to authenticated with check ((select public.can_manage()));
drop policy if exists pos_update on public.program_onboarding_sources;
create policy pos_update on public.program_onboarding_sources
  for update to authenticated
  using ((select public.can_manage())) with check ((select public.can_manage()));
drop policy if exists pos_delete on public.program_onboarding_sources;
create policy pos_delete on public.program_onboarding_sources
  for delete to authenticated using ((select public.can_manage()));

do $$
begin
  execute 'drop trigger if exists set_updated_at on public.program_onboarding_sources';
  execute 'create trigger set_updated_at before update on public.program_onboarding_sources
             for each row execute function public.set_updated_at()';
  execute 'drop trigger if exists record_audit on public.program_onboarding_sources';
  execute 'create trigger record_audit after insert or update or delete
             on public.program_onboarding_sources
             for each row execute function public.record_audit_event()';
end;
$$;
