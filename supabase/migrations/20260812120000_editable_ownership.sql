-- =============================================================================
-- Ownership is a judgement, and it is corrected in the app.
--
-- The workbook has two columns, questions and responses. It does not say who
-- answers a question, so the importer cannot know, and every imported question
-- takes a default. A default is a starting point, not an answer, and the place
-- to correct it is the app rather than a spreadsheet round trip.
--
-- This relaxes the append-only rule on onboarding_template_fields by exactly one
-- column, and no more. The reason it is safe is that a generated response takes
-- a COPY of `owner` at generation, while it reads its question TEXT through the
-- field. So changing an owner here changes what future programmes generate and
-- cannot reach back into a live one, which is precisely the line section 4.1a
-- draws.
-- =============================================================================


alter table public.onboarding_template_fields
  add column if not exists default_owner_set_by uuid references public.users (id) on delete set null,
  add column if not exists default_owner_set_at timestamptz;

comment on column public.onboarding_template_fields.default_owner_set_by is
  'Who last set this ownership by hand. Null means it is still the importer''s default, which the importer may therefore update. Non-null means a person decided, and no import overrides it.';


-- -----------------------------------------------------------------------------
-- The relaxed guard
--
-- Still append-only for everything that describes the question itself. A row
-- may now change its owner, and nothing else. Delete and truncate stay refused.
-- -----------------------------------------------------------------------------

create or replace function public.template_fields_are_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'onboarding_template_fields is append-only. Programmes already generated read their questions from these rows, so deleting one would rewrite history. Withdraw the template version instead.';
  end if;

  if new.id                    is distinct from old.id
     or new.template_id        is distinct from old.template_id
     or new.section            is distinct from old.section
     or new.sort_order         is distinct from old.sort_order
     or new.question           is distinct from old.question
     or new.guidance           is distinct from old.guidance
     or new.default_assignee_role is distinct from old.default_assignee_role
     or new.default_offset_type   is distinct from old.default_offset_type
     or new.default_offset_value  is distinct from old.default_offset_value
     or new.blocking           is distinct from old.blocking
     or new.duplicate_kind     is distinct from old.duplicate_kind
     or new.duplicate_of       is distinct from old.duplicate_of
     or new.created_at         is distinct from old.created_at
  then
    raise exception
      'Only default_owner may be changed on a template field. Everything else is append-only, because programmes already generated read their questions from these rows. Import the workbook again; a changed sheet becomes a new version.';
  end if;

  return new;
end;
$$;

do $$
begin
  execute 'drop trigger if exists template_fields_immutable on public.onboarding_template_fields';
  execute 'create trigger template_fields_immutable
             before update or delete on public.onboarding_template_fields
             for each row execute function public.template_fields_are_immutable()';
end;
$$;

comment on function public.template_fields_are_immutable() is
  'Template fields are append-only apart from default_owner. A generated response copies owner but reads question text through the field, so an owner change affects only future generations.';
